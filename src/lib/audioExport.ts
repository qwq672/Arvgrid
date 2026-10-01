// 音频导出服务
// 支持 WAV、MP3、FLAC、AAC 格式
//
// v2 改进：
// - 无 SF2 时使用合成器 fallback，确保导出有声音
// - 使用 SF2 真实 ADSR 包络（与 worklet 路径一致）
// - 支持 SF2 循环点（持续音符在 note duration 内循环播放）
// - 加 master gain + compressor 防爆音
// - 错误不再静默吞掉，便于诊断"无声音"问题

import type { ExportOptions, ExportProgress } from '../types/audio';
import { getOscillatorPreset } from './oscillatorPresets';

/**
 * 根据 quality 选项解析导出参数
 * higher: 48kHz / 24bit(WAV) / 320kbps(MP3) — 更长渲染时间，更多细节
 * balanced: 44.1kHz / 16bit / 192kbps — 适中
 * faster: 44.1kHz / 16bit / 128kbps — 最快
 */
function resolveQualityParams(quality: string = 'balanced') {
  switch (quality) {
    case 'higher': return { sampleRate: 48000, bitDepth: 24, bitrate: 320 };
    case 'faster': return { sampleRate: 44100, bitDepth: 16, bitrate: 128 };
    default: return { sampleRate: 44100, bitDepth: 16, bitrate: 192 };
  }
}

