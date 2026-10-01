# Arvgrid Desktop

Tauri 2 桌面端，使用 Rust 原生音频核心。

## 性能优势（相比网页端）

| 指标 | 网页端 (WASM) | 桌面端 (Native) |
|------|--------------|----------------|
| 延迟 | ~50ms | <10ms |
| 复音数 | 64 | 256+ |
| 多线程 | ❌ | ✅ rayon |
| SIMD | ✅ WASM SIMD | ✅ AVX2/NEON |
| 音频后端 | 浏览器统一 | 直连系统 |

## 开发

### 前置要求

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+
- 系统依赖：
  - Linux: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev`
  - macOS: Xcode Command Line Tools
  - Windows: WebView2 (Windows 10+ 自带)

### 运行开发模式

```bash
cd desktop/src-tauri
cargo tauri dev
```

### 构建生产版本

```bash
cd desktop/src-tauri
cargo tauri build
```

## 架构

```
desktop/
├── src-tauri/
│   ├── Cargo.toml          # Rust 依赖（含 audio-core）
│   ├── tauri.conf.json     # Tauri 配置
│   ├── build.rs            # 构建脚本
│   └── src/
│       └── main.rs         # Rust 后端入口
└── src/                    # 前端代码（复用网页端 React）
```

### 与网页端共享代码

桌面端通过 `audio-core` crate（`../../audio-core`）复用网页端的 SF2 渲染逻辑。

```rust
// desktop/src-tauri/src/main.rs
use audio_core::AudioCore;

let core = AudioCore::with_soundfont(&sf2_bytes, 48000, 256)?;
core.note_on(channel, key, velocity);
core.render(&mut left, &mut right);
```

## Tauri Commands

| Command | 说明 |
|---------|------|
| `greet(name)` | 测试用 |
| `load_sf2(bytes)` | 加载 SF2 音色库 |
| `note_on(channel, key, velocity)` | 触发音符 |
| `note_off(channel, key)` | 释放音符 |
| `audio_info()` | 获取音频核心信息 |

## License

MIT
