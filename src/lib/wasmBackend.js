// WASM 音频后端抽象层（实验性）
//
// 当前实现：WASM SF2 解析器（替代 JS parseSF2）
// 未来扩展：WASM 实时渲染器（替代 JS worklet）
//
// 设计：
// - 通过 dynamic import 按需加载 WASM 模块（用户开启实验性功能时）
// - 加载失败自动 fallback 到 JS 路径
// - 提供 onProgress 回调用于加载弹窗
//
// 当前 WASM 模块来源：自研 AssemblyScript 编译产物（待实现）
// 临时方案：暴露接口，实际 WASM 文件后续提供
// 用户开启实验性功能时会尝试加载 /wasm/sf2-parser.wasm
// 如果文件不存在或加载失败，自动回退到 JS 路径并提示用户

let _wasmModule = null;
let _wasmLoadPromise = null;
let _wasmLoadError = null;

/**
 * 检查 WASM 后端是否可用（浏览器支持 + 文件存在）
 */
export function isWasmSupported() {
  if (typeof WebAssembly === 'undefined') return false;
  if (typeof WebAssembly.instantiateStreaming === 'undefined') return false;
  return true;
}

/**
 * 获取 WASM 加载状态
 */
export function getWasmStatus() {
  if (_wasmLoadError) return { state: 'error', message: _wasmLoadError };
  if (_wasmModule) return { state: 'ready', module: _wasmModule };
  if (_wasmLoadPromise) return { state: 'loading' };
  return { state: 'idle' };
}

/**
 * 加载 WASM SF2 解析器模块
 * 从 /wasm/sf2-parser.wasm 加载（实验性，文件可能不存在）
 *
 * @param {function} onProgress - 加载进度回调 (stage, percent)
 * @returns {Promise<Object>} WASM 模块实例
 */
export async function loadWasmSf2Parser(onProgress) {
  if (_wasmModule) return _wasmModule;
  if (_wasmLoadError) throw new Error(_wasmLoadError);
  if (_wasmLoadPromise) return _wasmLoadPromise;

  _wasmLoadPromise = (async () => {
    if (!isWasmSupported()) {
      throw new Error('WebAssembly not supported in this browser');
    }

    try {
      if (onProgress) onProgress('fetching', 0);

      // 尝试加载 WASM 文件
      // 路径相对于 GitHub Pages 部署根目录
      const wasmUrl = new URL('/wasm/sf2-parser.wasm', window.location.href).href;

      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(`WASM file not found (HTTP ${response.status}). WASM backend is experimental and the file may not be deployed yet.`);
      }

      if (onProgress) onProgress('compiling', 50);

      const wasmBytes = await response.arrayBuffer();
      const wasmModule = await WebAssembly.instantiate(wasmBytes, {
        env: {
          memory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
          log: (msg) => console.log('[wasm]', msg),
        },
      });

      if (onProgress) onProgress('ready', 100);

      _wasmModule = wasmModule.instance.exports;
      return _wasmModule;
    } catch (err) {
      _wasmLoadError = err.message || String(err);
      _wasmLoadPromise = null;
      throw err;
    }
  })();

  return _wasmLoadPromise;
}

/**
 * 使用 WASM 解析 SF2（实验性）
 * 如果 WASM 未加载或解析失败，返回 null，调用方应 fallback 到 JS
 *
 * @param {ArrayBuffer} arrayBuffer - SF2 文件数据
 * @param {function} onProgress - 进度回调
 * @returns {Promise<Object|null>} 解析后的 sf2Data，或 null（fallback 到 JS）
 */
export async function parseSF2WithWasm(arrayBuffer, onProgress) {
  const wasm = await loadWasmSf2Parser(onProgress);

  // 检查 WASM 模块是否导出 parse_sf2 函数
  if (!wasm || typeof wasm.parse_sf2 !== 'function') {
    throw new Error('WASM module does not export parse_sf2 function');
  }

  // 将 ArrayBuffer 数据复制到 WASM 内存
  // 实际 WASM 接口取决于编译时的导出
  // 这里是占位实现，实际 WASM 文件需要提供正确的导出
  const memory = wasm.memory;
  if (!memory) {
    throw new Error('WASM module does not export memory');
  }

  const dataLen = arrayBuffer.byteLength;
  const wasmBuf = wasm.alloc(dataLen);
  if (!wasmBuf) {
    throw new Error('WASM alloc failed');
  }

  // 复制数据到 WASM 内存
  const wasmView = new Uint8Array(memory.buffer, wasmBuf, dataLen);
  wasmView.set(new Uint8Array(arrayBuffer));

  // 调用 WASM 解析函数
  // 返回值是解析后的 JSON 字符串指针（实际接口取决于 WASM 实现）
  const resultPtr = wasm.parse_sf2(wasmBuf, dataLen);
  if (!resultPtr) {
    wasm.free(wasmBuf);
    throw new Error('WASM parse_sf2 returned null');
  }

  // 读取结果字符串（C 风格 null-terminated）
  const resultView = new Uint8Array(memory.buffer, resultPtr);
  let resultStr = '';
  for (let i = 0; i < resultView.length; i++) {
    if (resultView[i] === 0) break;
    resultStr += String.fromCharCode(resultView[i]);
  }

  // 释放 WASM 内存
  wasm.free(wasmBuf);
  wasm.free(resultPtr);

  // 解析 JSON
  const sf2Data = JSON.parse(resultStr);
  return sf2Data;
}

/**
 * 重置 WASM 状态（用于错误恢复）
 */
export function resetWasmState() {
  _wasmModule = null;
  _wasmLoadPromise = null;
  _wasmLoadError = null;
}
