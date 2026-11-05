// WASM 离线渲染 worker（v12 导出路径）
//
// 与实时 WASM worklet 共用同一份 audio_core（rustysynth）：
// - 导出音色与实时播放完全一致（旧 OfflineAudioContext 路径是 JS 变速率近似，音色有偏差）
// - 50 万音符不再创建上百万个 AudioNode——那是大工程导出超时/OOM 的根源
// - 渲染全程在 worker 里跑，主线程只等消息，UI 零卡顿
//
// 消息协议：
// 入：{ type:'render', sf2Bytes, sampleRate, totalSamples, masterVolume,
//       trackMeta:[{channel,program,bank,volume}], notes:{time,duration,pitch,velocity,trackIdx} }
//     （sf2Bytes 与全部 typed array 用 transfer 移交，零拷贝）
// 出：{ type:'progress', current, total }
//     { type:'done', left, right }（Float32Array，transfer 回主线程）
//     { type:'error', message }
//
// 注意：普通 Web Worker 允许动态 import()（AudioWorklet 才禁止），
// audio_core.js（wasm-bindgen 胶水）用动态 import + 路径回退加载。

// 环境补丁：soundfont2 不在此 worker 里用，但保持习惯性防御没有坏处
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

async function loadAudioCore() {
  // 候选路径（覆盖 dev / build / GitHub Pages / Tauri webview 四种部署形态）
  const candidates = [
    new URL('../wasm/audio_core.js', self.location.href).href,  // build: /assets/xxx.js -> /wasm/ ✓
    '/wasm/audio_core.js',                                        // dev: public 直出根路径 ✓
    new URL('/wasm/audio_core.js', self.location.href).href,
    'wasm/audio_core.js',
  ];
  let lastErr = null;
  for (const url of candidates) {
    try {
      // eslint-disable-next-line no-new-func
      const mod = await import(/* @vite-ignore */ url);
      if (mod && typeof mod.default === 'function') return mod;
      lastErr = new Error('module loaded but default export missing: ' + url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('audio_core.js 加载失败: ' + (lastErr?.message || lastErr));
}

// 间接索引快速排序（迭代 + 三数取中；与 useAudioEngine 同款实现）
function argsort(times) {
  const n = times.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const stack = [0, n - 1];
  while (stack.length > 0) {
    const h = stack.pop();
    const l = stack.pop();
    if (l >= h || l < 0) continue;
    const mid = (l + h) >>> 1;
    // 三数取中
    const a = times[order[l]], b = times[order[mid]], c = times[order[h]];
    let pivotIdx = mid;
    if ((a <= b && b <= c) || (c <= b && b <= a)) pivotIdx = mid;
    else if ((b <= a && a <= c) || (c <= a && a <= b)) pivotIdx = l;
    else pivotIdx = h;
    // swap pivot 到末尾
    const t = order[pivotIdx]; order[pivotIdx] = order[h]; order[h] = t;
    const pivot = times[t];
    let i = l - 1;
    for (let j = l; j < h; j++) {
      if (times[order[j]] < pivot) {
        i++;
        const s = order[i]; order[i] = order[j]; order[j] = s;
      }
    }
    const s2 = order[i + 1]; order[i + 1] = order[h]; order[h] = s2;
    const p = i + 1;
    if (p - 1 > l) stack.push(l, p - 1);
    if (p + 1 < h) stack.push(p + 1, h);
  }
  return order;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== 'render') return;

  let progressTimer = 0;
  try {
    const {
      sf2Bytes, sampleRate, totalSamples, masterVolume,
      trackMeta, notes,
    } = msg;

    if (!sf2Bytes || !notes || !notes.time) throw new Error('render 消息缺少数据');
    const noteCount = notes.time.length;
    if (noteCount === 0) throw new Error('没有音符可渲染');

    // 1) 加载 wasm 胶水并初始化（default() 会 fetch 同目录 audio_core_bg.wasm）
    const mod = await loadAudioCore();
    await mod.default();

    // 2) 创建引擎（导出用 256 复音：离线渲染不降质，DAW 标准）
    const AudioCoreWasm = mod.AudioCoreWasm;
    if (typeof AudioCoreWasm !== 'function') throw new Error('AudioCoreWasm 导出缺失');
    const core = new AudioCoreWasm(new Uint8Array(sf2Bytes), sampleRate, 256);

    // 3) 每轨预置：音色（bank+program）与推子（CC#7）
    //    特性守卫：旧版 wasm 没有这两个导出时跳过（音色退化为钢琴但不崩）
    for (let i = 0; i < trackMeta.length; i++) {
      const m = trackMeta[i];
      try {
        if (typeof core.set_program === 'function') {
          core.set_program(m.channel | 0, (m.bank ?? 0) | 0, (m.program ?? 0) | 0);
        }
        if (typeof core.set_channel_volume === 'function') {
          core.set_channel_volume(m.channel | 0, Math.round(Math.max(0, Math.min(1, m.volume ?? 1)) * 127));
        }
      } catch (err) { /* 单轨预置失败不中断整个导出 */ }
    }
    if (typeof core.set_master_volume === 'function') {
      core.set_master_volume(masterVolume ?? 0.7);
    }

    // 4) 构造 note-on / note-off 两条时间流
    //    ons 已按 time 升序（主线程保证）；offs = time + duration，需要重排
    const onTime = notes.time;
    const onCh = new Uint8Array(noteCount);
    const onKey = new Uint8Array(noteCount);
    const onVel = new Uint8Array(noteCount);
    const offTime = new Float32Array(noteCount);
    const offCh = new Uint8Array(noteCount);
    const offKey = new Uint8Array(noteCount);
    for (let i = 0; i < noteCount; i++) {
      const meta = trackMeta[notes.trackIdx[i]];
      const ch = meta ? (meta.channel | 0) : 0;
      const key = notes.pitch[i] | 0;
      onCh[i] = ch; onKey[i] = key; onVel[i] = notes.velocity[i] | 0;
      const dur = notes.duration[i] > 0 ? notes.duration[i] : 0.005;
      offTime[i] = onTime[i] + dur;
      offCh[i] = ch; offKey[i] = key;
    }
    // offs 按 time 重排（间接索引排序，同步应用 ch/key）
    const offOrder = argsort(offTime);
    const offTimeS = new Float32Array(noteCount);
    const offChS = new Uint8Array(noteCount);
    const offKeyS = new Uint8Array(noteCount);
    for (let i = 0; i < noteCount; i++) {
      const src = offOrder[i];
      offTimeS[i] = offTime[src];
      offChS[i] = offCh[src];
      offKeyS[i] = offKey[src];
    }

    // 5) 渲染主循环
    const blockSize = core.block_size() || 64;
    const totalBlocks = Math.ceil(totalSamples / blockSize);
    const outL = new Float32Array(totalSamples);
    const outR = new Float32Array(totalSamples);
    const left = new Float32Array(blockSize);
    const right = new Float32Array(blockSize);

    let onIdx = 0, offIdx = 0, base = 0;
    const progressEvery = Math.max(1000, Math.floor(totalBlocks / 100));
    for (let b = 0; b < totalBlocks; b++) {
      const blockEnd = (b + 1) * blockSize / sampleRate;
      // 到期的 note-on
      while (onIdx < noteCount && onTime[onIdx] <= blockEnd) {
        try { core.note_on(onCh[onIdx], onKey[onIdx], onVel[onIdx]); } catch (err) {}
        onIdx++;
      }
      // 到期的 note-off
      while (offIdx < noteCount && offTimeS[offIdx] <= blockEnd) {
        try { core.note_off(offChS[offIdx], offKeyS[offIdx]); } catch (err) {}
        offIdx++;
      }
      // 渲染
      try {
        core.render(left, right);
      } catch (err) {
        left.fill(0); right.fill(0);
      }
      const copyLen = Math.min(blockSize, totalSamples - base);
      if (copyLen > 0) {
        outL.set(left.subarray(0, copyLen), base);
        outR.set(right.subarray(0, copyLen), base);
      }
      base += blockSize;
      // 进度节流：~每 1% 或至少 1000 块一次
      if ((b + 1) % progressEvery === 0 || b === totalBlocks - 1) {
        const now = Date.now();
        if (now - progressTimer > 150) {
          progressTimer = now;
          self.postMessage({ type: 'progress', current: b + 1, total: totalBlocks });
        }
      }
    }

    self.postMessage(
      { type: 'done', left: outL, right: outR, sampleRate },
      [outL.buffer, outR.buffer],
    );
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};
