// WASM 绑定层
// 仅在 wasm32 target 编译
// 暴露 AudioCore 的接口给 JS（网页端 AudioWorklet 调用）
//
// 编译命令：
//   wasm-pack build --target web --features wasm
//   输出到 pkg/ 目录，包含 audio_core.js + audio_core_bg.wasm

#![cfg(target_arch = "wasm32")]

use crate::AudioCore;
use wasm_bindgen::prelude::*;

/// WASM 导出的音频核心
/// JS 端通过 `new AudioCoreWasm(sf2Bytes, sampleRate, maxPolyphony)` 创建
#[wasm_bindgen]
pub struct AudioCoreWasm {
    inner: AudioCore,
}

#[wasm_bindgen]
impl AudioCoreWasm {
    /// 从 SF2 文件字节创建音频核心
    /// sf2_bytes: Uint8Array（SF2 文件内容）
    /// sample_rate: 44100 或 48000
    /// max_polyphony: 最大复音数（网页端建议 64-128）
    #[wasm_bindgen(constructor)]
    pub fn new(
        sf2_bytes: &[u8],
        sample_rate: i32,
        max_polyphony: usize,
    ) -> Result<AudioCoreWasm, String> {
        let inner = AudioCore::with_soundfont(sf2_bytes, sample_rate, max_polyphony)?;
        Ok(AudioCoreWasm { inner })
    }

    /// 触发音符
    /// channel: MIDI 通道 (0-15)
    /// key: MIDI 音高 (0-127, 60 = 中央 C)
    /// velocity: 力度 (0-127)
    pub fn note_on(&self, channel: i32, key: i32, velocity: i32) {
        self.inner.note_on(channel, key, velocity);
    }

    /// 释放音符
    pub fn note_off(&self, channel: i32, key: i32) {
        self.inner.note_off(channel, key);
    }

    /// 释放所有音符
    /// immediate: true = 立即停止，false = 进入 release 阶段
    pub fn note_off_all(&self, immediate: bool) {
        self.inner.note_off_all(immediate);
    }

    /// 渲染音频到 buffer
    /// left/right: Float32Array，长度必须相同且为 block_size 的整数倍
    /// 返回实际渲染的样本数
    pub fn render(&self, left: &mut [f32], right: &mut [f32]) {
        self.inner.render(left, right);
    }

    /// 设置主音量 (0.0 - 1.0)
    pub fn set_master_volume(&self, volume: f32) {
        self.inner.set_master_volume(volume);
    }

    /// 获取采样率
    pub fn sample_rate(&self) -> i32 {
        self.inner.sample_rate()
    }

    /// 获取块大小
    pub fn block_size(&self) -> usize {
        self.inner.block_size()
    }

    /// 获取最大复音数
    pub fn max_polyphony(&self) -> usize {
        self.inner.max_polyphony()
    }
}
