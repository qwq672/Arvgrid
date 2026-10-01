// 音频后端抽象 trait
// 为未来扩展铺路：MIDI 编辑器只是 arvgrid 的第一个产品形态
// 未来可能加入：合成器、效果器、多轨录音、实时协作等
//
// 当前实现：
// - WebAudioBackend (网页端，JS worklet)
// - WasmBackend (网页端，WASM worklet)
// - NativeBackend (桌面端，Rust 原生)
//
// 统一接口让上层（编辑器/播放器/合成器）不关心后端实现

/// 音频后端 trait
/// 所有音频后端都实现这个接口，上层代码通过 trait object 调用
pub trait AudioBackend: Send + Sync {
    /// 加载 SF2 音色库
    /// 返回 preset 数量
    fn load_soundfont(&mut self, sf2_bytes: &[u8]) -> Result<usize, String>;

    /// 触发音符
    /// channel: MIDI 通道 (0-15)
    /// key: 音高 (0-127, 60 = 中央 C)
    /// velocity: 力度 (0-127)
    fn note_on(&mut self, channel: i32, key: i32, velocity: i32);

    /// 释放音符
    fn note_off(&mut self, channel: i32, key: i32);

    /// 释放所有音符
    /// immediate: true = 立即停止，false = 进入 release 阶段
    fn note_off_all(&mut self, immediate: bool);

    /// 渲染音频到 buffer
    /// left/right: 立体声输出，长度必须相同
    fn render(&mut self, left: &mut [f32], right: &mut [f32]);

    /// 设置主音量 (0.0 - 1.0)
    fn set_master_volume(&mut self, volume: f32);

    /// 获取采样率
    fn sample_rate(&self) -> i32;

    /// 获取最大复音数
    fn max_polyphony(&self) -> usize;

    /// 获取后端名称（用于 UI 显示）
    fn backend_name(&self) -> &str;
}

/// 基于 rustysynth 的原生后端实现
/// 网页端 WASM 和桌面端 Native 共用这个实现
pub struct RustySynthBackend {
    core: crate::AudioCore,
    backend_name: String,
}

impl RustySynthBackend {
    /// 创建网页端 WASM 后端
    pub fn new_wasm(sf2_bytes: &[u8], sample_rate: i32) -> Result<Self, String> {
        let core = crate::AudioCore::with_soundfont(sf2_bytes, sample_rate, 64)?;
        Ok(Self {
            core,
            backend_name: "WASM (rustysynth)".to_string(),
        })
    }

    /// 创建桌面端 Native 后端
    pub fn new_native(sf2_bytes: &[u8], sample_rate: i32) -> Result<Self, String> {
        // 桌面端复音数 256，远超网页端 64
        let core = crate::AudioCore::with_soundfont(sf2_bytes, sample_rate, 256)?;
        Ok(Self {
            core,
            backend_name: "Native (rustysynth + rayon)".to_string(),
        })
    }
}

impl AudioBackend for RustySynthBackend {
    fn load_soundfont(&mut self, sf2_bytes: &[u8]) -> Result<usize, String> {
        // AudioCore 在创建时已经加载了 SF2，这里重新创建
        let new_core = crate::AudioCore::with_soundfont(
            sf2_bytes,
            self.core.sample_rate(),
            self.core.max_polyphony(),
        )?;
        self.core = new_core;
        Ok(0) // 返回 preset 数（需要从 AudioCore 暴露）
    }

    fn note_on(&mut self, channel: i32, key: i32, velocity: i32) {
        self.core.note_on(channel, key, velocity);
    }

    fn note_off(&mut self, channel: i32, key: i32) {
        self.core.note_off(channel, key);
    }

    fn note_off_all(&mut self, immediate: bool) {
        self.core.note_off_all(immediate);
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.core.render(left, right);
    }

    fn set_master_volume(&mut self, volume: f32) {
        self.core.set_master_volume(volume);
    }

    fn sample_rate(&self) -> i32 {
        self.core.sample_rate()
    }

    fn max_polyphony(&self) -> usize {
        self.core.max_polyphony()
    }

    fn backend_name(&self) -> &str {
        &self.backend_name
    }
}
