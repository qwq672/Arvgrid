// WASM SF2 音频处理器
// 加载 audio-core 编译的 WASM 模块，在 AudioWorklet 里运行
// 相比 JS worklet：
// - 完整 SF2 规范（调制器 + 滤波器包络 + LFO）
// - rustysynth 专业级音质
// - 自动 SIMD 向量化
//
// ⚠️ AudioWorkletGlobalScope 缺少 TextDecoder/TextEncoder，
//    wasm-bindgen 生成的 JS 依赖它们，需要 polyfill

// ============ Polyfill: TextDecoder / TextEncoder ============
// AudioWorklet 全局作用域不提供这两个类，wasm-bindgen 需要
if (typeof TextDecoder === 'undefined') {
  class TextDecoderPolyfill {
    constructor(encoding = 'utf-8', options = {}) {
      this.encoding = encoding.toLowerCase();
      this.fatal = options.fatal || false;
      this.ignoreBOM = options.ignoreBOM || false;
    }
    decode(bytes) {
      if (bytes == null) return '';
      // 支持 ArrayBuffer, TypedArray, DataView
      let arr;
      if (bytes instanceof ArrayBuffer) arr = new Uint8Array(bytes);
      else if (ArrayBuffer.isView(bytes)) arr = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      else if (bytes instanceof DataView) arr = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      else { if (this.fatal) throw new TypeError('Invalid input'); return ''; }
      // UTF-8 解码
      let str = '';
      for (let i = 0; i < arr.length; ) {
        const b0 = arr[i++];
        if (b0 < 0x80) {
          str += String.fromCharCode(b0);
        } else if (b0 < 0xC0) {
          // continuation byte without leading byte — skip
          if (this.fatal) throw new TypeError('Invalid UTF-8');
        } else if (b0 < 0xE0) {
          const b1 = arr[i++] || 0;
          str += String.fromCharCode(((b0 & 0x1F) << 6) | (b1 & 0x3F));
        } else if (b0 < 0xF0) {
          const b1 = arr[i++] || 0;
          const b2 = arr[i++] || 0;
          str += String.fromCharCode(((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F));
        } else {
          const b1 = arr[i++] || 0;
          const b2 = arr[i++] || 0;
          const b3 = arr[i++] || 0;
          const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
          // 转成 UTF-16 surrogate pair
          const adj = cp - 0x10000;
          str += String.fromCharCode(0xD800 + (adj >> 10), 0xDC00 + (adj & 0x3FF));
        }
      }
      return str;
    }
  }
  globalThis.TextDecoder = TextDecoderPolyfill;
}
if (typeof TextEncoder === 'undefined') {
  class TextEncoderPolyfill {
    constructor() { this.encoding = 'utf-8'; }
    encode(str) {
      if (str == null) return new Uint8Array(0);
      // UTF-8 编码
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        let cp = str.charCodeAt(i);
        // 处理 surrogate pair
        if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < str.length) {
          const cp2 = str.charCodeAt(i + 1);
          if (cp2 >= 0xDC00 && cp2 <= 0xDFFF) {
            cp = 0x10000 + ((cp - 0xD800) << 10) + (cp2 - 0xDC00);
            i++;
          }
        }
        if (cp < 0x80) bytes.push(cp);
        else if (cp < 0x800) bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
        else if (cp < 0x10000) bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        else bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      }
      return new Uint8Array(bytes);
    }
  }
  globalThis.TextEncoder = TextEncoderPolyfill;
}
// console.log/error 在 AudioWorkletGlobalScope 里通常可用，但保险起见
if (typeof console === 'undefined') {
  globalThis.console = { log() {}, error() {}, warn() {} };
}

// ============ 加载 audio-core WASM ============
// 用动态 import 确保 polyfill 先执行
let _init, _AudioCoreWasm;
let _wasmReady = false;
let _initPromise = null;

