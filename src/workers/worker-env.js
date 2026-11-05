// Web Worker 环境补丁（必须作为 worker 入口的第一个 import）
//
// 为什么必须是独立模块：
// sf2Parser.js → soundfont2（npm 包）的 ESM 构建是一个 UMD 包装，
// 其模块体在求值时立即引用 `window`：
//   !function(e,t){...}(window, function(){...})
// 在 DedicatedWorkerGlobalScope 里 `window` 未定义，模块求值直接抛
// ReferenceError → worker 崩溃 → 主线程回退解析（UI 冻结）。
//
// ES module 的求值顺序保证：本模块体先于 sf2Parser.js / soundfont2
// 的模块体执行，因此这里的 globalThis.window 补丁能赶在它引用之前生效。
// （旧版把 polyfill 写在 worker 自己的模块体里——静态 import 提升执行，
//  polyfill 永远晚于依赖模块求值，等于没生效。）

if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

export {};
