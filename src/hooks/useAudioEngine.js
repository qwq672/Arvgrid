import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { getOscillatorPreset } from '../lib/oscillatorPresets';
import { parseSF2 } from '../lib/sf2Parser';

// 前瞻调度器默认参数
const MAX_POLYPHONY = 20; // 降低复音数上限，减少 CPU 占用

// 缓冲区预设: [lookahead秒, schedulerIntervalMs]
// 更大的 lookahead 和更短的 interval 可以减少卡顿
const BUFFER_PRESETS = {
  short: [0.15, 20],   // 低延迟模式
  medium: [0.3, 25],   // 平衡模式
  long: [0.6, 40],     // 高稳定性模式
};

export function useAudioEngine() {
  const audioCtxRef = useRef(null);
  const masterGainRef = useRef(null);
  const compressorRef = useRef(null);
  const dryGainRef = useRef(null);
  const wetReverbGainRef = useRef(null);
  const wetDelayGainRef = useRef(null);
  const convolverRef = useRef(null);
  const delayNodeRef = useRef(null);
  const delayFeedbackRef = useRef(null);
  const instrumentRef = useRef(null);
  const sf2DataRef = useRef(null);
  const sf2BuffersRef = useRef({});
  const sf2PresetMapRef = useRef(new Map()); // 缓存 program -> preset 映射
  const [soundSource, setSoundSource] = useState('default');
  const [reverbSend, setReverbSend] = useState(0.08);
  const [delaySend, setDelaySend] = useState(0.1);
  const [delayTime, setDelayTime] = useState(0.3);
  const [delayFeedback, setDelayFeedback] = useState(0.2);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const playIntervalRef = useRef(null);
  const schedulerTimerRef = useRef(null);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);
  const noiseBufferRef = useRef(null);
  const reverbSendGainRef = useRef(null);
  const delaySendGainRef = useRef(null);
  const dryGainNodeRef = useRef(null);
  const analyserNodeRef = useRef(null);
  const soundSourceRef = useRef('default');
  const [metronomeOn, setMetronomeOn] = useState(false);
  const metronomeOnRef = useRef(false);
  const bpmRef = useRef(120);
  const [bufferSize, setBufferSizeState] = useState('medium');
  const bufferSizeRef = useRef('medium');
  const lookaheadRef = useRef(0.15);
  const schedulerMsRef = useRef(25);
  const scheduledTimeoutsRef = useRef([]);
  const eventsRef = useRef([]);
  const nextEventIndexRef = useRef(0);
  const nextMetronomeIndexRef = useRef(0);
  const activeNodeGroupsRef = useRef([]);
  const totalDurationRef = useRef(0);
  const [performanceInfo, setPerformanceInfo] = useState({ level: 'low', mem: 0 });
  const schedulerLagCountRef = useRef(0);
  const lastPerfUpdateRef = useRef(0); // 节流性能更新

  useEffect(() => { soundSourceRef.current = soundSource; }, [soundSource]);
  useEffect(() => { metronomeOnRef.current = metronomeOn; }, [metronomeOn]);

  const initAudio = useCallback(async () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.7;
    masterGainRef.current = master;

    // 添加动态压缩器防止爆音
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24; // 阈值 (dB)
    compressor.knee.value = 30; // 拐点范围
    compressor.ratio.value = 12; // 压缩比
    compressor.attack.value = 0.003; // 攻击时间
    compressor.release.value = 0.25; // 释放时间
    compressorRef.current = compressor;

    // 示波器分析器节点 - 插入在 compressor 和 destination 之间
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; // 足够的采样点用于平滑波形显示
    analyser.smoothingTimeConstant = 0.8;
    master.connect(compressor);
    compressor.connect(analyser);
    analyser.connect(ctx.destination);
    analyserNodeRef.current = analyser;

    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    dry.connect(master);
    dryGainRef.current = dry;

    const convolver = ctx.createConvolver();
    convolver.buffer = generateReverbIR(ctx, 0.8, 2.5); // 缩短混响时间，减少 CPU 占用
    convolverRef.current = convolver;

    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.3;
    convolver.connect(reverbGain);
    reverbGain.connect(master);
    wetReverbGainRef.current = reverbGain;

    const delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.3;
    delayNodeRef.current = delayNode;

    const delayGain = ctx.createGain();
    delayGain.gain.value = 0.2;
    wetDelayGainRef.current = delayGain;

    delayNode.connect(delayGain);
    delayGain.connect(master);

    const feedbackGain = ctx.createGain();
    feedbackGain.gain.value = 0;
    delayFeedbackRef.current = feedbackGain;

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }
    noiseBufferRef.current = noiseBuffer;

    const reverbSendGain = ctx.createGain();
    reverbSendGain.gain.value = 1.0;
    reverbSendGain.connect(convolver);
    reverbSendGainRef.current = reverbSendGain;

    const delaySendGain = ctx.createGain();
    delaySendGain.gain.value = 1.0;
    delaySendGain.connect(delayNode);
    delaySendGainRef.current = delaySendGain;

    const dryGainNode = ctx.createGain();
    dryGainNode.gain.value = 1.0;
    dryGainNode.connect(dry);
    dryGainNodeRef.current = dryGainNode;

    return ctx;
  }, []);

  function generateReverbIR(ctx, duration, decay) {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }

  function applyEnvelope(gainNode, startTime, preset, vol, duration) {
    const { attack = 0.005, decay = 0.05, sustain = 0.5, release = 0.1 } = preset;
    const safeVol = Math.min(vol, 0.25);
    const tc = 0.003; // 更短的时间常数，减少拖尾

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.setTargetAtTime(safeVol, startTime, tc);

    const decayEnd = startTime + attack + decay;
    gainNode.gain.setTargetAtTime(safeVol * Math.max(sustain, 0.001), decayEnd, tc);

    const noteEnd = startTime + duration;
    gainNode.gain.setValueAtTime(safeVol * Math.max(sustain, 0.001), noteEnd);
    gainNode.gain.setTargetAtTime(0.0001, noteEnd, tc);

    // 返回相对时长，不是绝对时间
    return duration + release + 0.02;
  }

  // 调度合成器音符 - 返回所有创建的节点用于后续清理
  function scheduleSynthNote(whenSec, pitch, duration, velocity, program) {
    const ctx = audioCtxRef.current;
    if (!ctx) return null;

    const preset = getOscillatorPreset(program) || getOscillatorPreset(0);
    const midi = noteToMidi(pitch);
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const vol = (velocity / 127) * 0.2;

    if (preset.isDrum) {
      return scheduleDrumSound(whenSec, preset, vol, duration);
    }

    const allNodes = [];
    const oscillators = [];
    const sources = [];

    // 使用节点池获取增益节点
    const masterGain = ctx.createGain();
    allNodes.push(masterGain);
    const totalDuration = applyEnvelope(masterGain, whenSec, preset, vol, duration);

    const harmonics = preset.harmonics || [1];
    const activeHarmonics = harmonics.filter(amp => amp > 0);

    // 优化：如果只有一个谐波，直接连接，减少 gain 节点
    if (activeHarmonics.length === 1) {
      const osc = ctx.createOscillator();
      osc.type = preset.type || 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 4;
      osc.connect(masterGain);
      oscillators.push(osc);
    } else {
      // 多个谐波时才使用独立的 gain 节点
      harmonics.forEach((amp, idx) => {
        if (amp <= 0) return;
        const osc = ctx.createOscillator();
        osc.type = idx === 0 ? (preset.type || 'sine') : 'sine';
        osc.frequency.value = freq * (idx + 1);
        osc.detune.value = (Math.random() - 0.5) * 4;
        
        // 对于非基础频率的谐波，使用更简单的连接方式
        if (idx === 0) {
          osc.connect(masterGain);
        } else {
          const harmGain = ctx.createGain();
          harmGain.gain.value = amp * 0.25;
          osc.connect(harmGain);
          harmGain.connect(masterGain);
          allNodes.push(harmGain);
        }
        oscillators.push(osc);
      });
    }

    if (oscillators.length === 0) {
      const osc = ctx.createOscillator();
      osc.type = preset.type || 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 3;
      osc.connect(masterGain);
      oscillators.push(osc);
    }

    // 优化：使用更简单的滤波器设置
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(freq * 6, 12000);
    filter.Q.value = 0.5; // 降低 Q 值，减少计算
    allNodes.push(filter);

    masterGain.connect(filter);
    filter.connect(dryGainNodeRef.current);
    filter.connect(reverbSendGainRef.current);
    filter.connect(delaySendGainRef.current);

    const stopTime = whenSec + totalDuration;
    oscillators.forEach(osc => {
      osc.start(whenSec);
      osc.stop(stopTime);
    });

    return { oscillators, sources, allNodes, stopTime };
  }

  function scheduleDrumSound(whenSec, preset, vol, duration) {
    const ctx = audioCtxRef.current;
    if (!ctx) return null;

    const { attack = 0.001, decay = 0.05, release = 0.05, freq, isCymbal, isMetallic, isShaker } = preset;
    const safeVol = Math.min(vol, 0.35);
    const tc = 0.002;
    const oscillators = [];
    const sources = [];
    const allNodes = [];

    if (isShaker) {
      const source = ctx.createBufferSource();
      source.buffer = noiseBufferRef.current;
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 6000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, whenSec);
      gain.gain.setTargetAtTime(safeVol * 0.3, whenSec + attack, tc);
      gain.gain.setTargetAtTime(0.0001, whenSec + decay + release, tc);
      source.connect(hpf);
      hpf.connect(gain);
      gain.connect(dryGainNodeRef.current);
      gain.connect(reverbSendGainRef.current);
      source.start(whenSec);
      const stopT = whenSec + decay + release + 0.05;
      source.stop(stopT);
      sources.push(source);
      allNodes.push(hpf, gain);
      return { oscillators, sources, allNodes, stopTime: stopT };
    }

    if (isCymbal || isMetallic) {
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBufferRef.current;
      const bpf = ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = isCymbal ? 8000 : (freq || 2000);
      bpf.Q.value = isMetallic ? 20 : 5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, whenSec);
      gain.gain.setTargetAtTime(safeVol * 0.25, whenSec + attack, tc);
      gain.gain.setTargetAtTime(0.0001, whenSec + decay + release + 0.1, tc);
      noiseSource.connect(bpf);
      bpf.connect(gain);
      gain.connect(dryGainNodeRef.current);
      gain.connect(reverbSendGainRef.current);
      const stopT = whenSec + decay + release + 0.2;
      noiseSource.start(whenSec);
      noiseSource.stop(stopT);
      sources.push(noiseSource);
      allNodes.push(bpf, gain);

      if (isMetallic) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq || 2000;
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.0001, whenSec);
        oscGain.gain.setTargetAtTime(safeVol * 0.1, whenSec + attack, tc);
        oscGain.gain.setTargetAtTime(0.0001, whenSec + release + 0.1, tc);
        osc.connect(oscGain);
        oscGain.connect(dryGainNodeRef.current);
        osc.start(whenSec);
        osc.stop(whenSec + release + 0.2);
        oscillators.push(osc);
        allNodes.push(oscGain);
      }
      return { oscillators, sources, allNodes, stopTime: stopT };
    }

    // 普通鼓声
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBufferRef.current;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = freq ? freq * 3 : 3000;
    noiseFilter.Q.value = 1.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, whenSec);
    noiseGain.gain.setTargetAtTime(safeVol * 0.4, whenSec + attack, tc);
    noiseGain.gain.setTargetAtTime(0.0001, whenSec + decay + 0.02, tc);
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(dryGainNodeRef.current);
    noiseGain.connect(reverbSendGainRef.current);
    noiseSource.start(whenSec);
    noiseSource.stop(whenSec + decay + 0.1);
    sources.push(noiseSource);
    allNodes.push(noiseFilter, noiseGain);

    const bodyFreq = freq || 150;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(bodyFreq * 2.5, whenSec);
    osc.frequency.exponentialRampToValueAtTime(bodyFreq, whenSec + 0.03);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, whenSec);
    bodyGain.gain.setTargetAtTime(safeVol * 0.5, whenSec + attack, tc);
    bodyGain.gain.setTargetAtTime(0.0001, whenSec + decay + release + 0.05, tc);
    osc.connect(bodyGain);
    bodyGain.connect(dryGainNodeRef.current);
    bodyGain.connect(reverbSendGainRef.current);
    const stopT = whenSec + decay + release + 0.1;
    osc.start(whenSec);
    osc.stop(stopT);
    oscillators.push(osc);
    allNodes.push(bodyGain);

    return { oscillators, sources, allNodes, stopTime: stopT };
  }

  function scheduleSF2Sample(whenSec, pitch, duration, velocity, program) {
    const ctx = audioCtxRef.current;
    if (!ctx || !sf2DataRef.current) {
      return scheduleSynthNote(whenSec, pitch, duration, velocity, program);
    }

    const midi = noteToMidi(pitch);
    // 降低音量防止削波爆音
    const vol = (velocity / 127) * 0.12;
    
    // 使用缓存的 preset Map 进行 O(1) 查找
    let preset = sf2PresetMapRef.current.get(program);
    if (!preset) {
      const presets = sf2DataRef.current.presets;
      // 优先匹配 bank 0（旋律乐器），避免误选鼓组（bank 128）
      preset = presets.find(p => p.program === program && p.bank === 0)
            || presets.find(p => p.program === program)
            || presets[0];
      if (preset) {
        sf2PresetMapRef.current.set(program, preset);
      }
    }
    
    if (!preset || !preset.sampleIndex) {
      return scheduleSynthNote(whenSec, pitch, duration, velocity, program);
    }

    // 使用预建的 sampleIndex 数组进行 O(1) 查找
    let bestSample = preset.sampleIndex[midi];

    // 如果索引中没有，搜索附近音符（最多偏移 5 个半音）
    if (!bestSample) {
      for (let offset = 1; offset <= 5; offset++) {
        bestSample = preset.sampleIndex[midi + offset] || preset.sampleIndex[midi - offset];
        if (bestSample) break;
      }
    }
    
    // 仍未找到则回退到中央 C
    if (!bestSample) {
      bestSample = preset.sampleIndex[60];
    }

    if (!bestSample) {
      return scheduleSynthNote(whenSec, pitch, duration, velocity, program);
    }

    // 延迟创建 AudioBuffer（按需创建并缓存）
    if (!bestSample.audioBuffer && bestSample.pcmData) {
      try {
        const length = bestSample.pcmData.length;
        const audioBuffer = ctx.createBuffer(1, length, bestSample.sampleRate);
        const channelData = audioBuffer.getChannelData(0);
        const pcm = bestSample.pcmData;
        for (let i = 0; i < length; i++) {
          channelData[i] = pcm[i] / 32768;
        }
        bestSample.audioBuffer = audioBuffer;
      } catch (e) {
        return scheduleSynthNote(whenSec, pitch, duration, velocity, program);
      }
    }

    if (!bestSample.audioBuffer) {
      return scheduleSynthNote(whenSec, pitch, duration, velocity, program);
    }

    const source = ctx.createBufferSource();
    source.buffer = bestSample.audioBuffer;
    const rootKey = bestSample.rootKey || 60;
    
    // 计算播放速率，包含 pitchCorrection
    let playbackRate = Math.pow(2, (midi - rootKey) / 12);
    if (bestSample.pitchCorrection) {
      playbackRate *= Math.pow(2, bestSample.pitchCorrection / 1200);
    }
    source.playbackRate.value = playbackRate;

    const gain = ctx.createGain();
    // 增加包络时间防止爆音：20ms attack, 2ms crossfade 防止爆音, 80ms release
    gain.gain.setValueAtTime(0.0001, whenSec);
    gain.gain.setTargetAtTime(vol, whenSec, 0.020);
    gain.gain.setValueAtTime(vol, whenSec + duration - 0.002);
    gain.gain.setTargetAtTime(0.0001, whenSec + duration, 0.080);

    source.connect(gain);
    gain.connect(dryGainNodeRef.current);
    gain.connect(reverbSendGainRef.current);
    gain.connect(delaySendGainRef.current);

    const stopT = whenSec + duration + 0.1;
    source.start(whenSec);
    source.stop(stopT);

    return { oscillators: [], sources: [source], allNodes: [gain], stopTime: stopT };
  }

  function scheduleMetronomeClick(whenSec, isDownbeat) {
    const ctx = audioCtxRef.current;
    if (!ctx) return null;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = isDownbeat ? 1800 : 1200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, whenSec);
    gain.gain.setTargetAtTime(0.12, whenSec, 0.001);
    gain.gain.setTargetAtTime(0.0001, whenSec + 0.05, 0.005);
    osc.connect(gain);
    gain.connect(masterGainRef.current);
    osc.start(whenSec);
    osc.stop(whenSec + 0.08);
    return { oscillators: [osc], sources: [], allNodes: [gain], stopTime: whenSec + 0.08 };
  }

  // 在音符停止后断开所有节点
  function disconnectNodeGroup(group) {
    if (!group) return;
    try {
      group.allNodes.forEach(n => {
        try {
          n.disconnect();
        } catch(e) {}
      });
      group.oscillators.forEach(o => {
        try {
          o.disconnect();
        } catch(e) {}
      });
      group.sources.forEach(s => {
        try {
          s.disconnect();
        } catch(e) {}
      });
    } catch(e) {}
  }

  // 清理所有活跃节点（停止/暂停时调用）
  const cleanupAllNodes = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    activeNodeGroupsRef.current.forEach(group => {
      if (group.stopTime > now) {
        group.oscillators.forEach(osc => { try { osc.stop(now + 0.01); } catch(e) {} });
        group.sources.forEach(src => { try { src.stop(now + 0.01); } catch(e) {} });
      }
      disconnectNodeGroup(group);
    });
    activeNodeGroupsRef.current = [];
  }, []);

  // 前瞻调度器核心 - 使用自校正 setTimeout
  const runScheduler = useCallback(() => {
    if (!isPlayingRef.current || isPausedRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const now = ctx.currentTime;
    const lookahead = now + lookaheadRef.current;
    const events = eventsRef.current;
    const src = soundSourceRef.current;

    // 性能检测：检查调度器是否延迟
    let schedulerLag = 0;
    if (nextEventIndexRef.current > 0 && nextEventIndexRef.current <= events.length) {
      const nextEvent = events[nextEventIndexRef.current];
      const nextEventScheduled = startTimeRef.current + (nextEvent ? nextEvent.time : 0);
      schedulerLag = Math.max(0, now - nextEventScheduled);
    }

    // 节流更新性能信息（每 500ms 最多更新一次）
    const elapsedSinceLastUpdate = now - lastPerfUpdateRef.current;
    if (elapsedSinceLastUpdate > 0.5) {
      lastPerfUpdateRef.current = now;
      const mem = performance.memory?.usedJSHeapSize / 1048576 || 0;
      let level = 'low';
      if (schedulerLag > 0.15) {
        level = 'critical';
      } else if (schedulerLag > 0.05) {
        level = 'warn';
      } else if (schedulerLag > 0.001) {
        level = 'normal';
      }
      setPerformanceInfo({ level, mem });
    }

    // 清理已完成的节点组 - 原地修改避免 GC
    const groups = activeNodeGroupsRef.current;
    let writeIdx = 0;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].stopTime <= now) {
        disconnectNodeGroup(groups[i]);
      } else {
        groups[writeIdx++] = groups[i];
      }
    }
    groups.length = writeIdx;

    // 调度即将到达的音符
    while (nextEventIndexRef.current < events.length) {
      const ev = events[nextEventIndexRef.current];
      const whenSec = startTimeRef.current + ev.time;

      if (whenSec > lookahead) break;

      // 复音数限制
      if (groups.length >= MAX_POLYPHONY) break;

      let group = null;
      if (src === 'network' && instrumentRef.current) {
        const delayMs = Math.max(0, (whenSec - now) * 1000);
        const tid = setTimeout(() => {
          if (isPlayingRef.current && !isPausedRef.current) {
            const v = (ev.velocity / 127) * 0.5;
            instrumentRef.current.play(ev.pitch, ctx.currentTime, { gain: v, duration: ev.duration });
          }
        }, delayMs);
        scheduledTimeoutsRef.current.push(tid);
      } else if (src === 'sf2' && sf2DataRef.current) {
        group = scheduleSF2Sample(whenSec, ev.pitch, ev.duration, ev.velocity, ev.program);
      } else {
        group = scheduleSynthNote(whenSec, ev.pitch, ev.duration, ev.velocity, ev.program);
      }

      if (group) {
        groups.push(group);
      }

      nextEventIndexRef.current++;
    }

    // 节拍器调度
    if (metronomeOnRef.current) {
      const bpm = bpmRef.current;
      const beatInterval = 60 / bpm;
      const total = totalDurationRef.current;

      while (true) {
        const beatTime = startTimeRef.current + nextMetronomeIndexRef.current * beatInterval;
        if (beatTime > lookahead) break;
        if (beatTime > startTimeRef.current + total) break;

        const isDownbeat = nextMetronomeIndexRef.current % 4 === 0;
        const group = scheduleMetronomeClick(beatTime, isDownbeat);
        if (group) {
          groups.push(group);
        }
        nextMetronomeIndexRef.current++;
      }
    }

    // 自校正 setTimeout：比 setInterval 更精确，不会被浏览器节流
    schedulerTimerRef.current = setTimeout(runScheduler, schedulerMsRef.current);
  }, []);

  // 即时播放一个音符（用于试听）
  const playNote = useCallback(async (pitch, duration, velocity, program = 0) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();

    const when = ctx.currentTime;
    const src = soundSourceRef.current;

    let group = null;
    if (src === 'network' && instrumentRef.current) {
      const vol = (velocity / 127) * 0.5;
      instrumentRef.current.play(pitch, when, { gain: vol, duration });
    } else if (src === 'sf2' && sf2DataRef.current) {
      group = scheduleSF2Sample(when, pitch, duration, velocity, program);
    } else {
      group = scheduleSynthNote(when, pitch, duration, velocity, program);
    }

    // 试听音符也需要跟踪并在结束后清理
    if (group) {
      const cleanupDelay = (group.stopTime - when) * 1000 + 100;
      setTimeout(() => disconnectNodeGroup(group), cleanupDelay);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    isPausedRef.current = false;

    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    if (schedulerTimerRef.current) {
      clearTimeout(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
    scheduledTimeoutsRef.current.forEach(tid => clearTimeout(tid));
    scheduledTimeoutsRef.current = [];

    cleanupAllNodes();

    eventsRef.current = [];
    nextEventIndexRef.current = 0;
    nextMetronomeIndexRef.current = 0;
    pauseTimeRef.current = 0;
    schedulerLagCountRef.current = 0;
    setPerformanceInfo({ level: 'low', mem: 0 });

    setIsPlaying(false);
    setIsPaused(false);
    setCurrentTime(0);
  }, [cleanupAllNodes]);

  const startPlayback = useCallback(async (tracks, bpm = 120) => {
    if (isPlayingRef.current) stopPlayback();
    // 等一帧让 stopPlayback 完成清理
    await new Promise(r => setTimeout(r, 20));

    await initAudio();
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        console.warn('AudioContext resume failed:', e);
      }
    }
    if (!ctx) return;

    bpmRef.current = bpm;
    let events = [];
    tracks.forEach(track => {
      if (track.mute) return;
      track.notes.forEach(note => {
        events.push({
          time: note.startSec,
          duration: note.durationSec,
          pitch: note.pitch,
          velocity: note.velocity,
          program: track.program,
        });
      });
    });
    events.sort((a, b) => a.time - b.time);
    const total = events.length ? Math.max(...events.map(e => e.time + e.duration)) : 0;
    setTotalDuration(total);
    totalDurationRef.current = total;
    if (total === 0) return;

    eventsRef.current = events;
    nextEventIndexRef.current = 0;
    nextMetronomeIndexRef.current = 0;

    const startTime = ctx.currentTime + 0.1;
    startTimeRef.current = startTime;
    pauseTimeRef.current = 0;

    isPlayingRef.current = true;
    isPausedRef.current = false;
    setIsPlaying(true);
    setIsPaused(false);

    // 启动前瞻调度器
    schedulerTimerRef.current = setTimeout(runScheduler, schedulerMsRef.current);

    // 不再用 setInterval 更新 currentTime，改由组件用 requestAnimationFrame 读取
    // 只保留一个检查播放结束的定时器
    playIntervalRef.current = setInterval(() => {
      if (!isPlayingRef.current) return;
      if (isPausedRef.current) return;
      const elapsed = ctx.currentTime - startTime;
      if (elapsed >= total + 0.5) {
        stopPlayback();
      }
    }, 200);
  }, [initAudio, stopPlayback, runScheduler]);

  const pausePlayback = useCallback(() => {
    if (!isPlayingRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    isPausedRef.current = true;
    setIsPaused(true);
    pauseTimeRef.current = ctx.currentTime - startTimeRef.current;

    // 停止调度器
    if (schedulerTimerRef.current) {
      clearTimeout(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }

    // 停止所有正在播放的音符
    cleanupAllNodes();
    scheduledTimeoutsRef.current.forEach(tid => clearTimeout(tid));
    scheduledTimeoutsRef.current = [];
  }, [cleanupAllNodes]);

  const resumePlayback = useCallback(async (tracks, bpm = 120) => {
    if (!isPausedRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    isPausedRef.current = false;
    setIsPaused(false);

    const pauseTime = pauseTimeRef.current;
    bpmRef.current = bpm;

    // 重新计算起始时间，使 pauseTime 对应新的 startTime
    const startTime = ctx.currentTime + 0.05;
    startTimeRef.current = startTime - pauseTime;

    // 重置调度索引，从暂停位置重新开始
    const events = eventsRef.current;
    nextEventIndexRef.current = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i].time >= pauseTime - 0.01) {
        nextEventIndexRef.current = i;
        break;
      }
    }

    // 重置节拍器索引
    const beatInterval = 60 / bpm;
    nextMetronomeIndexRef.current = Math.floor(pauseTime / beatInterval);

    // 重新启动调度器
    schedulerTimerRef.current = setTimeout(runScheduler, schedulerMsRef.current);
  }, [runScheduler]);

  const seekTo = (time) => {
    setCurrentTime(time);
    pauseTimeRef.current = time;
  };

  useEffect(() => {
    initAudio();
    return () => {
      stopPlayback();
    };
  }, [initAudio, stopPlayback]);

  // 获取当前播放时间（供组件读取）
  const getPlaybackTime = useCallback(() => {
    if (!isPlayingRef.current) return 0;
    const ctx = audioCtxRef.current;
    if (!ctx) return 0;
    return Math.max(0, ctx.currentTime - startTimeRef.current);
  }, []);

  // 设置播放缓冲区 - 支持字符串预设或数字直接值
  const setBufferSize = useCallback((size) => {
    if (typeof size === 'number') {
      // 数字: 直接的 lookahead 秒数
      const ms = Math.max(40, Math.min(500, size * 1000));
      lookaheadRef.current = size;
      schedulerMsRef.current = Math.floor(ms / 6); // schedule interval ~ lookahead/6
      setBufferSizeState(size);
    } else {
      const preset = BUFFER_PRESETS[size] || BUFFER_PRESETS.medium;
      bufferSizeRef.current = size;
      lookaheadRef.current = preset[0];
      schedulerMsRef.current = preset[1];
      setBufferSizeState(size);
    }
  }, []);

  return useMemo(() => ({
    playNote,
    startPlayback: (tracks, bpm = 120) => startPlayback(tracks, bpm),
    stopPlayback,
    pausePlayback,
    resumePlayback: (tracks, bpm = 120) => resumePlayback(tracks, bpm),
    isPlaying,
    isPaused,
    currentTime,
    totalDuration,
    getPlaybackTime,
    seekTo,
    reverbSend,
    setReverbSend: (val) => {
      setReverbSend(val);
      if (wetReverbGainRef.current) wetReverbGainRef.current.gain.value = val;
      if (dryGainRef.current) dryGainRef.current.gain.value = Math.max(0, 1 - val * 0.5);
    },
    delaySend,
    setDelaySend: (val) => {
      setDelaySend(val);
      if (wetDelayGainRef.current) wetDelayGainRef.current.gain.value = val;
    },
    delayTime,
    setDelayTime: (val) => {
      setDelayTime(val);
      if (delayNodeRef.current) delayNodeRef.current.delayTime.value = val;
    },
    delayFeedback,
    setDelayFeedback: (val) => {
      setDelayFeedback(val);
      if (delayFeedbackRef.current) delayFeedbackRef.current.gain.value = val;
    },
    audioCtxRef,
    soundSource,
    setSoundSource,
    loadSF2: async (arrayBuffer) => {
      await initAudio();
      try {
        const sf2Data = parseSF2(arrayBuffer, audioCtxRef.current);
        sf2DataRef.current = sf2Data;
        sf2BuffersRef.current = {};
        sf2PresetMapRef.current.clear();
        setSoundSource('sf2');
        // 预热：为第一个 preset 的中央八度预建 AudioBuffer，减少首次播放卡顿
        prewarmSF2Buffers(sf2Data, audioCtxRef.current);
        return { success: true, name: sf2Data.name || 'SF2' };
      } catch (err) {
        console.error('SF2 load failed:', err);
        return { success: false, name: '' };
      }
    },
    sf2Loaded: !!sf2DataRef.current,
    _getSf2Data: () => sf2DataRef.current,
    initAudio,
    metronomeOn,
    setMetronomeOn: (val) => {
      setMetronomeOn(val);
      metronomeOnRef.current = val;
    },
    bufferSize,
    setBufferSize,
    startTimeRef,
    analyserNodeRef,
    performanceInfo,
  }), [playNote, startPlayback, stopPlayback, pausePlayback, resumePlayback, 
      isPlaying, isPaused, currentTime, totalDuration, getPlaybackTime, seekTo,
      reverbSend, delaySend, delayTime, delayFeedback, soundSource, metronomeOn, 
      bufferSize, performanceInfo, initAudio, setSoundSource, setBufferSize]);
}