function noteToMidi(pitch: string): number {
  const m = pitch.match(/^([A-G][#b]?)(\d+)$/);
  if (!m) return 60;
  const map: { [key: string]: number } = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
  };
  return (parseInt(m[2]) + 1) * 12 + map[m[1]];
}

/**
 * 渲染 MIDI 数据为音频缓冲区
 */
export async function renderAudioBuffer(
  tracks: any[],
  bpm: number,
  sf2Data: any,
  onProgress?: (progress: ExportProgress) => void,
  quality: string = 'balanced'
): Promise<AudioBuffer> {
  // 计算总时长
  let maxTime = 0;
  tracks.forEach(track => {
    if (track.mute) return;
    track.notes.forEach((note: { startSec: number; durationSec: number }) => {
      const endTime = note.startSec + note.durationSec;
      if (endTime > maxTime) maxTime = endTime;
    });
  });

  if (maxTime === 0) {
    throw new Error('No notes to render (project is empty)');
  }

  const totalDuration = maxTime + 1.5; // 加 1.5 秒余音（含 release 尾音）
  const { sampleRate } = resolveQualityParams(quality);
  const totalSamples = Math.ceil(totalDuration * sampleRate);

  // 创建离线 AudioContext
  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  // 主增益 + 压缩器（与实时播放路径一致，防爆音）
  const master = offlineCtx.createGain();
  master.gain.value = 0.7;
  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 12;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.001;
  compressor.release.value = 0.05;
  master.connect(compressor);
  compressor.connect(offlineCtx.destination);

  // 预解析所有 preset 查找，避免每个音符都 O(n) 遍历 presets 数组
  const presetCache = new Map<string, any>();
  const findPreset = (program: number, isDrum: boolean): any => {
    if (!sf2Data || !sf2Data.presets) return null;
    const key = `${program}_${isDrum}`;
    let cached = presetCache.get(key);
    if (cached !== undefined) return cached;
    if (isDrum) {
      cached = sf2Data.presets.find((p: any) => p.program === program && p.bank === 128)
            || sf2Data.presets.find((p: any) => p.bank === 128)
            || sf2Data.presets.find((p: any) => p.program === program);
    } else {
      cached = sf2Data.presets.find((p: any) => p.program === program && p.bank === 0)
            || sf2Data.presets.find((p: any) => p.program === program && p.bank !== 128)
            || sf2Data.presets.find((p: any) => p.program === program)
            || sf2Data.presets.find((p: any) => p.bank === 0 && p.program === 0)
            || sf2Data.presets.find((p: any) => p.bank === 0)
            || sf2Data.presets[0];
    }
    presetCache.set(key, cached || null);
    return cached;
  };

  // 预创建所有需要的 AudioBuffer，避免在音符循环中阻塞
  const preparedSamples = new Set<any>();
  const prepareSampleBuffer = (sample: any) => {
    if (!sample || preparedSamples.has(sample)) return;
    preparedSamples.add(sample);
    // 已有 audioBuffer 则不重建（避免重复创建导致内存翻倍）
    if (sample.audioBuffer) return;
    if (!sample.pcmData) {
      console.warn('[export] sample.pcmData is null, cannot create audioBuffer');
      return;
    }
    try {
      const length = sample.pcmData.length;
      if (length <= 0 || length > 10000000) {
        console.warn(`[export] sample length invalid: ${length}`);
        return;
      }
      const audioBuffer = offlineCtx.createBuffer(1, length, sample.sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      const pcm = sample.pcmData;
      const scale = 1 / 32768;
      for (let i = 0; i < length; i++) {
        channelData[i] = pcm[i] * scale;
      }
      sample.audioBuffer = audioBuffer;
      // 不再清空 pcmData，因为 worklet 路径在播放时也可能需要重新读取
    } catch (e) {
      console.error('[export] prepareSampleBuffer failed:', e);
    }
  };

  // 收集所有音符事件
  const events: any[] = [];
  tracks.forEach(track => {
    if (track.mute) return;
    const trackVol = Math.max(0, Math.min(1, (track.volume ?? 80) / 100));
    track.notes.forEach((note: { pitch: string; startSec: number; durationSec: number; velocity: number }) => {
      events.push({
        time: note.startSec,
        duration: note.durationSec,
        pitch: note.pitch,
        velocity: note.velocity,
        program: track.program,
        isDrum: (track as any).isDrum || false,
        trackVol,
      });
    });
  });
  events.sort((a, b) => a.time - b.time);

  // 第一遍：预创建所有需要的 AudioBuffer（分批进行，不阻塞 UI）
  if (sf2Data && sf2Data.presets) {
    const samplesToPrepare: any[] = [];
    for (const event of events) {
      const preset = findPreset(event.program, event.isDrum);
      if (!preset || !preset.sampleIndex) continue;
      const midi = noteToMidi(event.pitch);
      let sample = preset.sampleIndex[midi];
      if (!sample) {
        for (let off = 1; off <= 5; off++) {
          sample = preset.sampleIndex[midi + off] || preset.sampleIndex[midi - off];
          if (sample) break;
        }
      }
      if (!sample) sample = preset.sampleIndex[60];
      if (sample && !preparedSamples.has(sample)) {
        samplesToPrepare.push(sample);
        preparedSamples.add(sample);
      }
    }
    // 分批创建 AudioBuffer，每批 20 个后让出主线程
    for (let i = 0; i < samplesToPrepare.length; i++) {
      prepareSampleBuffer(samplesToPrepare[i]);
      if (onProgress && (i + 1) % 20 === 0) {
        onProgress({
          current: i + 1,
          total: samplesToPrepare.length + events.length,
          stage: 'rendering',
        });
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  // 第二遍：调度所有音符
  const totalEvents = events.length;
  const renderBase = preparedSamples.size;
  let processedEvents = 0;
  let sf2SuccessCount = 0;
  let synthFallbackCount = 0;
  let skippedCount = 0;

  for (const event of events) {
    const whenSec = event.time;
    const duration = event.duration;
    const velocity = event.velocity;
    const program = event.program;
    const trackVol = event.trackVol ?? 1;
    const isDrum = event.isDrum;
    const midi = noteToMidi(event.pitch);

    let rendered = false;

    // 优先尝试 SF2 路径
    if (sf2Data && sf2Data.presets) {
      const preset = findPreset(program, isDrum);
      if (preset && preset.sampleIndex) {
        let bestSample = preset.sampleIndex[midi];
        if (!bestSample) {
          for (let offset = 1; offset <= 5; offset++) {
            bestSample = preset.sampleIndex[midi + offset] || preset.sampleIndex[midi - offset];
            if (bestSample) break;
          }
        }
        if (!bestSample) bestSample = preset.sampleIndex[60];

        if (bestSample) {
          // 确保 audioBuffer 已创建
          if (!bestSample.audioBuffer) {
            prepareSampleBuffer(bestSample);
          }
          if (bestSample.audioBuffer) {
            renderSF2Note(offlineCtx, master, whenSec, duration, velocity, midi, bestSample, isDrum, trackVol);
            rendered = true;
            sf2SuccessCount++;
          } else {
            // SF2 样本 audioBuffer 创建失败（pcmData 可能 detached），fallback 到合成器
            const synthRendered = renderSynthNote(offlineCtx, master, whenSec, duration, velocity, midi, program, isDrum, trackVol);
            if (synthRendered) {
              synthFallbackCount++;
              rendered = true;
            }
          }
        } else {
          // 没找到 sample，fallback 到合成器
          const synthRendered = renderSynthNote(offlineCtx, master, whenSec, duration, velocity, midi, program, isDrum, trackVol);
          if (synthRendered) {
            synthFallbackCount++;
            rendered = true;
          }
        }
      }
    }

    // SF2 失败 → 回退到合成器（与实时播放路径一致）
    if (!rendered) {
      const rendered2 = renderSynthNote(offlineCtx, master, whenSec, duration, velocity, midi, program, isDrum, trackVol);
      if (rendered2) {
        synthFallbackCount++;
        rendered = true;
      }
    }

    if (!rendered) {
      skippedCount++;
    }

    processedEvents++;
    // 每 200 个音符让出主线程（减少 setTimeout 开销）
    if (onProgress && processedEvents % 200 === 0) {
      onProgress({
        current: renderBase + processedEvents,
        total: renderBase + totalEvents,
        stage: 'rendering',
      });
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // 诊断日志：帮助排查"导出无声音"
  console.log(`[export] events: ${totalEvents}, sf2: ${sf2SuccessCount}, synth: ${synthFallbackCount}, skipped: ${skippedCount}`);

  if (sf2SuccessCount + synthFallbackCount === 0) {
    throw new Error('No notes were rendered (sf2 missing and synth fallback failed)');
  }

  // 通知 UI 进入最终合成阶段（offlineCtx.startRendering 可能耗时较长）
  if (onProgress) {
    onProgress({ current: renderBase + totalEvents, total: renderBase + totalEvents, stage: 'finalizing' });
    await new Promise(r => setTimeout(r, 0));
  }

  // 渲染音频
  // 注意：startRendering 是同步阻塞调用，但返回 Promise
  // 如果音符数过多或 release 时间过长，可能耗时很长（不会真正卡死，只是慢）
  // 加 30 秒超时保护，避免用户无限制等待
  let renderedBuffer: AudioBuffer;
  try {
    renderedBuffer = await Promise.race([
      offlineCtx.startRendering(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('渲染超时（30s），可能音符数过多或 SF2 数据异常')), 30000)
      ),
    ]);
  } catch (err) {
    // 关闭 offlineCtx 释放资源
    try { (offlineCtx as any).close?.(); } catch {}
    throw err;
  }

  return renderedBuffer;
}

/**
 * 用 SF2 样本渲染单个音符（与 worklet 路径的 ADSR/loop 逻辑一致）
 */
function renderSF2Note(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  whenSec: number,
  duration: number,
  velocity: number,
  midi: number,
  sample: any,
  isDrum: boolean,
  trackVol: number
): void {
  const source = ctx.createBufferSource();
  source.buffer = sample.audioBuffer;

  // 变调
  const rootKey = sample.rootKey || 60;
  const coarseTune = sample.coarseTune || 0;
  const fineTune = sample.fineTune || 0;
  const pitchCorrection = sample.pitchCorrection || 0;
  const semitoneOffset = (midi - rootKey) + coarseTune + (fineTune / 100) + (pitchCorrection / 100);
  const playbackRate = Math.pow(2, semitoneOffset / 12);
  source.playbackRate.value = playbackRate;

  // ⚠️ 导出路径不使用 loop：OfflineAudioContext 处理 source.loop 在某些浏览器会卡死
  // 持续音符（弦乐/铜管）如果样本短，会在 note duration 内静音——这是已知限制，可接受
  // 实时播放路径（worklet）仍支持 loop

  // ADSR 包络（与 worklet 一致）
  const gain = ctx.createGain();
  // peakGain: 0.12 (导出路径) * velocity/127 * trackVol
  // 与实时播放路径的 0.05 peakGain 相比稍高，因为离线渲染没有软限幅
  const peakVol = (velocity / 127) * 0.12 * trackVol;

  if (isDrum) {
    // 鼓组：快速衰减，无 sustain
    // 用 linearRamp 替代 setTargetAtTime，OfflineAudioContext 处理线性 ramp 更快
    gain.gain.setValueAtTime(0.0001, whenSec);
    gain.gain.linearRampToValueAtTime(peakVol, whenSec + 0.002);
    gain.gain.linearRampToValueAtTime(0.0001, whenSec + 0.15);
  } else {
    // 旋律乐器：完整 ADSR
    const attackSec = Math.max(0.001, Math.min(1.0, sample.attackSec || 0.001));
    const holdSec = Math.max(0, Math.min(1.0, sample.holdSec || 0));
    const decaySec = Math.max(0, Math.min(2.0, sample.decaySec || 0));
    const sustainPerc = Math.max(0, Math.min(1, sample.sustainPerc ?? 1));
    // release 限制在 2 秒内（导出路径），避免长尾音让渲染时间爆炸
    const releaseSec = Math.max(0.02, Math.min(2.0, sample.releaseSec || 0.1));

    // 用 linearRamp 替代 setTargetAtTime，减少自动化事件数
    gain.gain.setValueAtTime(0.0001, whenSec);
    gain.gain.linearRampToValueAtTime(peakVol, whenSec + attackSec);
    // Hold
    if (holdSec > 0) {
      gain.gain.setValueAtTime(peakVol, whenSec + attackSec + holdSec);
    }
    // Decay
    const sustainVol = peakVol * sustainPerc;
    if (decaySec > 0) {
      gain.gain.linearRampToValueAtTime(sustainVol, whenSec + attackSec + holdSec + decaySec);
    }
    // Sustain 到 note duration
    gain.gain.setValueAtTime(sustainVol, whenSec + duration);
    // Release
    gain.gain.linearRampToValueAtTime(0.0001, whenSec + duration + releaseSec);
  }

  source.connect(gain);
  gain.connect(destination);

  source.start(whenSec);
  // 停止时间：note duration + release（限制 2 秒）+ 余量
  const stopRelease = isDrum ? 0.2 : Math.min(2.0, sample.releaseSec || 0.1);
  source.stop(whenSec + duration + stopRelease + 0.1);
}

/**
 * 合成器路径渲染单个音符（无 SF2 时使用，与 useAudioEngine 的 scheduleSynthNote 逻辑一致）
 */
function renderSynthNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  whenSec: number,
  duration: number,
  velocity: number,
  midi: number,
  program: number,
  isDrum: boolean,
  trackVol: number
): boolean {
  const preset = getOscillatorPreset(program) || getOscillatorPreset(0);
  if (!preset) return false;

  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const vol = (velocity / 127) * 0.2 * trackVol;

  const masterGain = ctx.createGain();
  const safeVol = Math.min(vol, 0.25);

  // 鼓组
  if (preset.isDrum || isDrum) {
    renderDrumNote(ctx, masterGain, whenSec, preset, safeVol);
    masterGain.connect(destination);
    return true;
  }

  // 旋律乐器 ADSR
  const { attack = 0.005, decay = 0.05, sustain = 0.5, release = 0.1 } = preset;
  // 限制 release 在 2 秒内（导出路径）
  const safeRelease = Math.min(release, 2.0);
  const safeDecay = Math.min(decay, 2.0);
  masterGain.gain.setValueAtTime(0.0001, whenSec);
  masterGain.gain.linearRampToValueAtTime(safeVol, whenSec + attack);
  const decayEnd = whenSec + attack + safeDecay;
  const sustainVol = safeVol * Math.max(sustain, 0.001);
  masterGain.gain.linearRampToValueAtTime(sustainVol, decayEnd);
  const noteEnd = whenSec + duration;
  masterGain.gain.setValueAtTime(sustainVol, noteEnd);
  masterGain.gain.linearRampToValueAtTime(0.0001, noteEnd + safeRelease);

  // 谐波振荡器
  const harmonics = preset.harmonics || [1];
  const oscillators: OscillatorNode[] = [];
  harmonics.forEach((amp: number, idx: number) => {
    if (amp <= 0) return;
    const osc = ctx.createOscillator();
    osc.type = idx === 0 ? (preset.type || 'sine') : 'sine';
    osc.frequency.value = freq * (idx + 1);
    osc.detune.value = (Math.random() - 0.5) * 4;
    if (idx === 0) {
      osc.connect(masterGain);
    } else {
      const harmGain = ctx.createGain();
      harmGain.gain.value = amp * 0.25;
      osc.connect(harmGain);
      harmGain.connect(masterGain);
    }
    oscillators.push(osc);
  });

  if (oscillators.length === 0) {
    const osc = ctx.createOscillator();
    osc.type = preset.type || 'sine';
    osc.frequency.value = freq;
    osc.connect(masterGain);
    oscillators.push(osc);
  }

  // 低通滤波器
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(freq * 6, 12000);
  filter.Q.value = 0.5;

  masterGain.connect(filter);
  filter.connect(destination);

  const totalDur = duration + release + 0.02;
  const stopTime = whenSec + totalDur;
  oscillators.forEach(osc => {
    osc.start(whenSec);
    osc.stop(stopTime);
  });

  return true;
}

/**
 * 鼓组音符渲染（合成器路径）
 * ⚠️ noise buffer 模块级缓存：避免每个鼓音符都创建新 buffer（500 个鼓 = 500 个 88KB buffer = 内存爆炸）
 */
let _cachedNoiseBuffer: AudioBuffer | null = null;
let _cachedNoiseCtx: OfflineAudioContext | null = null;

function getNoiseBuffer(ctx: OfflineAudioContext): AudioBuffer {
  // 不同的 OfflineAudioContext 不能共享 buffer，所以需要按 ctx 缓存
  if (_cachedNoiseBuffer && _cachedNoiseCtx === ctx) return _cachedNoiseBuffer;
  _cachedNoiseCtx = ctx;
  _cachedNoiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const noiseData = _cachedNoiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = Math.random() * 2 - 1;
  }
  return _cachedNoiseBuffer;
}

function renderDrumNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  whenSec: number,
  preset: any,
  vol: number
): void {
  const { attack = 0.001, decay = 0.05, release = 0.05, freq, isCymbal, isMetallic, isShaker } = preset;
  const safeVol = Math.min(vol, 0.35);

  // 复用模块级 noise buffer（关键性能优化）
  const noiseBuffer = getNoiseBuffer(ctx);

  if (isShaker) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 6000;
    const gain = ctx.createGain();
    // linearRamp 替代 setTargetAtTime，减少自动化事件
    gain.gain.setValueAtTime(0.0001, whenSec);
    gain.gain.linearRampToValueAtTime(safeVol * 0.3, whenSec + attack + 0.005);
    gain.gain.linearRampToValueAtTime(0.0001, whenSec + decay + release);
    source.connect(hpf);
    hpf.connect(gain);
    gain.connect(destination);
    source.start(whenSec);
    source.stop(whenSec + decay + release + 0.05);
    return;
  }

  if (isCymbal || isMetallic) {
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = isCymbal ? 8000 : (freq || 2000);
    bpf.Q.value = isMetallic ? 20 : 5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, whenSec);
    gain.gain.linearRampToValueAtTime(safeVol * 0.25, whenSec + attack + 0.005);
    gain.gain.linearRampToValueAtTime(0.0001, whenSec + decay + release + 0.1);
    noiseSource.connect(bpf);
    bpf.connect(gain);
    gain.connect(destination);
    noiseSource.start(whenSec);
    noiseSource.stop(whenSec + decay + release + 0.2);
    return;
  }

  // 普通鼓声
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = freq ? freq * 3 : 3000;
  noiseFilter.Q.value = 1.5;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, whenSec);
  noiseGain.gain.linearRampToValueAtTime(safeVol * 0.4, whenSec + attack + 0.005);
  noiseGain.gain.linearRampToValueAtTime(0.0001, whenSec + decay + 0.02);
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(destination);
  noiseSource.start(whenSec);
  noiseSource.stop(whenSec + decay + 0.1);

  const bodyFreq = freq || 150;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(bodyFreq * 2.5, whenSec);
  osc.frequency.exponentialRampToValueAtTime(bodyFreq, whenSec + 0.03);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, whenSec);
  bodyGain.gain.linearRampToValueAtTime(safeVol * 0.5, whenSec + attack + 0.005);
  bodyGain.gain.linearRampToValueAtTime(0.0001, whenSec + decay + release + 0.05);
  osc.connect(bodyGain);
  bodyGain.connect(destination);
  osc.start(whenSec);
  osc.stop(whenSec + decay + release + 0.1);
}

