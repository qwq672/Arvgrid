// SF2 (SoundFont2) 音色库文件解析器
// 直接遍历 zone 层级，正确处理全局 zone 和音高修正
// 存储：原始 Int16 PCM 数据 + 音高参数，延迟创建 AudioBuffer

import { SoundFont2 } from 'soundfont2';

// Generator 类型常量（对应 GeneratorType 枚举值）
const GEN_KEY_RANGE = 43;
const GEN_OVERRIDING_ROOT_KEY = 58;
const GEN_COARSE_TUNE = 51;
const GEN_FINE_TUNE = 52;
const GEN_SAMPLE_ID = 53;
const GEN_INSTRUMENT = 41;

// 音量包络 ADSR generator（SF2 标准）
const GEN_ATTACK_VOL_ENV = 34;
const GEN_HOLD_VOL_ENV = 35;
const GEN_DECAY_VOL_ENV = 36;
const GEN_SUSTAIN_VOL_ENV = 37;
const GEN_RELEASE_VOL_ENV = 38;
// 循环点偏移修正（与 sample header 的 startLoop/endLoop 相加）
const GEN_START_LOOP_ADDRS_OFFSET = 2;
const GEN_END_LOOP_ADDRS_OFFSET = 3;

// 绝对时间cent转秒：1200 = 1s, 0 = 1/8192 s
// SF2 规范：value 为绝对时间cent，转换公式 sec = 2^(value/1200)
function timecentsToSec(value) {
  if (value === -32768 || value === undefined || value === null) return null;
  return Math.pow(2, value / 1200);
}