function noteToMidi(pitch) {
  const m = pitch.match(/^([A-G][#b]?)(\d+)$/);
  if (!m) return 60;
  const map = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11 };
  return (parseInt(m[2])+1)*12 + map[m[1]];
}

// 预热 SF2 AudioBuffer：为第一个 preset 的中央区域音符预建 buffer
// 使用分块处理避免阻塞主线程
function prewarmSF2Buffers(sf2Data, ctx) {
  if (!sf2Data || !sf2Data.presets || !sf2Data.presets.length || !ctx) return;
  // 只预热前 4 个 preset 的中央八度 (48-72)
  const presetsToWarm = sf2Data.presets.slice(0, 4);
  let midi = 48;

  const warmNext = () => {
    if (midi > 72) return;
    for (const preset of presetsToWarm) {
      const sample = preset.sampleIndex[midi];
      if (sample && !sample.audioBuffer && sample.pcmData) {
        try {
          const length = sample.pcmData.length;
          const audioBuffer = ctx.createBuffer(1, length, sample.sampleRate);
          const channelData = audioBuffer.getChannelData(0);
          for (let i = 0; i < length; i++) {
            channelData[i] = sample.pcmData[i] / 32768;
          }
          sample.audioBuffer = audioBuffer;
        } catch (e) {}
      }
    }
    midi++;
    if (midi <= 72) {
      // 分块：每帧处理一个 MIDI 音符，避免阻塞
      requestAnimationFrame(warmNext);
    }
  };
  warmNext();
}