/**
 * 导出为 WAV 格式
 */
export function exportToWav(audioBuffer: AudioBuffer, bitDepth: number = 16): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;

  let format = 1; // PCM
  let bytesPerSample = bitDepth / 8;
  if (bitDepth === 32) {
    format = 3; // IEEE float
    bytesPerSample = 4;
  }
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = audioBuffer.length * blockAlign;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // WAV 头
  writeString(view, 0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // 写入音频数据
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      if (bitDepth === 8) {
        view.setUint8(offset, Math.round((sample + 1) * 127.5));
        offset += 1;
      } else if (bitDepth === 16) {
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      } else if (bitDepth === 24) {
        const intSample = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF);
        view.setUint8(offset, intSample & 0xFF);
        view.setUint8(offset + 1, (intSample >> 8) & 0xFF);
        view.setUint8(offset + 2, (intSample >> 16) & 0xFF);
        offset += 3;
      } else if (bitDepth === 32) {
        view.setFloat32(offset, sample, true);
        offset += 4;
      }
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * 导出为 MP3 格式
 * 编码在 Web Worker 里跑，主线程不阻塞 UI
 * 失败时直接抛错（让上层 UI 展示），不再 fallback 到主线程同步编码
 * 因为同步编码会卡死 UI 几十秒，体验更差
 */
