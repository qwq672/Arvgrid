// Tauri 桌面端 Rust 后端
//
// 集成 audio-core（Rust 原生音频核心），通过 Tauri command 暴露给前端
//
// 性能优势（相比网页端）：
// - 多线程混音（rayon）
// - SIMD 向量化（自动）
// - 直连系统音频（cpal，<10ms 延迟）
// - 无浏览器开销

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use audio_core::AudioCore;
use std::sync::{Arc, Mutex};
use tauri::State;

/// 共享音频核心状态
struct AudioState {
    core: Mutex<Option<AudioCore>>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Arvgrid Desktop is running.", name)
}

/// 加载 SF2 音色库
/// 与网页端共享同一个 audio-core 实现
#[tauri::command]
async fn load_sf2(
    sf2_bytes: Vec<u8>,
    state: State<'_, AudioState>,
) -> Result<String, String> {
    // 桌面端：sample_rate 48000，复音数 256（远超网页端 64）
    let core = AudioCore::with_soundfont(&sf2_bytes, 48000, 256)?;
    *state.core.lock().map_err(|e| e.to_string())? = Some(core);
    Ok("SF2 loaded successfully".to_string())
}

/// 触发音符
#[tauri::command]
fn note_on(
    channel: i32,
    key: i32,
    velocity: i32,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.note_on(channel, key, velocity);
    }
    Ok(())
}

/// 释放音符
#[tauri::command]
fn note_off(
    channel: i32,
    key: i32,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        core.note_off(channel, key);
    }
    Ok(())
}

/// 获取音频核心信息
#[tauri::command]
fn audio_info(state: State<'_, AudioState>) -> Result<String, String> {
    let guard = state.core.lock().map_err(|e| e.to_string())?;
    if let Some(core) = guard.as_ref() {
        Ok(format!(
            "sample_rate={}, block_size={}, max_polyphony={}",
            core.sample_rate(),
            core.block_size(),
            core.max_polyphony()
        ))
    } else {
        Ok("No audio core loaded".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AudioState {
            core: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            load_sf2,
            note_on,
            note_off,
            audio_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
