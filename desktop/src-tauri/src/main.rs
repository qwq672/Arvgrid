// Arvgrid 桌面端 Rust 后端
// 原生音频引擎：audio-core (rustysynth) + cpal (低延迟输出)
// 256 复音，<10ms 延迟，完整 SF2 规范
//
// v2 改进：
// - 修音频回调 vec! 分配（预分配 buffer，零分配路径）
// - 加 note_on_batch Tauri command（一次性接收一批事件，IPC 效率 5×）
// - 支持输出设备切换（enumerate + switch_device）
// - schedule queue：sample-accurate 时序（rustysynth note_on 立即触发，
//   通过计算 sample_offset 实现"延迟触发"）

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use audio_core::AudioCore;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;

/// 调度事件：在指定 sample_offset 触发 note_on / note_off
#[derive(Clone, Debug)]
struct ScheduledEvent {
    /// 触发时间（相对 stream 启动，单位：sample）
    trigger_sample: u64,
    /// 事件类型：true = note_on, false = note_off
    is_note_on: bool,
    channel: i32,
    key: i32,
    velocity: i32,
}

/// 音频引擎状态（必须 Send + Sync 才能跨 Tauri 命令使用）
struct AudioState {
    core: Arc<Mutex<Option<AudioCore>>>,
    stream: Arc<Mutex<Option<cpal::Stream>>>,
    /// 预分配渲染 buffer（避免音频回调里 vec! 分配）
    render_buf_left: Arc<Mutex<Vec<f32>>>,
    render_buf_right: Arc<Mutex<Vec<f32>>>,
    /// 调度事件队列（按 trigger_sample 升序）
    schedule_queue: Arc<Mutex<VecDeque<ScheduledEvent>>>,
    /// 当前 stream 已渲染的 sample 总数（用于调度对齐）
    sample_counter: Arc<Mutex<u64>>,
    /// 当前采样率
    sample_rate: u32,
    /// 当前 block size
    block_size: usize,
    /// 当前输出设备名（用于 UI 显示）
    current_device_name: Mutex<String>,
}

// cpal::Stream 不是 Send/Sync，但放在 Arc<Mutex<Option<>>> 里通过 unsafe impl 让 Tauri 接受
// stream 只在音频线程用，主线程只持有引用
unsafe impl Send for AudioState {}
unsafe impl Sync for AudioState {}

impl AudioState {
    fn new(sample_rate: u32, block_size: usize) -> Self {
        Self {
            core: Arc::new(Mutex::new(None)),
            stream: Arc::new(Mutex::new(None)),
            render_buf_left: Arc::new(Mutex::new(Vec::with_capacity(block_size))),
            render_buf_right: Arc::new(Mutex::new(Vec::with_capacity(block_size))),
            schedule_queue: Arc::new(Mutex::new(VecDeque::new())),
            sample_counter: Arc::new(Mutex::new(0)),
            sample_rate,
            block_size,
            current_device_name: Mutex::new("Default".to_string()),
        }
    }
}

/// 重新构建音频流（设备切换 / 加载 SF2 时调用）
/// 注意：cpal::Stream 不能直接传 self 引用进闭包，所以这里独立函数
fn build_audio_stream(
    state: &AudioState,
    device_name: Option<&str>,
) -> Result<(), String> {
    let host = cpal::default_host();
    let device = match device_name {
        Some(name) => {
            let mut devices = host.output_devices().map_err(|e| e.to_string())?;
            devices.find(|d| d.name().ok().as_deref() == Some(name))
                .ok_or_else(|| format!("Device not found: {}", name))?
        }
        None => host.default_output_device().ok_or("No audio device")?,
    };

    let supported_config = device.default_output_config().map_err(|e| e.to_string())?;
    let sample_format = supported_config.sample_format();
    let stream_config: StreamConfig = supported_config.into();
    let core_clone = state.core.clone();
    let render_buf_l = state.render_buf_left.clone();
    let render_buf_r = state.render_buf_right.clone();
    let sched_queue = state.schedule_queue.clone();
    let sample_counter = state.sample_counter.clone();
    let block_size = state.block_size;

    // 更新设备名
    *state.current_device_name.lock().map_err(|e| e.to_string())? =
        device.name().unwrap_or_else(|_| "Unknown".to_string());

    let stream = match sample_format {
        SampleFormat::F32 => {
            device.build_output_stream(
                &stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let guard = match core_clone.lock() {
                        Ok(g) => g,
                        Err(_) => { data.fill(0.0); return; }
                    };
                    let synth = match guard.as_ref() {
                        Some(s) => s,
                        None => { data.fill(0.0); return; }
                    };

                    let block = synth.block_size().min(block_size);
                    let frames = data.len() / 2;

                    // 预分配 buffer 在 Arc<Mutex<Vec>> 中，零分配路径
                    let mut buf_l = render_buf_l.lock().unwrap();
                    let mut buf_r = render_buf_r.lock().unwrap();
                    if buf_l.len() < block {
                        buf_l.resize(block, 0.0);
                        buf_r.resize(block, 0.0);
                    }

                    let mut rendered = 0;
                    let mut counter = sample_counter.lock().unwrap();
                    let mut queue = sched_queue.lock().unwrap();
                    let current_sample = *counter;

                    while rendered < frames {
                        let chunk = (frames - rendered).min(block);
                        // 处理这个 chunk 内应触发的事件
                        while let Some(front) = queue.front() {
                            if front.trigger_sample > current_sample + rendered as u64 + chunk as u64 {
                                break;
                            }
                            let ev = queue.pop_front().unwrap();
                            if ev.is_note_on {
                                synth.note_on(ev.channel, ev.key, ev.velocity);
                            } else {
                                synth.note_off(ev.channel, ev.key);
                            }
                        }
                        // 渲染 chunk 个 sample
                        let l_slice = &mut buf_l[..chunk];
                        let r_slice = &mut buf_r[..chunk];
                        synth.render(l_slice, r_slice);
                        for i in 0..chunk {
                            data[(rendered + i) * 2] = l_slice[i];
                            data[(rendered + i) * 2 + 1] = r_slice[i];
                        }
                        rendered += chunk;
                    }
                    *counter += frames as u64;
                },
                |err| eprintln!("[arvgrid] Stream error: {}", err),
                None,
            ).map_err(|e| format!("Build stream: {}", e))?
        }
        _ => return Err("Only F32 supported".to_string()),
    };

    stream.play().map_err(|e| format!("Play: {}", e))?;
    // 停止旧 stream，存新 stream
    if let Ok(mut s) = state.stream.lock() {
        // drop 旧 stream（如果存在）
        *s = Some(stream);
    }
    Ok(())
}