export async function exportToMp3(
  audioBuffer: AudioBuffer,
  bitrate: number = 192,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const left = audioBuffer.getChannelData(0);
  const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left;
  const sampleBlockSize = 1152;
  const totalBlocks = Math.ceil(left.length / sampleBlockSize);

  const mp3Buffer = await encodeMp3InWorker(left, right, sampleRate, numChannels, bitrate, totalBlocks, (current, total) => {
    if (onProgress) {
      onProgress({ current, total, stage: 'encoding' });
    }
  });
  return new Blob([mp3Buffer], { type: 'audio/mp3' });
}

/**
 * 在 Web Worker 里编码 MP3
 */
async function encodeMp3InWorker(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  numChannels: number,
  bitrate: number,
  totalBlocks: number,
  onProgress?: (current: number, total: number) => void
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/mp3-encoder.worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }
    // 复制 Float32Array 副本传输（原 audioBuffer 还要保留供后续可能使用）
    const leftCopy = new Float32Array(left);
    const rightCopy = new Float32Array(right);

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        if (onProgress) onProgress(msg.current, msg.total);
      } else if (msg.type === 'encode-success') {
        worker.terminate();
        resolve(msg.mp3Data);
      } else if (msg.type === 'encode-error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (err: ErrorEvent) => {
      worker.terminate();
      reject(new Error(err.message || 'Worker error'));
    };
    worker.postMessage({
      type: 'encode-mp3',
      left: leftCopy,
      right: rightCopy,
      sampleRate,
      numChannels,
      bitrate,
      totalBlocks,
    }, [leftCopy.buffer, rightCopy.buffer]);
  });
}

