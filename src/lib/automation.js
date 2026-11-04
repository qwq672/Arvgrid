// 自动化参数注册表 + 关键帧插值工具
// 设计目标：让任意数值参数都能"按时间曲线变化"，类似 DAW 的 Automation Lane
//
// 数据结构：
//   automation = {
//     enabled: true,                    // 是否启用（false 时手动值生效）
//     points: [{ t: 0, v: 0.5 }, ...]  // 关键帧；t = 秒，v = 归一化 0~1（线性存储）
//   }
//
// 参数注册表 AUTOMATION_PARAMS:
//   每个参数描述 min/max/default/unit + apply(val, refs) 把"自然单位值"应用到 audio 节点

// ====== 参数注册表 ======
// key:  唯一标识，与 useProject 中 automation[key] 对应
// label / labelEn: 显示名
// group: 在 UI 里分到哪一组（音量 / 均衡器 / 动态 / 效果）
// min, max, default, step: 自然单位值（不是归一化）
// unit: '%' / 'dB' / 's' / '' 等
// toNormalized(v): 自然 -> 0~1
// fromNormalized(n): 0~1 -> 自然
// apply(naturalVal, refs): 把自然值写到 audio 节点上；refs = { masterGain, eqLow, ... }

export const AUTOMATION_PARAMS = [
  // === 主控 ===
  {
    key: 'master.volume',
    label: '主音量', labelEn: 'Master Volume', group: 'master',
    min: 0, max: 1, default: 0.7, step: 0.01, unit: '',
    toNormalized: v => clamp01((v - 0) / 1),
    fromNormalized: n => n,
    apply: (v, refs) => {
      if (refs.masterGain) refs.masterGain.gain.value = v;
    },
  },
  // === 三段 EQ ===
  {
    key: 'master.eqLow',
    label: 'EQ 低频', labelEn: 'EQ Low', group: 'eq',
    min: -12, max: 12, default: 0, step: 0.5, unit: 'dB',
    toNormalized: v => clamp01((v + 12) / 24),
    fromNormalized: n => n * 24 - 12,
    apply: (v, refs) => { if (refs.eqLow) refs.eqLow.gain.value = v; },
  },
  {
    key: 'master.eqMid',
    label: 'EQ 中频', labelEn: 'EQ Mid', group: 'eq',
    min: -12, max: 12, default: 0, step: 0.5, unit: 'dB',
    toNormalized: v => clamp01((v + 12) / 24),
    fromNormalized: n => n * 24 - 12,
    apply: (v, refs) => { if (refs.eqMid) refs.eqMid.gain.value = v; },
  },
  {
    key: 'master.eqHigh',
    label: 'EQ 高频', labelEn: 'EQ High', group: 'eq',
    min: -12, max: 12, default: 0, step: 0.5, unit: 'dB',
    toNormalized: v => clamp01((v + 12) / 24),
    fromNormalized: n => n * 24 - 12,
    apply: (v, refs) => { if (refs.eqHigh) refs.eqHigh.gain.value = v; },
  },
  // === 8 段动态 EQ ===
  ...[60, 150, 400, 1000, 2500, 6000, 12000, 16000].map((freq, i) => ({
    key: `master.eqBand${i}`,
    label: `动态EQ ${freq >= 1000 ? `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)}k` : freq}`,
    labelEn: `Dyn EQ ${freq >= 1000 ? `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)}k` : freq}`,
    group: 'eq',
    min: -12, max: 12, default: 0, step: 0.5, unit: 'dB',
    toNormalized: v => clamp01((v + 12) / 24),
    fromNormalized: n => n * 24 - 12,
    apply: (v, refs) => {
      if (refs.eqBands && refs.eqBands[i]) refs.eqBands[i].gain.value = v;
    },
  })),
  // === 动态力度（人性化） ===
  {
    key: 'master.humanize',
    label: '动态力度', labelEn: 'Humanize Velocity', group: 'dynamic',
    min: 0, max: 1, default: 0, step: 0.05, unit: '',
    toNormalized: v => clamp01(v),
    fromNormalized: n => n,
    apply: (v, refs) => { if (refs.humanizeVelocityRef) refs.humanizeVelocityRef.current = v; },
  },
  // === 丝滑音符 ===
  {
    key: 'master.noteOverlap',
    label: '丝滑音符', labelEn: 'Note Overlap', group: 'dynamic',
    min: 0, max: 1, default: 0, step: 0.05, unit: '',
    toNormalized: v => clamp01(v),
    fromNormalized: n => n,
    apply: (v, refs) => { if (refs.noteOverlapRef) refs.noteOverlapRef.current = v; },
  },
  // === 效果发送 ===
  {
    key: 'master.reverbSend',
    label: '混响发送', labelEn: 'Reverb Send', group: 'fx',
    min: 0, max: 1, default: 0.08, step: 0.01, unit: '',
    toNormalized: v => clamp01(v),
    fromNormalized: n => n,
    apply: (v, refs) => {
      if (refs.wetReverbGain) refs.wetReverbGain.gain.value = v;
      if (refs.dryGain) refs.dryGain.gain.value = Math.max(0, 1 - v * 0.5);
    },
  },
  {
    key: 'master.delaySend',
    label: '延迟发送', labelEn: 'Delay Send', group: 'fx',
    min: 0, max: 1, default: 0.1, step: 0.01, unit: '',
    toNormalized: v => clamp01(v),
    fromNormalized: n => n,
    apply: (v, refs) => { if (refs.wetDelayGain) refs.wetDelayGain.gain.value = v; },
  },
  {
    key: 'master.delayTime',
    label: '延迟时间', labelEn: 'Delay Time', group: 'fx',
    min: 0.05, max: 1, default: 0.3, step: 0.01, unit: 's',
    toNormalized: v => clamp01((v - 0.05) / 0.95),
    fromNormalized: n => 0.05 + n * 0.95,
    apply: (v, refs) => { if (refs.delayNode) refs.delayNode.delayTime.value = v; },
  },
  {
    key: 'master.delayFeedback',
    label: '延迟反馈', labelEn: 'Delay Feedback', group: 'fx',
    min: 0, max: 0.9, default: 0.2, step: 0.01, unit: '',
    toNormalized: v => clamp01(v / 0.9),
    fromNormalized: n => n * 0.9,
    apply: (v, refs) => { if (refs.delayFeedback) refs.delayFeedback.gain.value = v; },
  },
  // === 压缩器 ===
  {
    key: 'master.compressorThreshold',
    label: '压缩阈值', labelEn: 'Comp Threshold', group: 'fx',
    min: -60, max: 0, default: -12, step: 1, unit: 'dB',
    toNormalized: v => clamp01((v + 60) / 60),
    fromNormalized: n => n * 60 - 60,
    apply: (v, refs) => { if (refs.compressor) refs.compressor.threshold.value = v; },
  },
  {
    key: 'master.compressorRatio',
    label: '压缩比', labelEn: 'Comp Ratio', group: 'fx',
    min: 1, max: 20, default: 20, step: 0.5, unit: ':1',
    toNormalized: v => clamp01((v - 1) / 19),
    fromNormalized: n => 1 + n * 19,
    apply: (v, refs) => { if (refs.compressor) refs.compressor.ratio.value = v; },
  },
  // === 合唱与声场 ===
  {
    key: 'master.chorus',
    label: '合唱', labelEn: 'Chorus', group: 'fx',
    min: 0, max: 1, default: 0, step: 0.01, unit: '',
    toNormalized: v => clamp01(v),
    fromNormalized: n => n,
    apply: () => {}, // 合唱目前是占位实现，未来扩展
  },
  {
    key: 'master.stereoWidth',
    label: '立体声宽度', labelEn: 'Stereo Width', group: 'fx',
    min: 0, max: 2, default: 1, step: 0.05, unit: '',
    toNormalized: v => clamp01(v / 2),
    fromNormalized: n => n * 2,
    apply: () => {}, // 立体声宽度目前是占位实现
  },
];