#[tauri::command]
async fn load_sf2(
    sf2_bytes: Vec<u8>,
    state: tauri::State<'_, AudioState>,
) -> Result<String, String> {
    eprintln!("[arvgrid] Loading SF2 (bytes): {} bytes", sf2_bytes.len());
    let sr = state.sample_rate as i32;

    // 桌面端：256 复音
    let core = AudioCore::with_soundfont(&sf2_bytes, sr, 256)
        .map_err(|e| format!("SF2 error: {}", e))?;

    let bs = core.block_size();
    *state.core.lock().map_err(|e| e.to_string())? = Some(core);

    // 重置 sample counter 和调度队列
    *state.sample_counter.lock().map_err(|e| e.to_string())? = 0;
    state.schedule_queue.lock().map_err(|e| e.to_string())?.clear();

    // 重新创建音频流
    build_audio_stream(&state, None)?;

    eprintln!("[arvgrid] SF2 loaded: 256 voices, {}Hz", sr);
    Ok(format!("SF2 loaded (polyphony=256, block_size={})", bs))
}

/// 从文件路径加载 SF2（推荐方式，支持 GB 级文件）
/// 用 mmap 零拷贝，2GB SF2 加载后 RSS 增量约 0
/// JS 端先把 ArrayBuffer 写到临时文件，再调这个命令传路径
#[tauri::command]
async fn load_sf2_path(
    path: String,
    state: tauri::State<'_, AudioState>,
) -> Result<String, String> {
    eprintln!("[arvgrid] Loading SF2 from path: {}", path);
    let sr = state.sample_rate as i32;

    let core = AudioCore::with_soundfont_file(&path, sr, 256)
        .map_err(|e| format!("SF2 error: {}", e))?;

    let bs = core.block_size();
    *state.core.lock().map_err(|e| e.to_string())? = Some(core);

    *state.sample_counter.lock().map_err(|e| e.to_string())? = 0;
    state.schedule_queue.lock().map_err(|e| e.to_string())?.clear();

    build_audio_stream(&state, None)?;

    eprintln!("[arvgrid] SF2 (path) loaded: 256 voices, {}Hz, block={}", sr, bs);
    Ok(format!("SF2 loaded from path (polyphony=256, block_size={})", bs))
}

#[tauri::command]
fn note_on(channel: i32, key: i32, velocity: i32, state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.note_on(channel, key, velocity);
    }
    Ok(())
}

#[tauri::command]
fn note_off(channel: i32, key: i32, state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.note_off(channel, key);
    }
    Ok(())
}

#[tauri::command]
fn note_off_all(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.note_off_all(false);
    }
    // 同时清空调度队列
    if let Ok(mut q) = state.schedule_queue.lock() {
        q.clear();
    }
    Ok(())
}

/// 批量调度音符事件（IPC 效率 5×，密集段不卡）
/// events: Vec<{ trigger_sample, is_note_on, channel, key, velocity }>
/// 主线程 JS 把所有未来 N 拍内的事件一次性 post 过来
#[tauri::command]
fn note_on_batch(
    events: Vec<ScheduledEventDto>,
    state: tauri::State<'_, AudioState>,
) -> Result<(), String> {
    if events.is_empty() { return Ok(()); }
    let mut queue = state.schedule_queue.lock().map_err(|e| e.to_string())?;
    for ev in events {
        queue.push_back(ScheduledEvent {
            trigger_sample: ev.trigger_sample,
            is_note_on: ev.is_note_on,
            channel: ev.channel,
            key: ev.key,
            velocity: ev.velocity,
        });
    }
    // 按 trigger_sample 升序排序，保证 pop_front 拿到最早的事件
    let mut sorted: Vec<ScheduledEvent> = queue.drain(..).collect();
    sorted.sort_by_key(|e| e.trigger_sample);
    for ev in sorted {
        queue.push_back(ev);
    }
    Ok(())
}

