// Tauri 桌面端 Rust 后端（最小可行版本）
//
// 当前阶段：起头，先让 Tauri 壳能编译运行
// 后续阶段：集成 audio-core + cpal 音频输出

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::State;
use std::sync::Mutex;

/// 共享音频核心状态（后续集成 audio-core 时填充）
struct AudioState {
    sf2_loaded: Mutex<bool>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Arvgrid Desktop is running.", name)
}

/// 加载 SF2 音色库（占位实现，后续集成 audio-core）
#[tauri::command]
async fn load_sf2(state: State<'_, AudioState>) -> Result<String, String> {
    *state.sf2_loaded.lock().map_err(|e| e.to_string())? = true;
    Ok("SF2 loaded (placeholder, audio-core integration pending)".to_string())
}

/// 触发音符（占位实现）
#[tauri::command]
fn note_on(channel: i32, key: i32, velocity: i32) -> Result<(), String> {
    // TODO: 集成 audio-core 后实现
    Ok(())
}

/// 释放音符（占位实现）
#[tauri::command]
fn note_off(channel: i32, key: i32) -> Result<(), String> {
    // TODO: 集成 audio-core 后实现
    Ok(())
}

/// 获取音频核心信息
#[tauri::command]
fn audio_info(state: State<'_, AudioState>) -> Result<String, String> {
    let loaded = *state.sf2_loaded.lock().map_err(|e| e.to_string())?;
    if loaded {
        Ok("Audio core: native (placeholder), polyphony=256".to_string())
    } else {
        Ok("No audio core loaded".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AudioState {
            sf2_loaded: Mutex::new(false),
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
