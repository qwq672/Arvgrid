// MP3 编码 Web Worker
// 把 lamejs MP3 编码移到后台线程，避免长曲子导出时 UI 卡死
// 兼容方案：不依赖 WASM，纯 JS 在 worker 里跑 lamejs
// 收益：主线程不阻塞，UI 流畅响应；编码速度与原 lamejs 一致
//
// 编码完成后通过 transferable 返回 Uint8Array 数组，零拷贝

// 动态加载 lamejs（在 worker 内）
let _Mp3Encoder = null;
async function loadMp3Encoder() {
  if (_Mp3Encoder) return _Mp3Encoder;
  // lame.all.js 是 CommonJS bundle，在 worker 里通过动态 import + new Function 提取
  const lameAllCode = (await import('lamejs/lame.all.js?raw')).default;
  const fn = new Function(`${lameAllCode}\nreturn lamejs;`);
  const lamejsObj = fn();
  _Mp3Encoder = lamejsObj.Mp3Encoder;
  if (!_Mp3Encoder) throw new Error('Failed to load MP3 encoder in worker');
  return _Mp3Encoder;
}

self.onmessage = async (e) => {
  const { type } = e.data;
  if (type !== 'encode-mp3') return;

  const { left, right, sampleRate, numChannels, bitrate, totalBlocks } = e.data;

  try {
    self.postMessage({ type: 'progress', current: 0, total: totalBlocks, stage: 'encoding' });

    const Mp3Encoder = await loadMp3Encoder();
    const mp3encoder = new Mp3Encoder(numChannels, sampleRate, bitrate);
    const mp3Data = [];

    const sampleBlockSize = 1152;
    const leftInt16 = new Int16Array(sampleBlockSize);
    const rightInt16 = new Int16Array(sampleBlockSize);

    let blockIndex = 0;
    for (let i = 0; i < left.length; i += sampleBlockSize) {
      const remaining = Math.min(sampleBlockSize, left.length - i);
      for (let j = 0; j < remaining; j++) {
        const l = left[i + j];
        const r = right[i + j];
        leftInt16[j] = l < 0 ? l * 0x8000 : l * 0x7FFF;
        rightInt16[j] = r < 0 ? r * 0x8000 : r * 0x7FFF;
      }
      const lBuf = remaining < sampleBlockSize ? leftInt16.subarray(0, remaining) : leftInt16;
      const rBuf = remaining < sampleBlockSize ? rightInt16.subarray(0, remaining) : rightInt16;

      const mp3buf = mp3encoder.encodeBuffer(lBuf, rBuf);
      if (mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf));
      }

      blockIndex++;
      // 每 100 块报告进度
      if (blockIndex % 100 === 0) {
        self.postMessage({ type: 'progress', current: blockIndex, total: totalBlocks, stage: 'encoding' });
      }
    }

    const end = mp3encoder.flush();
    if (end.length > 0) {
      mp3Data.push(new Uint8Array(end));
    }

    self.postMessage({ type: 'progress', current: totalBlocks, total: totalBlocks, stage: 'encoding' });

    // 通过 transferable 零拷贝返回 mp3 数据
    // mp3Data 是 Uint8Array 数组，需要合并成单个 ArrayBuffer 才能传输
    const totalLength = mp3Data.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of mp3Data) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    self.postMessage({
      type: 'encode-success',
      mp3Data: combined.buffer,
    }, [combined.buffer]);
  } catch (err) {
    self.postMessage({
      type: 'encode-error',
      message: err?.message || String(err),
      stack: err?.stack,
    });
  }
};