export function parseSF2(arrayBuffer, audioContext = null) {
  const buffer = new Uint8Array(arrayBuffer);
  const sf2 = new SoundFont2(buffer);

  const sf2Name = sf2.metaData?.name || 'Unknown';
  const presets = [];

  // 样本去重 Map：同一个 sample 引用只复制一次 PCM 数据
  const sampleDedupeMap = new Map();

  for (const preset of sf2.presets) {
    const presetHeader = preset.header;
    const presetName = presetHeader.name;
    const presetProgram = presetHeader.preset;
    const presetBank = presetHeader.bank;

    // sampleIndex[midi] = { rootKey, coarseTune, fineTune, pitchCorrection, pcmData, sampleRate, audioBuffer }
    const sampleIndex = new Array(128).fill(null);
    // 跟踪每个 midi 是否已被 specific zone（有 keyRange）赋值
    const hasSpecific = new Array(128).fill(false);

    // 收集 preset zone 和 instrument zone 对
    // 分为 specific zones（instrument zone 有 keyRange）和 global zones（无 keyRange）
    const specificZones = [];
    const globalZones = [];

    for (const presetZone of preset.zones || []) {
      if (!presetZone.instrument) continue; // 跳过全局 preset zone

      const instrument = presetZone.instrument;

      // Preset zone key range
      const presetKeyGen = presetZone.generators?.[GEN_KEY_RANGE];
      const presetLow = presetKeyGen?.range?.lo ?? 0;
      const presetHigh = presetKeyGen?.range?.hi ?? 127;

      // Preset zone generators (CoarseTune, FineTune 可以在 preset 级别)
      const presetCoarseTune = presetZone.generators?.[GEN_COARSE_TUNE]?.value || 0;
      const presetFineTune = presetZone.generators?.[GEN_FINE_TUNE]?.value || 0;

      for (const instZone of instrument.zones || []) {
        if (!instZone.sample || !instZone.sample.header) continue; // 跳过全局 instrument zone

        const header = instZone.sample.header;
        const start = header.start;
        const end = header.end;
        const length = end - start;
        if (length <= 0 || length > 10000000) continue;

        // Instrument zone key range
        const instKeyGen = instZone.generators?.[GEN_KEY_RANGE];
        const instLow = instKeyGen?.range?.lo ?? 0;
        const instHigh = instKeyGen?.range?.hi ?? 127;

        // 有效范围 = preset zone 和 instrument zone 的交集
        const effLow = Math.max(presetLow, instLow);
        const effHigh = Math.min(presetHigh, instHigh);
        if (effLow > effHigh) continue;

        // 音高参数
        let rootKey = header.originalPitch;
        if (header.originalPitch === 255) rootKey = 60; // unpitched

        const overrideRootKey = instZone.generators?.[GEN_OVERRIDING_ROOT_KEY];
        if (overrideRootKey && overrideRootKey.value !== undefined && overrideRootKey.value !== -1) {
          rootKey = overrideRootKey.value;
        }

        const coarseTune = (instZone.generators?.[GEN_COARSE_TUNE]?.value || 0) + presetCoarseTune;
        const fineTune = (instZone.generators?.[GEN_FINE_TUNE]?.value || 0) + presetFineTune;
        const pitchCorrection = header.pitchCorrection || 0;

        // 循环点：sample header 的 startLoop/endLoop + instrument zone 的偏移
        // 仅当 startLoop/endLoop 都 > 0 且 endLoop > startLoop 时才视为有效循环
        const loopStartOffset = instZone.generators?.[GEN_START_LOOP_ADDRS_OFFSET]?.value || 0;
        const loopEndOffset = instZone.generators?.[GEN_END_LOOP_ADDRS_OFFSET]?.value || 0;
        const hasLoop = header.startLoop > 0 && header.endLoop > header.startLoop;
        const loopStart = hasLoop ? header.startLoop + loopStartOffset : 0;
        const loopEnd = hasLoop ? header.endLoop + loopEndOffset : 0;

        // 音量包络 ADSR（SF2 时间cent → 秒）
        // SustainVolEnv 是 0.1% 百分比（1000 = 100% sustain, 0 = 静音）
        const attackSec = timecentsToSec(instZone.generators?.[GEN_ATTACK_VOL_ENV]?.value) ?? 0.001;
        const holdSec = timecentsToSec(instZone.generators?.[GEN_HOLD_VOL_ENV]?.value) ?? 0;
        const decaySec = timecentsToSec(instZone.generators?.[GEN_DECAY_VOL_ENV]?.value) ?? 0;
        const sustainPerc = Math.max(0, Math.min(1, 1 - (instZone.generators?.[GEN_SUSTAIN_VOL_ENV]?.value ?? 0) / 1000));
        const releaseSec = timecentsToSec(instZone.generators?.[GEN_RELEASE_VOL_ENV]?.value) ?? 0.1;

        const zoneInfo = {
          sample: instZone.sample,
          header,
          rootKey,
          coarseTune,
          fineTune,
          pitchCorrection,
          effLow,
          effHigh,
          hasKeyRange: !!instKeyGen,
          loopStart,
          loopEnd,
          hasLoop: hasLoop && loopEnd > loopStart,
          attackSec,
          holdSec,
          decaySec,
          sustainPerc,
          releaseSec,
        };

        if (zoneInfo.hasKeyRange) {
          specificZones.push(zoneInfo);
        } else {
          globalZones.push(zoneInfo);
        }
      }
    }

    // PCM 数据缓存：同一个 sample 引用只复制一次 Int16Array（省内存）
    // 但音高参数是 zone 级别的，不能共享
    // 第一遍：处理 specific zones（有 keyRange 的优先）
    for (const zone of specificZones) {
      const sampleObj = createSampleObj(zone, sampleDedupeMap);
      for (let midi = zone.effLow; midi <= zone.effHigh; midi++) {
        if (!hasSpecific[midi]) {
          sampleIndex[midi] = sampleObj;
          hasSpecific[midi] = true;
        }
      }
    }

    // 第二遍：处理 global zones（只填充未被 specific zone 覆盖的音符）
    for (const zone of globalZones) {
      const sampleObj = createSampleObj(zone, sampleDedupeMap);
      for (let midi = zone.effLow; midi <= zone.effHigh; midi++) {
        if (!sampleIndex[midi]) {
          sampleIndex[midi] = sampleObj;
        }
      }
    }

    const hasSamples = sampleIndex.some(s => s !== null);
    if (hasSamples) {
      presets.push({
        name: presetName,
        program: presetProgram,
        bank: presetBank,
        sampleIndex: sampleIndex,
      });
    }
  }

  // 释放 soundfont2 对象
  sf2.presets = null;
  sf2.sampleData = null;
  sf2.metaData = null;
  sampleDedupeMap.clear();

  return {
    name: sf2Name,
    presets,
  };
}

function createSampleObj(zone, pcmCache) {
  const header = zone.header;
  const sampleRate = header.sampleRate || 44100;

  let pcmData = pcmCache.get(zone.sample);
  if (!pcmData) {
    const sampleData = zone.sample.data;
    pcmData = new Int16Array(sampleData);
    pcmCache.set(zone.sample, pcmData);
  }

  return {
    rootKey: zone.rootKey,
    coarseTune: zone.coarseTune,
    fineTune: zone.fineTune,
    pitchCorrection: zone.pitchCorrection,
    pcmData: pcmData,
    sampleRate: sampleRate,
    audioBuffer: null,
    // 循环点：相对 PCM 数据起始的索引（绝对索引 = header.start + loopStart）
    // 注意：pcmData 已是 zone.sample.data，其索引 0 对应 header.start
    // 所以循环相对索引 = loopStart - header.start
    hasLoop: !!zone.hasLoop,
    loopStart: zone.hasLoop ? Math.max(0, zone.loopStart - header.start) : 0,
    loopEnd: zone.hasLoop ? Math.min(pcmData.length, zone.loopEnd - header.start) : 0,
    // ADSR（秒）
    attackSec: zone.attackSec,
    holdSec: zone.holdSec,
    decaySec: zone.decaySec,
    sustainPerc: zone.sustainPerc,
    releaseSec: zone.releaseSec,
  };
}
