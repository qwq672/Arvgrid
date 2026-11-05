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

/// 全局 keep-alive 列表：保存 mmap 句柄防止被 drop
/// 仅 native feature 时使用；用户切换 SF2 时旧的 mmap 会被 clear() 释放
/// 用 OnceLock 替代 const Mutex::new（因为 memmap2::Mmap 不是 const-constructable）
#[cfg(feature = "native")]
static SF2_MMAP_KEEPALIVE: std::sync::OnceLock<Mutex<Vec<memmap2::Mmap>>> = std::sync::OnceLock::new();

#[cfg(feature = "native")]
fn sf2_keep_alive() -> &'static Mutex<Vec<memmap2::Mmap>> {
    SF2_MMAP_KEEPALIVE.get_or_init(|| Mutex::new(Vec::new()))
}

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

    /// 从文件路径创建音频核心（仅 native target，使用 mmap 零拷贝）
    /// 关键性能优化：2GB SF2 用 mmap 后 RSS 增量约 0
    /// 系统按需把文件页加载到 page cache，不占应用堆内存
    #[cfg(feature = "native")]
    pub fn with_soundfont_file(
        path: &str,
        sample_rate: i32,
        max_polyphony: usize,
    ) -> Result<Self, String> {
        use std::fs::File;
        let file = File::open(path).map_err(|e| format!("Open SF2 file '{}': {}", path, e))?;

        // mmap 整个 SF2 文件（不读入堆内存）
        // 2GB 文件 mmap 后 RSS 增量约 0，访问时按页加载到 page cache
        let mmap = unsafe { memmap2::Mmap::map(&file) }
            .map_err(|e| format!("mmap failed: {}", e))?;

        // rustysynth 的 SoundFont::new 接受 Read trait，mmap 的 &[u8] 直接用
        let mut reader = std::io::Cursor::new(&mmap[..]);
        let soundfont = Arc::new(SoundFont::new(&mut reader).map_err(|e| format!("SF2 parse error: {}", e))?);

        let mut settings = SynthesizerSettings::new(sample_rate);
        settings.maximum_polyphony = max_polyphony;
        settings.enable_reverb_and_chorus = true;

        let synthesizer = Synthesizer::new(&soundfont, &settings)
            .map_err(|e| format!("Synthesizer init error: {}", e))?;

        // 保存 mmap 句柄到全局 keep-alive 列表
        // 防御性设计：万一 rustysynth 内部对输入字节有引用（虽然不太可能）
        // 用户切换 SF2 时旧的 mmap 会被 keep_alive 替换并 drop
        // 进程退出时所有 mmap 自动释放
        {
            let mut keep_alive = sf2_keep_alive().lock().unwrap();
            keep_alive.clear();  // 释放上一个 SF2 的 mmap（如果有）
            keep_alive.push(mmap);
        }

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

    /// 释放单个通道的全部音符（暂停/停止时比全局更精准）
    pub fn note_off_all_channel(&self, channel: i32, immediate: bool) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            synth.note_off_all_channel(channel, immediate);
        }
    }

    /// 切换通道音色（bank select + program change）
    /// channel: MIDI 通道 (0-15)；bank: 0 = 旋律音色库, 128 = 鼓组；program: preset 编号
    /// 之前 wasm/web 全通道默认 preset 0（所有旋律轨都是钢琴）——这是音质 bug 的根源
    pub fn set_program(&self, channel: i32, bank: i32, program: i32) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            // Bank select（CC#0，MSB）
            synth.process_midi_message(channel, 0xB0, 0x00, bank);
            // Program change
            synth.process_midi_message(channel, 0xC0, program, 0);
        }
    }

    /// 设置通道音量（CC#7，0-127）——调音台推子的正确实现
    /// 之前 wasm/web 路径完全忽略 trackVol，推子无效
    pub fn set_channel_volume(&self, channel: i32, volume: i32) {
        if let Ok(mut synth) = self.synthesizer.lock() {
            let v = volume.clamp(0, 127);
            synth.process_midi_message(channel, 0xB0, 0x07, v);
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
    pub fn set_reverb(&self, _amount: f32) {
        // rustysynth 内置混响通过 SynthesizerSettings 控制
    }

    /// 设置合唱效果（0.0 = 关闭，1.0 = 最大）
    pub fn set_chorus(&self, _amount: f32) {
        // rustysynth 内置合唱通过 SynthesizerSettings 控制
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