export const AUTOMATION_PARAM_MAP = AUTOMATION_PARAMS.reduce((acc, p) => {
  acc[p.key] = p;
  return acc;
}, {});

export const AUTOMATION_GROUPS = [
  { key: 'master', label: '主控', labelEn: 'Master' },
  { key: 'eq',     label: '均衡器', labelEn: 'Equalizer' },
  { key: 'dynamic',label: '动态', labelEn: 'Dynamics' },
  { key: 'fx',     label: '效果器', labelEn: 'Effects' },
];

function clamp01(v) {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ====== 关键帧插值 ======
// points: [{ t, v }] v 已归一化到 0~1；返回当前 t 处的归一化值
// 端点行为：t < 首点 -> 首点值；t > 末点 -> 末点值
export function sampleAutomation(points, t) {
  if (!points || points.length === 0) return null;
  if (points.length === 1) return points[0].v;
  // 按时间排序（防御性）
  const sorted = points.slice().sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].v;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i], p2 = sorted[i + 1];
    if (t >= p1.t && t <= p2.t) {
      const ratio = (t - p1.t) / Math.max(0.0001, p2.t - p1.t);
      return p1.v + (p2.v - p1.v) * ratio;
    }
  }
  return sorted[sorted.length - 1].v;
}

// 默认空 automation
export function emptyAutomation() {
  return { enabled: false, points: [{ t: 0, v: 0.5 }, { t: 8, v: 0.5 }] };
}

// 把"自然值"打包成一份初始 automation（用参数默认值作为平线）
export function automationFromValue(param, naturalValue, duration = 8) {
  const n = param.toNormalized(naturalValue);
  return {
    enabled: false,
    points: [{ t: 0, v: n }, { t: Math.max(1, duration), v: n }],
  };
}
