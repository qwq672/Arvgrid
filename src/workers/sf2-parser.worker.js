// SF2 解析 Web Worker
// 把 parseSF2 移出主线程，避免加载大 SF2 文件时冻结 UI

// 环境补丁必须是第一个 import：soundfont2 的 UMD 包装在模块求值期
// 引用 window，worker 里不存在 → ReferenceError（旧版因此每次都回退主线程）
import './worker-env.js';

import { parseSF2 } from '../lib/sf2Parser';

self.onmessage = async (e) => {
  const { type, arrayBuffer } = e.data;
  if (type !== 'parse-sf2') return;

  try {
    const t0 = performance.now();
    const sf2Data = parseSF2(arrayBuffer);
    const parseMs = Math.round(performance.now() - t0);

    // H5: 收集所有 unique pcmData buffer 作为 transferList
    const transferList = [];
    const seen = new Set();
    if (sf2Data && sf2Data.presets) {
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

    self.postMessage({ type: 'parse-success', sf2Data, parseMs }, transferList);
  } catch (err) {
    self.postMessage({
      type: 'parse-error',
      message: err?.message || String(err),
      stack: err?.stack,
    });
  }
};
