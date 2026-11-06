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
    // v13 防回退加固：
    // - _sf2Bytes 留零拷贝引用用于 render 异常自愈重建（不再一次异常永久哑巴）
    // - _polyphony 由主线程下发（网页端默认 256，移动端 128）
    // - _renderErrCount 连续异常计数，阔值触发自愈重建
    this._sf2Bytes = null;
    this._polyphony = 256;
    this._renderErrCount = 0;
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
          // v13：复音数由主线程下发（实测 256 复音仅 0.275ms/量子，
          // 预算 2.667ms 余量 10×；rustysynth 硬上限 256）
          if (msg.polyphony) this._polyphony = Math.min(256, Math.max(8, msg.polyphony | 0));
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

      if (msg.type === 'ping') {
        // v13：健康检查——主线程在“确认超时”场景先 ping，
        // pong 到了说明 worklet 活着、只是那条消息丢了（可安全重发）
        this.port.postMessage({ type: 'pong', nonce: msg.nonce });
        return;
      }

      if (msg.type === 'load-sf2') {
        // v13：立即回 load-started——证明消息已到达 worklet，
        // 主线程可区分“解析中（合法阻塞）”与“消息丢失（需要重发）”
        const sf2Size = msg.data?.byteLength ?? msg.data?.length ?? 0;
        this.port.postMessage({ type: 'load-started', size: sf2Size });
        try {
          if (!_wasmReady) {
            console.error('[wasm-worklet] load-sf2: WASM not ready!');
            this.port.postMessage({ type: 'load-error', message: 'WASM not initialized' });
            return;
          }
          const sf2Bytes = new Uint8Array(msg.data);
          // v13：留零拷贝引用给 render 自愈重建用（wasm-bindgen 构造时会
          // 复制进 wasm 堆，此处引用不增加内存占用）
          this._sf2Bytes = sf2Bytes;
          this._buildCore();
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

  // v13：合成器构造抽离——首次加载与 render 异常自愈共用同一路径
  _buildCore() {
    if (!this._sf2Bytes) throw new Error('no SF2 bytes cached');
    this.audioCore = new AudioCoreWasm(this._sf2Bytes, this.sampleRate, this._polyphony);
    this._blockSize = this.audioCore.block_size();
    this._leftBuf = new Float32Array(this._blockSize);
    this._rightBuf = new Float32Array(this._blockSize);
    this._renderError = false;
    this._renderErrCount = 0;
    // 新合成器实例：通道音色缓存全部失效
    this._channelProgram.clear();
    this._pendingNotes.length = 0;
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
        try { this.audioCore.render(this._leftBuf, this._rightBuf); this._renderErrCount = 0; }
        catch (e) {
          // v13：render 异常不再永久静音——连续 2 块异常即用留存的
          // SF2 字节自愈重建合成器实例；重建也失败才静音并上报主线程
          this._leftBuf.fill(0); this._rightBuf.fill(0);
          this._renderErrCount++;
          console.error('[wasm-worklet] render error (' + this._renderErrCount + '):', e.message);
          if (this._renderErrCount >= 2) {
            try {
              this._buildCore();
              this.port.postMessage({ type: 'render-recovered', attempts: this._renderErrCount });
              console.warn('[wasm-worklet] render 异常，合成器实例已自愈重建');
            } catch (e2) {
              this._renderError = true;
              this.port.postMessage({ type: 'render-fatal', message: e2.message || String(e2) });
              console.error('[wasm-worklet] render 自愈失败，已静音并上报主线程:', e2.message);
            }
          }
        }
      } else { this._leftBuf.fill(0); this._rightBuf.fill(0); }
      out0.set(this._leftBuf.subarray(0, chunk), rendered);
      if (numChannels >= 2) out1.set(this._rightBuf.subarray(0, chunk), rendered);
      rendered += chunk;
    }
    return true;
  }
}

registerProcessor('wasm-sf2-processor', WasmSf2Processor);
