// Arvgrid 桌面端 Rust 后端
// 原生音频引擎：audio-core (rustysynth) + cpal (低延迟输出)
// 256 复音，<10ms 延迟，完整 SF2 规范

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use audio_core::AudioCore;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::sync::{Arc, Mutex};

/// 音频引擎状态（必须 Send + Sync 才能跨 Tauri 命令使用）
struct AudioState {
    core: Arc<Mutex<Option<AudioCore>>>,
    _stream: Arc<Mutex<Option<cpal::Stream>>>,
    sample_rate: u32,
    block_size: usize,
}

// cpal::Stream 不是 Send/Sync，但我们可以安全地把它放在 Arc<Mutex<Option<>>>
// 通过 unsafe impl 让 Tauri 接受它（stream 只在音频线程用，主线程只持有引用）
unsafe impl Send for AudioState {}
unsafe impl Sync for AudioState {}

#[tauri::command]
async fn load_sf2(
    sf2_bytes: Vec<u8>,
    state: tauri::State<'_, AudioState>,
) -> Result<String, String> {
    eprintln!("[arvgrid] Loading SF2: {} bytes", sf2_bytes.len());
    let sr = state.sample_rate as i32;

    // 桌面端：256 复音
    let core = AudioCore::with_soundfont(&sf2_bytes, sr, 256)
        .map_err(|e| format!("SF2 error: {}", e))?;

    let bs = core.block_size();
    *state.core.lock().map_err(|e| e.to_string())? = Some(core);

    // 重新创建音频流
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("No audio device")?;
    let supported_config = device.default_output_config().map_err(|e| e.to_string())?;
    let sample_format = supported_config.sample_format();
    let stream_config: StreamConfig = supported_config.into();
    let core_clone = state.core.clone();

    let stream = match sample_format {
        SampleFormat::F32 => {
            device.build_output_stream(
                &stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let guard = core_clone.lock().unwrap();
                    if let Some(synth) = guard.as_ref() {
                        let block = synth.block_size();
                        let frames = data.len() / 2;
                        let mut rendered = 0;
                        while rendered < frames {
                            let chunk = (frames - rendered).min(block);
                            let mut left = vec![0f32; chunk];
                            let mut right = vec![0f32; chunk];
                            synth.render(&mut left, &mut right);
                            for i in 0..chunk {
                                data[(rendered + i) * 2] = left[i];
                                data[(rendered + i) * 2 + 1] = right[i];
                            }
                            rendered += chunk;
                        }
                    } else {
                        data.fill(0.0);
                    }
                },
                |err| eprintln!("[arvgrid] Stream error: {}", err),
                None,
            ).map_err(|e| format!("Build stream: {}", e))?
        }
        _ => return Err("Only F32 supported".to_string()),
    };

    stream.play().map_err(|e| format!("Play: {}", e))?;
    *state._stream.lock().map_err(|e| e.to_string())? = Some(stream);

    eprintln!("[arvgrid] SF2 loaded: 256 voices, {}Hz", sr);
    Ok(format!("SF2 loaded (polyphony=256, block_size={})", bs))
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
    Ok(())
}

#[tauri::command]
fn set_master_volume(volume: f32, state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.set_master_volume(volume);
    }
    Ok(())
}

#[tauri::command]
fn audio_info(state: tauri::State<'_, AudioState>) -> Result<String, String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        Ok(format!(
            "sample_rate={}, block_size={}, max_polyphony={}",
            core.sample_rate(), core.block_size(), core.max_polyphony()
        ))
    } else {
        Ok("No SF2 loaded".to_string())
    }
}

fn main() {
    eprintln!("[arvgrid] Desktop starting...");

    // 初始化音频输出
    let host = cpal::default_host();
    let (sample_rate, initial_stream) = match host.default_output_device() {
        Some(device) => {
            match device.default_output_config() {
                Ok(config) => {
                    let sr = config.sample_rate().0;
                    let sample_format = config.sample_format();
                    let stream_config: StreamConfig = config.into();
                    eprintln!("[arvgrid] Audio: {}Hz, {}ch, {:?}", sr, stream_config.channels, sample_format);

                    // 初始静音流
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

                    let stream = match stream {
                        Ok(s) => { let _ = s.play(); s }
                        Err(e) => { eprintln!("[arvgrid] Stream init failed: {}", e); return; }
                    };

                    (sr, Some(stream))
                }
                Err(e) => {
                    eprintln!("[arvgrid] Config error: {}", e);
                    (44100, None)
                }
            }
        }
        None => {
            eprintln!("[arvgrid] No audio device");
            (44100, None)
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AudioState {
            core: Arc::new(Mutex::new(None)),
            _stream: Arc::new(Mutex::new(initial_stream)),
            sample_rate,
            block_size: 64,
        })
        .invoke_handler(tauri::generate_handler![
            load_sf2,
            note_on,
            note_off,
            note_off_all,
            set_master_volume,
            audio_info,
        ])
        .run(tauri::generate_context!())
        .expect("error running arvgrid desktop");
}
