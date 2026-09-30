# audio-core

跨端 SF2 音频合成核心，基于 [rustysynth](https://github.com/sinshu/rustysynth)。

一份 Rust 源码，两个编译目标：

- **WASM**（网页端）：在 AudioWorklet 里加载，替代 JS worklet
- **Native**（桌面端）：Tauri 后端直接调用，多线程 + SIMD

## 特性

- 完整 SF2 规范（generator + modulator + 滤波器包络 + LFO）
- 真实 ADSR 包络 + 循环点支持
- 混响 + 合唱效果
- 零拷贝音频输出
- 多线程混音（仅 native，rayon）
- 低内存占用

## 构建

### WASM（网页端）

```bash
# 安装 wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# 编译
cd audio-core
wasm-pack build --target web --features wasm

# 输出到 pkg/ 目录
# - audio_core.js（JS 绑定）
# - audio_core_bg.wasm（WASM 模块）
```

### Native（桌面端）

```bash
cd audio-core
cargo build --lib --release --features native
# 输出到 target/release/libaudio_core.so / .dll / .dylib
```

## 性能对比

| 指标 | 网页端 (WASM) | 桌面端 (Native) |
|------|--------------|----------------|
| 延迟 | ~50ms | <10ms |
| 复音数 | 64-128 | 256+ |
| 多线程 | ❌ | ✅ rayon |
| SIMD | ✅ WASM SIMD | ✅ AVX2/NEON |

## 集成

### 网页端

将 `pkg/audio_core.js` 和 `pkg/audio_core_bg.wasm` 复制到 `public/wasm/`，然后在 AudioWorklet 里加载。

### 桌面端

在 Tauri 后端 `Cargo.toml` 加依赖：

```toml
[dependencies]
audio-core = { path = "../audio-core", features = ["native"] }
```

## License

MIT
