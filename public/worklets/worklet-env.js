// AudioWorklet 全局环境 polyfill（必须作为第一个 import 才能生效）
//
// 为什么必须是独立模块：
// ES module 的静态 import 是"提升"执行的——本文件被 import 后，
// 它的模块体先于引用它的模块体执行。因此这里的 polyfill 能赶在
// audio_core.js（wasm-bindgen 生成物）模块体执行 `new TextDecoder(...)`
// 之前安装好，避免在 AudioWorkletGlobalScope 里抛 ReferenceError。
//
// 注意：AudioWorkletGlobalScope 不提供 TextDecoder / TextEncoder / console
// （Chromium 至今未暴露），全部需要 polyfill。

if (typeof TextDecoder === 'undefined') {
  class WorkletTextDecoder {
    constructor(label = 'utf-8', opts = {}) {
      this.encoding = String(label).toLowerCase();
      this.fatal = !!opts.fatal;
      this.ignoreBOM = !!opts.ignoreBOM;
    }
    decode(buffer, opts = {}) {
      let bytes;
      if (buffer == null) return '';
      if (buffer instanceof ArrayBuffer) bytes = new Uint8Array(buffer);
      else if (ArrayBuffer.isView(buffer)) bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      else { if (this.fatal) throw new TypeError('Invalid input'); return ''; }
      if (this.ignoreBOM && bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        bytes = bytes.subarray(3);
      }
      // UTF-8 解码（fatal 模式抛错，与原生一致）
      let out = '';
      let i = 0;
      while (i < bytes.length) {
        const b0 = bytes[i++];
        if (b0 < 0x80) {
          out += String.fromCharCode(b0);
        } else if (b0 < 0xC0) {
          if (this.fatal) throw new TypeError('Decoder error');
        } else if (b0 < 0xE0) {
          const b1 = bytes[i++] || 0;
          if (this.fatal && (b1 & 0xC0) !== 0x80) throw new TypeError('Decoder error');
          out += String.fromCharCode(((b0 & 0x1F) << 6) | (b1 & 0x3F));
        } else if (b0 < 0xF0) {
          const b1 = bytes[i++] || 0, b2 = bytes[i++] || 0;
          if (this.fatal && (((b1 & 0xC0) !== 0x80) || ((b2 & 0xC0) !== 0x80))) throw new TypeError('Decoder error');
          out += String.fromCharCode(((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F));
        } else {
          const b1 = bytes[i++] || 0, b2 = bytes[i++] || 0, b3 = bytes[i++] || 0;
          if (this.fatal && (((b1 & 0xC0) !== 0x80) || ((b2 & 0xC0) !== 0x80) || ((b3 & 0xC0) !== 0x80))) throw new TypeError('Decoder error');
          const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
          const adj = cp - 0x10000;
          if (adj >= 0) {
            out += String.fromCharCode(0xD800 + (adj >> 10), 0xDC00 + (adj & 0x3FF));
          } else {
            out += String.fromCharCode(cp);
          }
        }
      }
      return out;
    }
  }
  globalThis.TextDecoder = WorkletTextDecoder;
}

if (typeof TextEncoder === 'undefined') {
  class WorkletTextEncoder {
    constructor() { this.encoding = 'utf-8'; }
    encode(input) {
      if (input == null) return new Uint8Array(0);
      const str = String(input);
      const out = [];
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        // 代理对合并为完整 code point
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
          const lo = str.charCodeAt(i + 1);
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            code = 0x10000 + ((code - 0xD800) << 10) + (lo - 0xDC00);
            i++;
          }
        }
        if (code < 0x80) out.push(code);
        else if (code < 0x800) out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
        else if (code < 0x10000) out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
        else out.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
      return new Uint8Array(out);
    }
  }
  globalThis.TextEncoder = WorkletTextEncoder;
}

// AudioWorkletGlobalScope 的 console 非标准；Chromium 目前提供，
// 但稳妥起见还是兜底一个 no-op 版本（audio_core.js 会在异常路径调 console.warn）
if (typeof console === 'undefined') {
  globalThis.console = {
    log() {}, warn() {}, error() {}, info() {}, debug() {},
  };
}

export {};