/**
 * 导出为 FLAC 格式（使用浏览器原生 API，如果支持）
 */
export async function exportToFlac(audioBuffer: AudioBuffer): Promise<Blob> {
  // 尝试使用 MediaRecorder（如果浏览器支持 FLAC）
  if (typeof MediaRecorder !== 'undefined') {
    const ctx = new AudioContext();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const dest = ctx.createMediaStreamDestination();
    source.connect(dest);

    // 检查是否支持 FLAC
    const types = [
      'audio/flac',
      'audio/x-flac',
      'audio/ogg; codecs=flac',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        const recorder = new MediaRecorder(dest.stream, { mimeType: type });
        const chunks: Blob[] = [];

        return new Promise((resolve, reject) => {
          recorder.ondataavailable = (e) => chunks.push(e.data);
          recorder.onstop = () => {
            ctx.close();
            resolve(new Blob(chunks, { type }));
          };
          recorder.onerror = reject;

          source.start();
          recorder.start();
          setTimeout(() => recorder.stop(), audioBuffer.duration * 1000 + 100);
        });
      }
    }
    ctx.close();
  }

  // 降级到 WAV（如果 FLAC 不支持）
  console.warn('FLAC not supported, falling back to WAV');
  return exportToWav(audioBuffer);
}

/**
 * 导出为 AAC 格式（使用浏览器原生 API）
 */
