// WASM SF2 音频处理器 v11 —— 修复版
//
// v11 关键修复（100% 回退 JS 的根因）：
//   旧版在收到 init-wasm-bytes 消息后用动态 `import('../wasm/audio_core.js')`
//   加载 wasm-bindgen 胶水。但 WHATWG 规范与 Chromium 禁止在
//   WorkletGlobalScope 使用动态 import()
//   （报错：import() is disallowed on WorkletGlobalScope），
//   导致 WASM 初始化永远失败、每次都回退 JS worklet。
//
//   正确做法：静态 import（addModule 的模块图加载支持 ESM 静态导入链），
//   然后用 wasm-bindgen 提供的 `initSync(bytes)` 同步实例化——不需要
//   fetch、不需要动态 import。
//
//   静态 import 的模块求值顺序：worklet-env.js（polyfill）→ audio_core.js
//   （其模块体顶层 `new TextDecoder()` 依赖 polyfill）→ 本文件。
//   因此 './worklet-env.js' 必须写在第一个 import。
//
// rustysynth 完整 SF2 引擎：generator + modulator + 滤波器包络 + LFO + 循环点

import './worklet-env.js';
import { initSync, AudioCoreWasm } from '../wasm/audio_core.js';

// ============ WASM 模块状态 ============
let _wasmReady = false;

class WasmSf2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioCore = null;
    this.sampleRate = sampleRate;
    this._leftBuf = null;
    this._rightBuf = null;
    this._blockSize = 0;
    this._pendingNotes = [];
    this._renderError = false;
    // v12：通道音色/音量缓存（避免每音符重复发 MIDI 消息）
    // rustysynth 默认全通道 preset 0——不切音色所有旋律轨都是钢琴
    this._channelProgram = new Map();  // channel -> {bank, program}

    this.port.onmessage = (e) => {
      const msg = e.data;

      if (msg.type === 'init-wasm-bytes') {
        // 主线程主动推送 WASM 字节（带 transfer，零拷贝）
        if (msg.error) {
          console.error('[wasm-worklet] init-wasm-bytes error:', msg.error);
          this.port.postMessage({ type: 'init-error', message: msg.error });
          return;
        }
        try {
          if (_wasmReady) {
            // 已初始化过（重复 init）：直接确认就绪
            this.port.postMessage({ type: 'wasm-ready' });
            return;
          }
          // 同步实例化：new WebAssembly.Module(bytes) + new WebAssembly.Instance(...)
          // initSync 接受 BufferSource；AudioWorkletGlobalScope 支持 WebAssembly
          initSync(msg.wasmBytes);
          _wasmReady = true;
          this.port.postMessage({ type: 'wasm-ready' });
        } catch (err) {
          console.error('[wasm-worklet] WASM init error:', err.message || err);
          this.port.postMessage({ type: 'init-error', message: err.message || String(err) });
        }
        return;
      }

      if (msg.type === 'load-sf2') {
        try {
          if (!_wasmReady) {
            console.error('[wasm-worklet] load-sf2: WASM not ready!');
            this.port.postMessage({ type: 'load-error', message: 'WASM not initialized' });
            return;
          }
          const sf2Bytes = new Uint8Array(msg.data);
          // 64 复音：网页端 worklet 与主线程负载解耦，rustysynth
          // 内部 voice stealing 高效；桌面端 Rust 路径用 256
          this.audioCore = new AudioCoreWasm(sf2Bytes, this.sampleRate, 64);
          this._blockSize = this.audioCore.block_size();
          this._leftBuf = new Float32Array(this._blockSize);
          this._rightBuf = new Float32Array(this._blockSize);
          this._renderError = false;
          // 新 SF2 = 新合成器实例，通道音色缓存全部失效
          this._channelProgram.clear();
          this.port.postMessage({ type: 'load-success' });
        } catch (err) {
          console.error('[wasm-worklet] load-sf2 error:', err.message || err);
          this.port.postMessage({ type: 'load-error', message: err.message || String(err) });
        }
        return;
      }

      if (msg.type === 'note-on') {
        if (this.audioCore) {
          this._applyProgram(msg.channel || 0, msg.bank ?? 0, msg.program);
          this._pendingNotes.push({
            whenSec: msg.whenSec ?? currentTime,
            channel: msg.channel || 0, key: msg.key, velocity: msg.velocity,
            noteOffTime: (msg.duration != null && msg.duration > 0) ? (msg.whenSec ?? currentTime) + msg.duration : null,
          });
        }
      } else if (msg.type === 'note-on-batch') {
        if (this.audioCore && msg.notes) {
          for (let i = 0; i < msg.notes.length; i++) {
            const n = msg.notes[i];
            const when = n.whenSec ?? currentTime;
            this._applyProgram(n.channel || 0, n.bank ?? 0, n.program);
            this._pendingNotes.push({
              whenSec: when, channel: n.channel || 0, key: n.key, velocity: n.velocity,
              noteOffTime: (n.duration != null && n.duration > 0) ? when + n.duration : null,
            });
          }
        }
      } else if (msg.type === 'note-off') {
        if (this.audioCore) this.audioCore.note_off(msg.channel || 0, msg.key);
      } else if (msg.type === 'all-notes-off') {
        if (this.audioCore) { this.audioCore.note_off_all(false); this._pendingNotes.length = 0; }
      } else if (msg.type === 'set-master-volume') {
        if (this.audioCore) this.audioCore.set_master_volume(msg.value);
      } else if (msg.type === 'set-channel-volume') {
        // v12：调音台推子（CC#7）——旧版 wasm 无此导出时安全跳过
        if (this.audioCore && typeof this.audioCore.set_channel_volume === 'function') {
          try { this.audioCore.set_channel_volume(msg.channel || 0, msg.value | 0); } catch (e) {}
        }
      }
      // set-polyphony 等 JS-worklet 消息：wasm 引擎内部管理复音，忽略即可
    };

    this.port.postMessage({ type: 'processor-ready' });
  }

  // v12：按通道切音色（bank select + program change），带缓存与特性守卫。
  // 旧版 wasm（无 set_program 导出）会安全跳过——仍能出声，只是全钢琴。
  _applyProgram(channel, bank, program) {
    if (program == null || !this.audioCore) return;
    const cached = this._channelProgram.get(channel);
    if (cached && cached.bank === (bank || 0) && cached.program === program) return;
    if (typeof this.audioCore.set_program === 'function') {
      try {
        this.audioCore.set_program(channel | 0, bank | 0, program | 0);
        this._channelProgram.set(channel, { bank: bank || 0, program });
      } catch (e) {
        console.warn('[wasm-worklet] set_program failed:', e.message);
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    if (!this.audioCore) return true;

    const now = currentTime;
    const blockEnd = now + output[0].length / this.sampleRate;
    if (this._pendingNotes.length > 0) {
      // 排程：note-on 到期触发；对应的 note-off 入队等待到期
      // （v10 修复：旧版 note-off 分支是 note-on 条件的子集，永不可达）
      const remaining = [];
      for (let i = 0; i < this._pendingNotes.length; i++) {
        const n = this._pendingNotes[i];
        if (n.isNoteOff) {
          // note-off 事件：到期才触发，未到期保持等待
          if (n.whenSec <= blockEnd) {
            this.audioCore.note_off(n.channel, n.key);
          } else {
            remaining.push(n);
          }
        } else if (n.whenSec <= blockEnd) {
          this.audioCore.note_on(n.channel, n.key, n.velocity);
          if (n.noteOffTime != null) {
            remaining.push({ whenSec: n.noteOffTime, isNoteOff: true, channel: n.channel, key: n.key });
          }
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
