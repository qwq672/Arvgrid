// SF2 解析 Web Worker
// 把 parseSF2 移出主线程，避免加载大 SF2 文件时冻结 UI
// 解析完成后返回结构化的 sampleIndex/preset 数据，主线程无需再次处理
//
// 注意：此 worker 通过 Vite 的 `new Worker(new URL(...), { type: 'module' })` 加载
// 构建时会被自动 chunk 化，运行时是纯本地后台线程，不依赖任何服务器

import { parseSF2 } from '../lib/sf2Parser';

self.onmessage = async (e) => {
  const { type, arrayBuffer } = e.data;
  if (type !== 'parse-sf2') return;

  try {
    const t0 = performance.now();
    // 在 worker 里调用 parseSF2（不在主线程跑，UI 不冻结）
    const sf2Data = parseSF2(arrayBuffer);
    const parseMs = Math.round(performance.now() - t0);

    // sf2Data.presets 里的 sampleObj 包含 pcmData (Int16Array)
    // postMessage 会结构化克隆，但通过 transferable 可零拷贝传递所有权
    // 收集所有 unique pcmData buffer 用于 transfer
    const transferList = [];
    if (sf2Data && sf2Data.presets) {
      const seen = new Set();
      for (const preset of sf2Data.presets) {
        if (!preset.sampleIndex) continue;
        for (let m = 0; m < 128; m++) {
          const sampleObj = preset.sampleIndex[m];
          if (!sampleObj || !sampleObj.pcmData) continue;
          if (!seen.has(sampleObj.pcmData)) {
            seen.add(sampleObj.pcmData);
            transferList.push(sampleObj.pcmData.buffer);
          }
        }
      }
    }

    self.postMessage({
      type: 'parse-success',
      sf2Data,
      parseMs,
    }, transferList);
  } catch (err) {
    self.postMessage({
      type: 'parse-error',
      message: err?.message || String(err),
      stack: err?.stack,
    });
  }
};
