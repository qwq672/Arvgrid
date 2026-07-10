// SF2 (SoundFont2) 音色库文件解析器
// 使用 soundfont2 库的 getKeyData 方法保证正确的 zone 解析
// 优化：延迟创建 AudioBuffer，存储原始 Int16 PCM 数据

import { SoundFont2 } from 'soundfont2';

const OVERRIDING_ROOT_KEY = 58;

export function parseSF2(arrayBuffer, audioContext = null) {
  const buffer = new Uint8Array(arrayBuffer);
  const sf2 = new SoundFont2(buffer);

  const sf2Name = sf2.metaData?.name || 'Unknown';
  const presets = [];

  // 使用 Map 去重：同一个 sample 对象只复制一次 PCM 数据
  // key = sample 对象引用, value = 我们构建的 sampleObj
  const sampleDedupeMap = new Map();

  for (const preset of sf2.presets) {
    const presetHeader = preset.header;
    const presetName = presetHeader.name;
    const presetProgram = presetHeader.preset;
    const presetBank = presetHeader.bank;

    const sampleIndex = new Array(128).fill(null);

    // 使用库的 getKeyData 方法对每个 MIDI 音符进行正确解析
    // getKeyData 内部会正确处理 preset zone → instrument → instrument zone 的层级选择
    for (let midi = 0; midi < 128; midi++) {
      const keyData = sf2.getKeyData(midi, presetBank, presetProgram);
      if (!keyData || !keyData.sample || !keyData.sample.header) continue;

      const sample = keyData.sample;
      const header = sample.header;
      const start = header.start;
      const end = header.end;
      const length = end - start;

      if (length <= 0 || length > 10000000) continue;

      // 获取 rootKey：优先使用 overridingRootKey (generator 58)
      let rootKey = header.originalPitch;
      if (keyData.generators && keyData.generators[OVERRIDING_ROOT_KEY]) {
        const overrideGen = keyData.generators[OVERRIDING_ROOT_KEY];
        if (overrideGen.value !== undefined && overrideGen.value !== -1) {
          rootKey = overrideGen.value;
        }
      }

      // 去重：同一个 sample 引用只创建一次 sampleObj
      let sampleObj = sampleDedupeMap.get(sample);
      if (!sampleObj) {
        const sampleRate = header.sampleRate || 44100;
        const sampleData = sample.data;
        const pcmData = new Int16Array(length);
        for (let i = 0; i < length; i++) {
          pcmData[i] = sampleData[i];
        }

        sampleObj = {
          rootKey: rootKey,
          pitchCorrection: header.pitchCorrection || 0,
          pcmData: pcmData,
          sampleRate: sampleRate,
          audioBuffer: null,
        };
        sampleDedupeMap.set(sample, sampleObj);
      }

      sampleIndex[midi] = sampleObj;
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
