// WASM SF2 音频处理器 v9
// 主动接收主线程推送的 WASM 字节（不等 request-response）
//
// rustysynth 完整 SF2 引擎：generator + modulator + 滤波器包络 + LFO + 循环点

// ============ Polyfill: TextDecoder / TextEncoder ============
if (typeof TextDecoder === 'undefined') {
  class TDP { constructor(e='utf-8',o={}) {this.e=e.toLowerCase();this.f=o.fatal||false;} decode(b) {
    if(b==null)return'';let a;if(b instanceof ArrayBuffer)a=new Uint8Array(b);else if(ArrayBuffer.isView(b))a=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);else{if(this.f)throw new TypeError('Invalid');return'';}let s='';for(let i=0;i<a.length;){const b0=a[i++];if(b0<0x80){s+=String.fromCharCode(b0);}else if(b0<0xC0){if(this.f)throw new TypeError('Invalid');}else if(b0<0xE0){const b1=a[i++]||0;s+=String.fromCharCode(((b0&0x1F)<<6)|(b1&0x3F));}else if(b0<0xF0){const b1=a[i++]||0,b2=a[i++]||0;s+=String.fromCharCode(((b0&0x0F)<<12)|((b1&0x3F)<<6)|(b2&0x3F));}else{const b1=a[i++]||0,b2=a[i++]||0,b3=a[i++]||0,cp=((b0&0x07)<<18)|((b1&0x3F)<<12)|((b2&0x3F)<<6)|(b3&0x3F),adj=cp-0x10000;s+=String.fromCharCode(0xD800+(adj>>10),0xDC00+(adj&0x3FF));}}return s;}}
  globalThis.TextDecoder = TDP;
}
if (typeof TextEncoder === 'undefined') {
  class TEP { constructor(){this.encoding='utf-8';} encode(s){if(s==null)return new Uint8Array(0);const b=[];for(let i=0;i<s.length;i++){let c=s.charCodeAt(i);if(c>=0xD800&&c<=0xDBFF&&i+1<s.length){const c2=s.charCodeAt(i+1);if(c2>=0xDC00&&c2<=0xDFFF){c=0x10000+((c-0xD800)<<10)+(c2-0xDC00);i++;}}if(c<0x80)b.push(c);else if(c<0x800)b.push(0xC0|(c>>6),0x80|(c&0x3F));else if(c<0x10000)b.push(0xE0|(c>>12),0x80|((c>>6)&0x3F),0x80|(c&0x3F));else b.push(0xF0|(c>>18),0x80|((c>>12)&0x3F),0x80|((c>>6)&0x3F),0x80|(c&0x3F));}return new Uint8Array(b);}}
  globalThis.TextEncoder = TEP;
}
if (typeof console === 'undefined') { globalThis.console = { log(){}, error(){}, warn(){} }; }

// ============ WASM 模块状态 ============
let _init, _AudioCoreWasm;
let _wasmReady = false;

class WasmSf2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    console.log('[wasm-worklet] constructor: start');
    this.audioCore = null;
    this.sampleRate = sampleRate;
    this._leftBuf = null;
    this._rightBuf = null;
    this._blockSize = 0;
    this._pendingNotes = [];
    this._renderError = false;

    this.port.onmessage = async (e) => {
      const msg = e.data;
      console.log('[wasm-worklet] onmessage:', msg.type);

      if (msg.type === 'init-wasm-bytes') {
        // 主线程主动推送 WASM 字节
        if (msg.error) {
          console.error('[wasm-worklet] init-wasm-bytes error:', msg.error);
          this.port.postMessage({ type: 'init-error', message: msg.error });
          return;
        }
        try {
          console.log('[wasm-worklet] init-wasm: bytes received:', msg.wasmBytes.byteLength);
          console.log('[wasm-worklet] importing audio_core.js...');
          const mod = await import('../wasm/audio_core.js');
          _init = mod.default;
          _AudioCoreWasm = mod.AudioCoreWasm;
          console.log('[wasm-worklet] audio_core.js imported, _init:', typeof _init, '_AudioCoreWasm:', typeof _AudioCoreWasm);
          if (typeof _init !== 'function') throw new Error('audio_core.js default export is not a function');
          console.log('[wasm-worklet] initializing WASM...');
          await _init(msg.wasmBytes);
          _wasmReady = true;
          console.log('[wasm-worklet] WASM initialized successfully, posting wasm-ready');
          this.port.postMessage({ type: 'wasm-ready' });
        } catch (err) {
          console.error('[wasm-worklet] WASM init error:', err.message || err);
          this.port.postMessage({ type: 'init-error', message: err.message || String(err) });
        }
        return;
      }

      if (msg.type === 'load-sf2') {
        try {
          console.log('[wasm-worklet] load-sf2: received, size:', msg.data?.byteLength || msg.data?.length);
          if (!_wasmReady) {
            console.error('[wasm-worklet] load-sf2: WASM not ready!');
            this.port.postMessage({ type: 'load-error', message: 'WASM not initialized' });
            return;
          }
          console.log('[wasm-worklet] load-sf2: creating AudioCoreWasm...');
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
          this.port.postMessage({ type: 'load-error', message: err.message || String(err) });
        }
        return;
      }

      if (msg.type === 'note-on') {
        if (this.audioCore) {
          this._pendingNotes.push({
            whenSec: msg.whenSec ?? currentTime,
            channel: msg.channel || 0, key: msg.key, velocity: msg.velocity,
            noteOffTime: (msg.duration!=null && msg.duration>0) ? (msg.whenSec ?? currentTime)+msg.duration : null,
          });
        }
      } else if (msg.type === 'note-on-batch') {
        if (this.audioCore && msg.notes) {
          for (let i = 0; i < msg.notes.length; i++) {
            const n = msg.notes[i];
            const when = n.whenSec ?? currentTime;
            this._pendingNotes.push({
              whenSec: when, channel: n.channel||0, key: n.key, velocity: n.velocity,
              noteOffTime: (n.duration!=null && n.duration>0) ? when+n.duration : null,
            });
          }
        }
      } else if (msg.type === 'note-off') {
        if (this.audioCore) this.audioCore.note_off(msg.channel||0, msg.key);
      } else if (msg.type === 'all-notes-off') {
        if (this.audioCore) { this.audioCore.note_off_all(false); this._pendingNotes.length=0; }
      } else if (msg.type === 'set-master-volume') {
        if (this.audioCore) this.audioCore.set_master_volume(msg.value);
      }
    };

    console.log('[wasm-worklet] constructor: done, posting processor-ready');
    this.port.postMessage({ type: 'processor-ready' });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    if (!this.audioCore) return true;

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
      const chunk = Math.min(blockSize - rendered, internalBlock);
      if (this._leftBuf.length !== chunk) {
        this._leftBuf = new Float32Array(chunk);
        this._rightBuf = new Float32Array(chunk);
      }
      if (!this._renderError) {
        try { this.audioCore.render(this._leftBuf, this._rightBuf); }
        catch (e) { this._leftBuf.fill(0); this._rightBuf.fill(0); this._renderError = true; console.error('[wasm-worklet] render error:', e.message); }
      } else { this._leftBuf.fill(0); this._rightBuf.fill(0); }
      out0.set(this._leftBuf.subarray(0, chunk), rendered);
      if (numChannels >= 2) out1.set(this._rightBuf.subarray(0, chunk), rendered);
      rendered += chunk;
    }
    return true;
  }
}

registerProcessor('wasm-sf2-processor', WasmSf2Processor);
