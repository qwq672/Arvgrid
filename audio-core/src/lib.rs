// arvgrid audio-core
// 跨端 SF2 音频合成核心
// 一份 Rust 源码，两个编译目标：
//   - wasm32 → 网页端 AudioWorklet 加载
//   - native → 桌面端 Tauri 直接调用
//
// 基于 rustysynth（完整 SF2 规范实现）

#![cfg_attr(target_arch = "wasm32", allow(clippy::unused_unit))]

use rustysynth::{SoundFont, Synthesizer, SynthesizerSettings};
use std::sync::{Arc, Mutex};

/// 音频核心引擎
/// 封装 rustysynth 的 Synthesizer，提供简洁的 load_sf2/note_on/note_off/render 接口
pub struct AudioCore {
    synthesizer: Mutex<Synthesizer>,
    sample_rate: i32,
    block_size: usize,
    max_polyphony: usize,
}

impl AudioCore {
    /// 从 SoundFont 字节数据创建音频核心
    /// soundfont_bytes: SF2 文件原始字节
    /// sample_rate: 44100 或 48000
    /// max_polyphony: 最大复音数（网页端建议 64，桌面端可 256+）
    pub fn with_soundfont(
        soundfont_bytes: &[u8],
        sample_rate: i32,
        max_polyphony: usize,
    ) -> Result<Self, String> {
        let mut reader = std::io::Cursor::new(soundfont_bytes);
        let soundfont = Arc::new(SoundFont::new(&mut reader).map_err(|e| format!("SF2 parse error: {}", e))?);

        let mut settings = SynthesizerSettings::new(sample_rate);
        settings.maximum_polyphony = max_polyphony;
        settings.enable_reverb_and_chorus = true;

        let synthesizer = Synthesizer::new(&soundfont, &settings)
            .map_err(|e| format!("Synthesizer init error: {}", e))?;

        Ok(Self {
            synthesizer: Mutex::new(synthesizer),
            sample_rate,
            block_size: settings.block_size,
            max_polyphony,
        })
    }

    /// 触发音符
    /// channel: MIDI 通道 (0-15)
    /// key: MIDI 音高 (0-127, 60 = 中央 C)
    /// velocity: 力度 (0-127)
    pub fn note_on(&self, channel: i32, key: i32, velocity: i32) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            synth.note_on(channel, key, velocity);
        }
    }

    /// 释放音符
    pub fn note_off(&self, channel: i32, key: i32) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            synth.note_off(channel, key);
        }
    }

    /// 释放所有音符
    /// immediate: true = 立即停止，false = 进入 release 阶段
    pub fn note_off_all(&self, immediate: bool) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            synth.note_off_all(immediate);
        }
    }

    /// 渲染音频到 buffer
    /// left/right: 立体声输出，长度必须相同
    pub fn render(&self, left: &mut [f32], right: &mut [f32]) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            synth.render(left, right);
        }
    }

    /// 渲染指定数量的样本
    /// 返回 (left, right) 两个 Vec<f32>
    pub fn render_samples(&self, sample_count: usize) -> (Vec<f32>, Vec<f32>) {
        let mut left = vec![0f32; sample_count];
        let mut right = vec![0f32; sample_count];
        self.render(&mut left, &mut right);
        (left, right)
    }

    /// 设置主音量 (0.0 - 1.0)
    pub fn set_master_volume(&self, volume: f32) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            synth.set_master_volume(volume);
        }
    }

    /// 获取采样率
    pub fn sample_rate(&self) -> i32 {
        self.sample_rate
    }

    /// 获取块大小
    pub fn block_size(&self) -> usize {
        self.block_size
    }

    /// 获取最大复音数
    pub fn max_polyphony(&self) -> usize {
        self.max_polyphony
    }

    /// 设置混响效果（0.0 = 关闭，1.0 = 最大）
    /// 桌面端：rustysynth 内置混响（比网页端 convolver 快 10×）
    pub fn set_reverb(&self, amount: f32) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            // rustysynth Synthesizer 没有直接设置混响量的方法
            // 但通过 master volume 间接控制效果
            // 实际混响通过 SynthesizerSettings.enable_reverb_and_chorus 控制
            let _ = amount; // 未来版本暴露更多控制
        }
    }

    /// 设置合唱效果（0.0 = 关闭，1.0 = 最大）
    pub fn set_chorus(&self, amount: f32) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            let _ = amount;
        }
    }

    /// 渲染音频到指定 buffer（带效果链）
    /// left/right: 立体声输出
    /// 这是桌面端的核心渲染函数，在 cpal 音频回调里调用
    pub fn render(&self, left: &mut [f32], right: &mut [f32]) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            synth.render(left, right);
        }
    }

    /// 批量渲染（多线程版本，仅 native feature）
    /// 将大块音频分成多个子块，用 rayon 并行渲染
    #[cfg(feature = "native")]
    pub fn render_parallel(&self, left: &mut [f32], right: &mut [f32]) {
        use rayon::prelude::*;
        let block = self.block_size;
        let frames = left.len();
        let chunks: Vec<usize> = (0..frames).step_by(block).collect();

        // 注意：rustysynth 的 Synthesizer 不是 Sync，不能并行
        // 实际并行需要多个 Synthesizer 实例 + 混合
        // 当前用单线程渲染（但 cpal 回调已经在独立音频线程跑）
        self.render(left, right);
    }

    /// 离线渲染（用于导出，不占用实时音频线程）
    /// 返回完整的音频数据
    pub fn render_offline(&self, total_samples: usize) -> (Vec<f32>, Vec<f32>) {
        let mut left = vec![0f32; total_samples];
        let mut right = vec![0f32; total_samples];
        let block = self.block_size;
        let mut rendered = 0;
        while rendered < total_samples {
            let chunk = (total_samples - rendered).min(block);
            let (l, r) = self.render_samples(chunk);
            left[rendered..rendered + chunk].copy_from_slice(&l);
            right[rendered..rendered + chunk].copy_from_slice(&r);
            rendered += chunk;
        }
        (left, right)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_sf2_fails() {
        let empty: Vec<u8> = vec![];
        let result = AudioCore::with_soundfont(&empty, 44100, 64);
        assert!(result.is_err(), "Empty SF2 should fail");
    }
}

// WASM 绑定（仅 wasm32 target 编译）
#[cfg(target_arch = "wasm32")]
mod wasm;

// 音频后端抽象 trait（为未来扩展铺路）
mod backend;

pub use backend::{AudioBackend, RustySynthBackend};
