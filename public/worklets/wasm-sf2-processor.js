// WASM SF2 音频处理器
// 加载 audio-core 编译的 WASM 模块，在 AudioWorklet 里运行
// 相比 JS worklet：
// - 完整 SF2 规范（调制器 + 滤波器包络 + LFO）
// - rustysynth 专业级音质
// - 自动 SIMD 向量化
//
// 加载方式：
//   const url = new URL('worklets/wasm-sf2-processor.js', location.href).href;
//   await ctx.audioWorklet.addModule(url);

import init, { AudioCoreWasm } from '../wasm/audio_core.js';

let _wasmReady = false;
let _initPromise = null;

async function ensureWasmLoaded() {
  if (_wasmReady) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    // wasm-bindgen 的 init 函数会加载 .wasm 文件
    // 路径相对于当前 worklet 模块
    await init(new URL('../wasm/audio_core_bg.wasm', location.href));
    _wasmReady = true;
  })();
  return _initPromise;
}

class WasmSf2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioCore = null;
    this.sampleRate = sampleRate;
    this._leftBuf = null;
    this._rightBuf = null;
    this._blockSize = 0;

    this.port.onmessage = async (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'load-sf2': {
          try {
            await ensureWasmLoaded();
            // 创建 AudioCoreWasm 实例
            // max_polyphony: 64（网页端平衡值）
            this.audioCore = new AudioCoreWasm(
              new Uint8Array(msg.data),
              this.sampleRate,
              64
            );
            this._blockSize = this.audioCore.block_size();
            this._leftBuf = new Float32Array(this._blockSize);
            this._rightBuf = new Float32Array(this._blockSize);
            this.port.postMessage({ type: 'load-success' });
          } catch (err) {
            this.port.postMessage({
              type: 'load-error',
              message: err?.message || String(err),
            });
          }
          break;
        }
        case 'note-on': {
          if (this.audioCore) {
            this.audioCore.note_on(msg.channel || 0, msg.key, msg.velocity);
          }
          break;
        }
        case 'note-off': {
          if (this.audioCore) {
            this.audioCore.note_off(msg.channel || 0, msg.key);
          }
          break;
        }
        case 'all-notes-off': {
          if (this.audioCore) {
            this.audioCore.note_off_all(false);
          }
          break;
        }
        case 'set-master-volume': {
          if (this.audioCore) {
            this.audioCore.set_master_volume(msg.value);
          }
          break;
        }
      }
    };

    // 通知主线程 worklet 已就绪
    this.port.postMessage({ type: 'processor-ready' });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    if (!this.audioCore) return true;

    const numChannels = output.length;
    const blockSize = output[0].length;

    // rustysynth 要求按内部 block_size 渲染
    // 如果输出块大于内部 block，分块渲染
    const internalBlock = this._blockSize || blockSize;
    const out0 = output[0];
    const out1 = numChannels >= 2 ? output[1] : out0;

    let rendered = 0;
    while (rendered < blockSize) {
      const remaining = blockSize - rendered;
      const chunk = Math.min(remaining, internalBlock);

      // 用内部 buffer 渲染（避免每次分配）
      if (this._leftBuf.length !== chunk) {
        this._leftBuf = new Float32Array(chunk);
        this._rightBuf = new Float32Array(chunk);
      }

      try {
        this.audioCore.render(this._leftBuf, this._rightBuf);
      } catch (e) {
        // 渲染失败，输出静音
        this._leftBuf.fill(0);
        this._rightBuf.fill(0);
      }

      // 复制到输出
      for (let i = 0; i < chunk; i++) {
        out0[rendered + i] = this._leftBuf[i];
        if (numChannels >= 2) {
          out1[rendered + i] = this._rightBuf[i];
        }
      }

      rendered += chunk;
    }

    return true;
  }
}

registerProcessor('wasm-sf2-processor', WasmSf2Processor);
