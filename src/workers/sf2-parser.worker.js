// SF2 解析 Web Worker
// 把 parseSF2 移出主线程，避免加载大 SF2 文件时冻结 UI
// 解析完成后返回结构化的 sampleIndex/preset 数据，主线程无需再次处理
//
// 注意：此 worker 通过 Vite 的 `new Worker(new URL(...), { type: 'module' })` 加载
// 构建时会被自动 chunk 化，运行时是纯本地后台线程，不依赖任何服务器
//
// ⚠️ 不使用 transferable：sf2Parser 的 createSampleObj 通过 pcmCache 让多个 sampleObj 共享
// 同一 pcmData（Int16Array）。postMessage 结构化克隆时不保留共享关系，
// 会导致多个 sampleObj.pcmData 指向不同的 Int16Array 副本，但 transferList 只 transfer 一份，
// 其余指向 detached buffer，主线程访问时报错 "Cannot perform Construct on a detached ArrayBuffer"。
// 改为结构化克隆（默认行为），让浏览器内部高效复制 Int16Array，确保所有引用都可用。

import { parseSF2 } from '../lib/sf2Parser';

self.onmessage = async (e) => {
  const { type, arrayBuffer } = e.data;
  if (type !== 'parse-sf2') return;

  try {
    const t0 = performance.now();
    // 在 worker 里调用 parseSF2（不在主线程跑，UI 不冻结）
    const sf2Data = parseSF2(arrayBuffer);
    const parseMs = Math.round(performance.now() - t0);

    // 不传 transferList，使用默认结构化克隆
    // 结构化克隆会复制每个 Int16Array，主线程拿到的是全新独立副本
    // 性能损耗：400MB SF2 大约多 100-200ms，但保证数据可用
    self.postMessage({
      type: 'parse-success',
      sf2Data,
      parseMs,
    });
  } catch (err) {
    self.postMessage({
      type: 'parse-error',
      message: err?.message || String(err),
      stack: err?.stack,
    });
  }
};