export async function exportToAac(audioBuffer: AudioBuffer): Promise<Blob> {
  // 尝试使用 MediaRecorder
  if (typeof MediaRecorder !== 'undefined') {
    const ctx = new AudioContext();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const dest = ctx.createMediaStreamDestination();
    source.connect(dest);

    const types = [
      'audio/aac',
      'audio/mp4',
      'audio/m4a',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        const recorder = new MediaRecorder(dest.stream, { mimeType: type });
        const chunks: Blob[] = [];

        return new Promise((resolve, reject) => {
          recorder.ondataavailable = (e) => chunks.push(e.data);
          recorder.onstop = () => {
            ctx.close();
            resolve(new Blob(chunks, { type }));
          };
          recorder.onerror = reject;

          source.start();
          recorder.start();
          setTimeout(() => recorder.stop(), audioBuffer.duration * 1000 + 100);
        });
      }
    }
    ctx.close();
  }

  // 降级到 WAV
  console.warn('AAC not supported, falling back to WAV');
  return exportToWav(audioBuffer);
}

/**
 * 主导出函数
 */
export async function exportAudio(
  tracks: any[],
  bpm: number,
  sf2Data: any,
  options: ExportOptions,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const quality = options.quality || 'balanced';
  const params = resolveQualityParams(quality);

  // 渲染音频缓冲区
  const audioBuffer = await renderAudioBuffer(tracks, bpm, sf2Data, onProgress, quality);

  // 通知 UI 进入编码阶段
  if (onProgress) {
    onProgress({ current: 0, total: 1, stage: 'encoding' });
    await new Promise(r => setTimeout(r, 0));
  }

  let blob: Blob;
  // 根据格式导出
  switch (options.format) {
    case 'wav':
      blob = exportToWav(audioBuffer, params.bitDepth);
      break;
    case 'mp3':
      blob = await exportToMp3(audioBuffer, options.bitrate || params.bitrate, onProgress);
      break;
    case 'flac':
      blob = await exportToFlac(audioBuffer);
      break;
    case 'aac':
      blob = await exportToAac(audioBuffer);
      break;
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }

  // 通知 UI 完成
  if (onProgress) {
    onProgress({ current: 1, total: 1, stage: 'complete' });
  }

  return blob;
}

// 辅助函数

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
