// WASM SF2 音频处理器
// 加载 audio-core 编译的 WASM 模块，在 AudioWorklet 里运行
//
// rustysynth 完整 SF2 引擎：generator + modulator + 滤波器包络 + LFO + 循环点
// 性能：3-5× 快于 JS worklet（线性插值），完整 SF2 规范

// ============ Polyfill: TextDecoder / TextEncoder ============
if (typeof TextDecoder === 'undefined') {
  class TextDecoderPolyfill {
    constructor(encoding = 'utf-8', options = {}) { this.encoding = encoding.toLowerCase(); this.fatal = options.fatal || false; this.ignoreBOM = options.ignoreBOM || false; }
    decode(bytes) {
      if (bytes == null) return '';
      let arr;
      if (bytes instanceof ArrayBuffer) arr = new Uint8Array(bytes);
      else if (ArrayBuffer.isView(bytes)) arr = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      else if (bytes instanceof DataView) arr = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      else { if (this.fatal) throw new TypeError('Invalid input'); return ''; }
      let str = '';
      for (let i = 0; i < arr.length; ) {
        const b0 = arr[i++];
        if (b0 < 0x80) { str += String.fromCharCode(b0); }
        else if (b0 < 0xC0) { if (this.fatal) throw new TypeError('Invalid UTF-8'); }
        else if (b0 < 0xE0) { const b1 = arr[i++] || 0; str += String.fromCharCode(((b0 & 0x1F) << 6) | (b1 & 0x3F)); }
        else if (b0 < 0xF0) { const b1 = arr[i++] || 0; const b2 = arr[i++] || 0; str += String.fromCharCode(((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F)); }
        else { const b1 = arr[i++] || 0; const b2 = arr[i++] || 0; const b3 = arr[i++] || 0; const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F); const adj = cp - 0x10000; str += String.fromCharCode(0xD800 + (adj >> 10), 0xDC00 + (adj & 0x3FF)); }
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
      const bytes = [];
      for (let i = 0; i < str.length; i++) {
        let cp = str.charCodeAt(i);
        if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < str.length) { const cp2 = str.charCodeAt(i + 1); if (cp2 >= 0xDC00 && cp2 <= 0xDFFF) { cp = 0x10000 + ((cp - 0xD800) << 10) + (cp2 - 0xDC00); i++; } }
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
if (typeof console === 'undefined') { globalThis.console = { log() {}, error() {}, warn() {} }; }

// ============ WASM 加载（主线程 fetch 后传给 worklet）===========
let _init, _AudioCoreWasm;
let _wasmReady = false;
let _wasmResolve = null;
let _wasmReject = null;
let _wasmPromise = null;
let _requestWasmBytesFn = null;

function setRequestWasmBytesFn(fn) { _requestWasmBytesFn = fn; }

function ensureWasmLoaded() {
  if (_wasmReady) return Promise.resolve();
  if (_wasmPromise) return _wasmPromise;
  console.log('[wasm-worklet] ensureWasmLoaded: creating promise, requesting bytes from main thread');
  _wasmPromise = new Promise((resolve, reject) => {
    _wasmResolve = resolve;
    _wasmReject = reject;
    if (_requestWasmBytesFn) {
      console.log('[wasm-worklet] requesting WASM bytes from main thread...');
      _requestWasmBytesFn();
    } else {
      console.error('[wasm-worklet] no request function registered!');
      reject(new Error('No request function registered'));
    }
  });
  return _wasmPromise;
}

async function initWasmFromMain(wasmBytes) {
  if (!wasmBytes) {
    console.error('[wasm-worklet] initWasmFromMain: no wasm bytes received');
    _wasmPromise = null; _wasmReady = false;
    if (_wasmReject) _wasmReject(new Error('No wasm bytes received'));
    return;
  }
  try {
    console.log('[wasm-worklet] initWasmFromMain: start, bytes:', wasmBytes.byteLength);
    console.log('[wasm-worklet] importing audio_core.js...');
    const mod = await import('../wasm/audio_core.js');
    _init = mod.default;
    _AudioCoreWasm = mod.AudioCoreWasm;
    console.log('[wasm-worklet] audio_core.js imported, _init type:', typeof _init, '_AudioCoreWasm type:', typeof _AudioCoreWasm);
    if (typeof _init !== 'function') {
      throw new Error(`audio_core.js default export is not a function (got ${typeof _init})`);
    }
    console.log('[wasm-worklet] initializing WASM module...');
    await _init(wasmBytes);
    console.log('[wasm-worklet] WASM module initialized successfully');
    _wasmReady = true;
    if (_wasmResolve) _wasmResolve();
    console.log('[wasm-worklet] initWasmFromMain: done');
  } catch (err) {
    console.error('[wasm-worklet] initWasmFromMain error:', err.message || err);
    _wasmPromise = null; _wasmReady = false;
    if (_wasmReject) _wasmReject(err);
  }
}

class WasmSf2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    console.log('[wasm-worklet] WasmSf2Processor constructor: start');
    this.audioCore = null;
    this.sampleRate = sampleRate;
    this._leftBuf = null;
    this._rightBuf = null;
    this._blockSize = 0;
    this._pendingNotes = [];
    this._renderError = false;

    const port = this.port;
    setRequestWasmBytesFn(() => {
      console.log('[wasm-worklet] sending request-wasm-bytes to main thread');
      port.postMessage({ type: 'request-wasm-bytes' });
    });

    this.port.onmessage = async (e) => {
      const msg = e.data;
      console.log('[wasm-worklet] onmessage:', msg.type);
      switch (msg.type) {
        case 'init-wasm-bytes':
          if (msg.error) {
            console.error('[wasm-worklet] init-wasm-bytes error:', msg.error);
            await initWasmFromMain(null);
          } else {
            await initWasmFromMain(msg.wasmBytes);
          }
          break;
        case 'load-sf2':
          try {
            console.log('[wasm-worklet] load-sf2: received, size:', msg.data?.byteLength || msg.data?.length);
            await ensureWasmLoaded();
            console.log('[wasm-worklet] load-sf2: WASM ready, creating AudioCoreWasm...');
            const sf2Bytes = new Uint8Array(msg.data);
            console.log('[wasm-worklet] load-sf2: sf2Bytes length:', sf2Bytes.length);
            this.audioCore = new _AudioCoreWasm(sf2Bytes, this.sampleRate, 64);
            this._blockSize = this.audioCore.block_size();
            console.log('[wasm-worklet] load-sf2: AudioCoreWasm created, block_size:', this._blockSize);
            this._leftBuf = new Float32Array(this._blockSize);
            this._rightBuf = new Float32Array(this._blockSize);
            this._renderError = false;
            console.log('[wasm-worklet] load-sf2: posting load-success');
            this.port.postMessage({ type: 'load-success' });
          } catch (err) {
            console.error('[wasm-worklet] load-sf2 error:', err.message || err);
            this.port.postMessage({ type: 'load-error', message: err?.message || String(err) });
          }
          break;
        case 'note-on':
          if (this.audioCore) {
            this._pendingNotes.push({
              whenSec: msg.whenSec ?? currentTime,
              channel: msg.channel || 0,
              key: msg.key,
              velocity: msg.velocity,
              noteOffTime: (msg.duration != null && msg.duration > 0) ? (msg.whenSec ?? currentTime) + msg.duration : null,
            });
          }
          break;
        case 'note-on-batch':
          if (this.audioCore && msg.notes) {
            for (let i = 0; i < msg.notes.length; i++) {
              const n = msg.notes[i];
              const when = n.whenSec ?? currentTime;
              this._pendingNotes.push({
                whenSec: when,
                channel: n.channel || 0,
                key: n.key,
                velocity: n.velocity,
                noteOffTime: (n.duration != null && n.duration > 0) ? when + n.duration : null,
              });
            }
          }
          break;
        case 'note-off':
          if (this.audioCore) this.audioCore.note_off(msg.channel || 0, msg.key);
          break;
        case 'all-notes-off':
          if (this.audioCore) { this.audioCore.note_off_all(false); this._pendingNotes.length = 0; }
          break;
        case 'set-master-volume':
          if (this.audioCore) this.audioCore.set_master_volume(msg.value);
          break;
      }
    };
    console.log('[wasm-worklet] WasmSf2Processor constructor: done, posting processor-ready');
    this.port.postMessage({ type: 'processor-ready' });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    if (!this.audioCore) return true;

    // 在 process() 内触发到期的 note_on/note_off
    const now = currentTime;
    const blockEnd = now + output[0].length / this.sampleRate;
    if (this._pendingNotes.length > 0) {
      const remaining = [];
      for (let i = 0; i < this._pendingNotes.length; i++) {
        const n = this._pendingNotes[i];
        if (n.whenSec <= blockEnd) {
          this.audioCore.note_on(n.channel, n.key, n.velocity);
          if (n.noteOffTime != null) {
            remaining.push({ whenSec: n.noteOffTime, isNoteOff: true, channel: n.channel, key: n.key });
          }
        } else if (n.isNoteOff && n.whenSec <= blockEnd) {
          this.audioCore.note_off(n.channel, n.key);
        } else {
          remaining.push(n);
        }
      }
      this._pendingNotes = remaining;
    }

    const numChannels = output.length;
    const blockSize = output[0].length;
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

      if (!this._renderError) {
        try {
          this.audioCore.render(this._leftBuf, this._rightBuf);
        } catch (e) {
          this._leftBuf.fill(0);
          this._rightBuf.fill(0);
          this._renderError = true;
          console.error('[wasm-worklet] render error:', e.message);
        }
      } else {
        this._leftBuf.fill(0);
        this._rightBuf.fill(0);
      }

      out0.set(this._leftBuf.subarray(0, chunk), rendered);
      if (numChannels >= 2) {
        out1.set(this._rightBuf.subarray(0, chunk), rendered);
      }

      rendered += chunk;
    }

    return true;
  }
}

registerProcessor('wasm-sf2-processor', WasmSf2Processor);