async function ensureWasmLoaded() {
  if (_wasmReady) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    console.log('[wasm-worklet] ensureWasmLoaded: start');
    // 动态 import：在 polyfill 之后执行
    console.log('[wasm-worklet] importing audio_core.js...');
    const mod = await import('../wasm/audio_core.js');
    _init = mod.default;
    _AudioCoreWasm = mod.AudioCoreWasm;
    console.log('[wasm-worklet] audio_core.js imported, AudioCoreWasm=', typeof _AudioCoreWasm);

    // 直接 fetch WASM 文件为 ArrayBuffer，绕过 init 内部的 URL/fetch 处理
    console.log('[wasm-worklet] fetching wasm file...');
    const wasmUrl = new URL('../wasm/audio_core_bg.wasm', location.href);
    console.log('[wasm-worklet] wasm url:', wasmUrl.href);
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
    }
    const wasmBytes = await response.arrayBuffer();
    console.log('[wasm-worklet] wasm bytes loaded:', wasmBytes.byteLength);

    // 传 ArrayBuffer 给 init，跳过 URL 处理分支
    console.log('[wasm-worklet] initializing wasm...');
    await _init(wasmBytes);
    console.log('[wasm-worklet] wasm initialized');

    _wasmReady = true;
    console.log('[wasm-worklet] ensureWasmLoaded: done');
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
            console.log('[wasm-worklet] load-sf2 received, data size:', msg.data?.byteLength || msg.data?.length);
            await ensureWasmLoaded();
            console.log('[wasm-worklet] wasm ready, creating AudioCoreWasm...');
            // 创建 AudioCoreWasm 实例
            const sf2Bytes = msg.data instanceof ArrayBuffer
              ? new Uint8Array(msg.data)
              : new Uint8Array(msg.data);
            console.log('[wasm-worklet] sf2 bytes length:', sf2Bytes.length);
            this.audioCore = new _AudioCoreWasm(
              sf2Bytes,
              this.sampleRate,
              64
            );
            console.log('[wasm-worklet] AudioCoreWasm created, block_size=', this.audioCore.block_size());
            this._blockSize = this.audioCore.block_size();
            this._leftBuf = new Float32Array(this._blockSize);
            this._rightBuf = new Float32Array(this._blockSize);
            console.log('[wasm-worklet] posting load-success');
            this.port.postMessage({ type: 'load-success' });
          } catch (err) {
            console.error('[wasm-worklet] load-sf2 error:', err);
            this.port.postMessage({
              type: 'load-error',
              message: err?.message || String(err),
            });
          }
          break;
        }
        case 'note-on': {
          if (this.audioCore) {
            // 支持 whenSec 字段：如果指定了未来时间，用 setTimeout 调度
            // 否则立即触发
            const delayMs = (msg.whenSec != null)
              ? Math.max(0, (msg.whenSec - currentTime) * 1000)
              : 0;
            const trigger = () => {
              if (!this.audioCore) return;
              this.audioCore.note_on(msg.channel || 0, msg.key, msg.velocity);
              // 调度 note-off
              if (msg.duration != null && msg.duration > 0) {
                setTimeout(() => {
                  if (this.audioCore) {
                    this.audioCore.note_off(msg.channel || 0, msg.key);
                  }
                }, msg.duration * 1000);
              }
            };
            if (delayMs > 5) {
              setTimeout(trigger, delayMs);
            } else {
              trigger();
            }
          }
          break;
        }
        case 'note-on-batch': {
          // 批量调度：JS 主线程一次性发送一个调度周期内所有音符
          // 比逐个 postMessage 减少主线程开销
          if (this.audioCore && msg.notes) {
            for (let i = 0; i < msg.notes.length; i++) {
              const n = msg.notes[i];
              const delayMs = (n.whenSec != null)
                ? Math.max(0, (n.whenSec - currentTime) * 1000)
                : 0;
              const trigger = () => {
                if (!this.audioCore) return;
                this.audioCore.note_on(n.channel || 0, n.key, n.velocity);
                if (n.duration != null && n.duration > 0) {
                  setTimeout(() => {
                    if (this.audioCore) {
                      this.audioCore.note_off(n.channel || 0, n.key);
                    }
                  }, n.duration * 1000);
                }
              };
              if (delayMs > 5) {
                setTimeout(trigger, delayMs);
              } else {
                trigger();
              }
            }
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
    const internalBlock = this._blockSize || blockSize;
    const out0 = output[0];
    const out1 = numChannels >= 2 ? output[1] : out0;

    let rendered = 0;
    while (rendered < blockSize) {
      const remaining = blockSize - rendered;
      const chunk = Math.min(remaining, internalBlock);

      if (this._leftBuf.length !== chunk) {
        this._leftBuf = new Float32Array(chunk);
        this._rightBuf = new Float32Array(chunk);
      }

      try {
        this.audioCore.render(this._leftBuf, this._rightBuf);
      } catch (e) {
        this._leftBuf.fill(0);
        this._rightBuf.fill(0);
      }

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
