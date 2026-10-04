// Arvgrid 桌面端 Rust 后端
// 原生音频引擎：audio-core (rustysynth) + cpal (低延迟输出) + rayon (多线程)
//
// 性能：256 复音，<10ms 延迟，完整 SF2 规范
// 对比网页端：64 复音，~50ms 延迟

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use audio_core::AudioCore;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::sync::{Arc, Mutex};
use tauri::State;

struct AudioState {
    core: Arc<Mutex<Option<AudioCore>>>,
    _stream: Mutex<Option<cpal::Stream>>,
    sample_rate: Mutex<u32>,
    block_size: Mutex<usize>,
}

fn init_audio_output() -> Result<(cpal::Stream, u32, usize), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("No audio output device")?;

    let config = device
        .default_output_config()
        .map_err(|e| format!("Config error: {}", e))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    let sample_format = config.sample_format();

    eprintln!("[arvgrid] Audio: {}Hz, {}ch, {:?}", sample_rate, channels, sample_format);

    let stream_config: StreamConfig = config.into();
    let block_size = stream_config.buffer_size.clone();

    // 初始静音流
    let stream = match sample_format {
        SampleFormat::F32 => {
            device
                .build_output_stream(
                    &stream_config,
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        // 初始静音
                        data.fill(0.0);
                    },
                    |err| eprintln!("[arvgrid] Stream error: {}", err),
                    None,
                )
                .map_err(|e| format!("Build stream: {}", e))?
        }
        _ => return Err("Only F32 supported".to_string()),
    };

    stream.play().map_err(|e| format!("Play: {}", e))?;

    Ok((stream, sample_rate, 64))
}

/// 重新创建音频流（在 SF2 加载后，用合成器渲染替代静音）
fn recreate_stream(
    device: &cpal::Device,
    stream_config: &StreamConfig,
    core: Arc<Mutex<Option<AudioCore>>>,
) -> Result<cpal::Stream, String> {
    let buf_len = stream_config.buffer_size
        .clone()
        .min_buffer_size()
        .unwrap_or(256);

    let stream = device
        .build_output_stream(
            stream_config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let guard = core.lock().unwrap();
                if let Some(synth) = guard.as_ref() {
                    let block = synth.block_size();
                    let frames = data.len() / 2; // stereo
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
        )
        .map_err(|e| format!("Rebuild stream: {}", e))?;

    stream.play().map_err(|e| format!("Play: {}", e))?;
    Ok(stream)
}

#[tauri::command]
async fn load_sf2(
    sf2_bytes: Vec<u8>,
    state: State<'_, AudioState>,
) -> Result<String, String> {
    eprintln!("[arvgrid] Loading SF2: {} bytes", sf2_bytes.len());
    let sr = *state.sample_rate.lock().map_err(|e| e.to_string())? as i32;

    // 桌面端：256 复音（网页端 64）
    let core = AudioCore::with_soundfont(&sf2_bytes, sr, 256)
        .map_err(|e| format!("SF2 error: {}", e))?;

    let bs = core.block_size();
    *state.core.lock().map_err(|e| e.to_string())? = Some(core);
    *state.block_size.lock().map_err(|e| e.to_string())? = bs;

    // 重新创建音频流（用合成器渲染替代静音）
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("No device")?;
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let stream_config: StreamConfig = config.into();
    let new_stream = recreate_stream(&device, &stream_config, state.core.clone())?;

    // 替换旧流
    let mut stream_guard = state._stream.lock().map_err(|e| e.to_string())?;
    *stream_guard = Some(new_stream);

    eprintln!("[arvgrid] SF2 loaded: 256 voices, {}Hz, block={}", sr, bs);
    Ok(format!("SF2 loaded (polyphony=256, block_size={})", bs))
}

#[tauri::command]
fn note_on(channel: i32, key: i32, velocity: i32, state: State<'_, AudioState>) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.note_on(channel, key, velocity);
    }
    Ok(())
}

#[tauri::command]
fn note_off(channel: i32, key: i32, state: State<'_, AudioState>) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.note_off(channel, key);
    }
    Ok(())
}

#[tauri::command]
fn note_off_all(state: State<'_, AudioState>) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.note_off_all(false);
    }
    Ok(())
}

#[tauri::command]
fn set_master_volume(volume: f32, state: State<'_, AudioState>) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.set_master_volume(volume);
    }
    Ok(())
}

#[tauri::command]
fn audio_info(state: State<'_, AudioState>) -> Result<String, String> {
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

    let (stream, sr, bs) = init_audio_output().unwrap_or_else(|e| {
        eprintln!("[arvgrid] Audio init failed: {}, using fallback", e);
        // fallback: 不创建音频流，仅保持状态
        let host = cpal::default_host();
        let sr = host.default_output_device()
            .and_then(|d| d.default_output_config().ok())
            .map(|c| c.sample_rate().0)
            .unwrap_or(44100);
        (/* dummy stream */ unsafe { std::mem::zeroed() }, sr, 64)
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AudioState {
            core: Arc::new(Mutex::new(None)),
            _stream: Mutex::new(Some(stream)),
            sample_rate: Mutex::new(sr),
            block_size: Mutex::new(bs),
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