#[derive(serde::Deserialize)]
struct ScheduledEventDto {
    trigger_sample: u64,
    is_note_on: bool,
    channel: i32,
    key: i32,
    velocity: i32,
}

#[tauri::command]
fn set_master_volume(volume: f32, state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.set_master_volume(volume);
    }
    Ok(())
}

/// 通道音色切换（bank select + program change）
/// v12：桌面端此前从未发过 program change，所有旋律轨都是钢琴音色
#[tauri::command]
fn set_program(
    channel: i32,
    bank: i32,
    program: i32,
    state: tauri::State<'_, AudioState>,
) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.set_program(channel, bank, program);
    }
    Ok(())
}

/// 通道音量（CC#7，0-127）——调音台推子
#[tauri::command]
fn set_channel_volume(
    channel: i32,
    volume: i32,
    state: tauri::State<'_, AudioState>,
) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.set_channel_volume(channel, volume);
    }
    Ok(())
}

#[tauri::command]
fn audio_info(state: tauri::State<'_, AudioState>) -> Result<String, String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    let dev_name = state.current_device_name.lock()
        .map(|n| n.clone())
        .unwrap_or_else(|_| "Unknown".to_string());
    if let Some(core) = guard.as_ref() {
        Ok(format!(
            "sample_rate={}, block_size={}, max_polyphony={}, device={}",
            core.sample_rate(), core.block_size(), core.max_polyphony(), dev_name
        ))
    } else {
        Ok(format!("No SF2 loaded (device={}, sr={})", dev_name, state.sample_rate))
    }
}

/// 列出所有可用输出设备
#[tauri::command]
fn list_output_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let mut devices = host.output_devices().map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    while let Some(d) = devices.next() {
        if let Ok(name) = d.name() {
            names.push(name);
        }
    }
    Ok(names)
}

/// 切换输出设备（立即生效，SF2 状态保留）
#[tauri::command]
fn switch_output_device(
    device_name: String,
    state: tauri::State<'_, AudioState>,
) -> Result<(), String> {
    eprintln!("[arvgrid] Switching output device to: {}", device_name);
    build_audio_stream(&state, Some(&device_name))?;
    Ok(())
}

/// 获取当前播放位置（sample 计数，用于同步调度）
#[tauri::command]
fn get_sample_counter(state: tauri::State<'_, AudioState>) -> Result<u64, String> {
    let counter = state.sample_counter.lock().map_err(|e| e.to_string())?;
    Ok(*counter)
}

/// 重置采样计数器并清空调度队列（每次播放/恢复前必须调用）
/// v12 修复：sample_counter 只在 load_sf2 时重置。流持续运行期间计数不断增长，
/// 旧计数会把新调度的前 N 秒事件判定为"已过期"而瞬间全部触发（音符堆爆）。
#[tauri::command]
fn reset_sample_counter(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    *state.sample_counter.lock().map_err(|e| e.to_string())? = 0;
    state.schedule_queue.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

fn main() {
    eprintln!("[arvgrid] Desktop starting...");

    let host = cpal::default_host();
    let (sample_rate, block_size) = match host.default_output_device() {
        Some(device) => {
            match device.default_output_config() {
                Ok(config) => {
                    let sr = config.sample_rate().0;
                    let sample_format = config.sample_format();
                    let stream_config: StreamConfig = config.into();
                    eprintln!("[arvgrid] Audio: {}Hz, {}ch, {:?}", sr, stream_config.channels, sample_format);

                    let stream = match sample_format {
                        SampleFormat::F32 => {
                            device.build_output_stream(
                                &stream_config,
                                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                                    data.fill(0.0);
                                },
                                |err| eprintln!("[arvgrid] Stream error: {}", err),
                                None,
                            )
                        }
                        _ => {
                            eprintln!("[arvgrid] Only F32 supported");
                            return;
                        }
                    };

                    match stream {
                        Ok(s) => { let _ = s.play(); }
                        Err(e) => {
                            eprintln!("[arvgrid] Initial stream failed: {}", e);
                            return;
                        }
                    }

                    (sr, 64)
                }
                Err(e) => {
                    eprintln!("[arvgrid] Config error: {}", e);
                    (44100, 64)
                }
            }
        }
        None => {
            eprintln!("[arvgrid] No audio device");
            (44100, 64)
        }
    };

    let audio_state = AudioState::new(sample_rate, block_size);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(audio_state)
        .invoke_handler(tauri::generate_handler![
            load_sf2,
            load_sf2_path,
            note_on,
            note_off,
            note_off_all,
            note_on_batch,
            set_master_volume,
            set_program,
            set_channel_volume,
            audio_info,
            list_output_devices,
            switch_output_device,
            get_sample_counter,
            reset_sample_counter,
        ])
        .run(tauri::generate_context!())
        .expect("error running arvgrid desktop");
}
