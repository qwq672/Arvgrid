import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { getOscillatorPreset } from '../lib/oscillatorPresets';
import { parseSF2 } from '../lib/sf2Parser';
import { parseSF2WithWasm, isWasmSupported } from '../lib/wasmBackend';

// 实验性 WASM 后端开关（从 localStorage 读取，默认关闭）
const WASM_ENABLED = (typeof localStorage !== 'undefined') &&
  localStorage.getItem('arvgrid_wasm_backend') === '1';

// 前瞻调度器默认参数
const MAX_POLYPHONY = 32; // 复音数上限（仅限主线程合成器路径）
const MIN_POLYPHONY = 12; // 自适应降级下限
// SF2 worklet 运行在音频线程，复音数与主线程负载无关
// v6: 128 → 64，减少 voice stealing 遍历开销，移动设备更流畅
const WORKLET_POLYPHONY = 64;

// 检测设备 CPU 核心数，用于初始化复音数
const CPU_CORES = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
const INITIAL_POLYPHONY = CPU_CORES <= 2 ? 16 : CPU_CORES <= 4 ? 24 : MAX_POLYPHONY;
const LOW_END_MIN_POLYPHONY = CPU_CORES <= 2 ? 8 : MIN_POLYPHONY;

// 移动设备检测：不能只靠 hardwareConcurrency（big.LITTLE 架构会报告 8 核）
// 需要综合判断：触屏 + 小屏 + UA
const IS_MOBILE = (typeof navigator !== 'undefined' && typeof window !== 'undefined') && (
  // UA 检测
  /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent || '') ||
  // 触屏 + 小屏
  (navigator.maxTouchPoints > 1 && window.innerWidth < 1024)
);

// 缓冲区预设: [lookahead秒, schedulerIntervalMs]
// v9: 进一步降低 scheduler 频率，减少主线程占用
// lookahead 加大让更多音符提前调度，scheduler 间隔放宽
const BUFFER_PRESETS = {
  short: [0.15, 25],   // 低延迟模式：lookahead 150ms，scheduler 25ms
  medium: [0.40, 50],  // 平衡模式（移动设备默认）：50ms 减少主线程占用
  long: [0.6, 60],     // 高稳定性模式
  ultra: [1.0, 80],    // 极致稳定模式（高内存占用）
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
  const [masterVolume, setMasterVolume] = useState(0.7);
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
  // EQ 3 段均衡器
  const eqLowRef = useRef(null);
  const eqMidRef = useRef(null);
  const eqHighRef = useRef(null);
  const [eqLow, setEqLowState] = useState(0);
  const [eqMid, setEqMidState] = useState(0);
  const [eqHigh, setEqHighState] = useState(0);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const metronomeOnRef = useRef(false);
  const bpmRef = useRef(120);
  // 低配设备（2核）或移动设备用更大的缓冲区以减少卡顿
  // 移动设备即使 hardwareConcurrency 报告 8 核（big.LITTLE），实际单核性能远低于桌面
  // 15ms scheduler 在移动设备主线程太密集，会导致 PianoRoll 重绘卡顿
  const initialBufferPreset = (CPU_CORES <= 2 || IS_MOBILE) ? 'medium' : 'short';
  const initialBufferValues = BUFFER_PRESETS[initialBufferPreset];
  const [bufferSize, setBufferSizeState] = useState(initialBufferPreset);
  const bufferSizeRef = useRef(initialBufferPreset);
  const lookaheadRef = useRef(initialBufferValues[0]);
  const schedulerMsRef = useRef(initialBufferValues[1]);
  const scheduledTimeoutsRef = useRef([]);
  const eventsRef = useRef([]);
  const nextEventIndexRef = useRef(0);
  const nextMetronomeIndexRef = useRef(0);
  const activeNodeGroupsRef = useRef([]);
  const totalDurationRef = useRef(0);
  const [performanceInfo, setPerformanceInfo] = useState({ level: 'low', mem: 0 });
  const schedulerLagCountRef = useRef(0);
  const lastPerfUpdateRef = useRef(0); // 节流性能更新
  const lastPerfLevelRef = useRef('low'); // 仅在 level 变化时触发 re-render
  const adaptivePolyphonyRef = useRef(INITIAL_POLYPHONY); // 自适应复音数（根据 CPU 核心数初始化）
  const noteBusRef = useRef(null); // 共享音符总线，减少每个音符的连接数
  const workletNodeRef = useRef(null); // SF2 AudioWorkletNode（单节点替代所有 per-note 节点）
  const workletReadyRef = useRef(false); // worklet 是否已成功注册并加载
  const workletSampleIdCounterRef = useRef(0); // worklet sample ID 计数器
  const workletBackendRef = useRef('js'); // 'js' 或 'wasm'

  useEffect(() => { soundSourceRef.current = soundSource; }, [soundSource]);
  useEffect(() => { metronomeOnRef.current = metronomeOn; }, [metronomeOn]);

  // 内部方法：加载 JS worklet（原 SF2 processor）
  const loadJsWorkletImpl = useCallback(async (ctx, noteBus) => {
    try {
      // v7: 修复音符断裂 click 声——release 三次方衰减 + 记录进入时增益 + 默认 200ms
      const workletUrl = new URL('worklets/sf2-processor.js?v=8', location.href).href;
      await ctx.audioWorklet.addModule(workletUrl);
      const workletNode = new AudioWorkletNode(ctx, 'sf2-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      workletNode.connect(noteBus);
      workletNodeRef.current = workletNode;
      workletReadyRef.current = true;
      workletBackendRef.current = 'js';
      // 初始复音数同步到 worklet
      workletNode.port.postMessage({
        type: 'set-polyphony',
        value: WORKLET_POLYPHONY,
      });
    } catch (err) {
      console.warn('AudioWorklet 加载失败，SF2 播放将受影响:', err);
      workletReadyRef.current = false;
    }
  }, []);

  const initAudio = useCallback(async () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    // 移动设备限制 sampleRate 到 44100Hz（默认可能是 48000）
    // CPU 占用减少 ~10%，音质差异人耳难察觉
    const ctxOptions = { latencyHint: 'interactive' };
    if (IS_MOBILE) {
      ctxOptions.sampleRate = 44100;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)(ctxOptions);
    audioCtxRef.current = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.7;
    masterGainRef.current = master;

    // 添加动态压缩器防止爆音
    // 调整：release 从 0.1s 降到 0.05s，让快速连续音符更清晰，避免"糊"
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12; // 阈值 (dB) — 更低阈值捕获更多峰值
    compressor.knee.value = 12; // 拐点范围 — 较硬拐点
    compressor.ratio.value = 20; // 压缩比 — 接近限制器
    compressor.attack.value = 0.001; // 攻击时间 — 1ms 快速响应瞬态
    compressor.release.value = 0.05; // 释放时间 — 50ms 更短，避免尾音糊
    compressorRef.current = compressor;

    // 示波器分析器节点 - 插入在 compressor 和 destination 之间
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024; // 降低每帧遍历开销（2048→1024 减半）
    analyser.smoothingTimeConstant = 0.8;

    // 3 段均衡器（低/中/高）—— v9 新增
    // 插在 master 之后、compressor 之前，所有音频都经过 EQ
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 200;
    eqLow.gain.value = 0;  // dB，-12 ~ +12
    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1.0;
    eqMid.gain.value = 0;
    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 5000;
    eqHigh.gain.value = 0;
    eqLowRef.current = eqLow;
    eqMidRef.current = eqMid;
    eqHighRef.current = eqHigh;

    master.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(compressor);
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

    // 共享音符总线：合成器/鼓组等仍使用 AudioNode 路径连接到此处；
    // SF2 worklet 节点也连接到此处（单节点替代所有 per-note BufferSource+Gain）
    const noteBus = ctx.createGain();
    noteBus.gain.value = 1.0;
    noteBus.connect(dryGainNode);
    noteBus.connect(reverbSendGain);
    noteBus.connect(delaySendGain);
    noteBusRef.current = noteBus;

    // 注册 SF2 AudioWorklet：单 processor 实例 + 内部 voice pool
    // v8: 根据 WASM_ENABLED 选择 JS worklet 或 WASM worklet
    if (WASM_ENABLED && isWasmSupported()) {
      try {
        const workletUrl = new URL('worklets/wasm-sf2-processor.js?v=7', location.href).href;
        await ctx.audioWorklet.addModule(workletUrl);
        const workletNode = new AudioWorkletNode(ctx, 'wasm-sf2-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        workletNode.connect(noteBus);
        workletNodeRef.current = workletNode;
        workletReadyRef.current = true;
        workletBackendRef.current = 'wasm';
        console.log('[arvgrid] WASM SF2 worklet loaded');

        // 预加载 WASM 字节：主线程 fetch 后传给 worklet
        // 修复：用相对路径 fetch，避免 GitHub Pages 自定义域名 301 重定向到 http 导致混合内容阻止
        workletNode.port.addEventListener('message', async (e) => {
          if (e.data?.type === 'request-wasm-bytes') {
            try {
              console.log('[arvgrid] worklet requested wasm bytes, fetching...');
              // 用相对路径：浏览器会跟随 301 重定向，且保持 https
              // 之前用 new URL('wasm/...') 会产生绝对 URL，重定向到 http 导致混合内容阻止
              const resp = await fetch('wasm/audio_core_bg.wasm');
              if (!resp.ok) {
                throw new Error(`Failed to fetch wasm: ${resp.status}`);
              }
              const wasmBytes = await resp.arrayBuffer();
              console.log('[arvgrid] sending wasm bytes to worklet:', wasmBytes.byteLength);
              workletNode.port.postMessage({
                type: 'init-wasm-bytes',
                wasmBytes,
              }, [wasmBytes]);
            } catch (err) {
              console.error('[arvgrid] failed to fetch wasm bytes for worklet:', err);
              workletNode.port.postMessage({
                type: 'init-wasm-bytes',
                error: err.message,
              });
            }
          }
        });
      } catch (err) {
        console.warn('[arvgrid] WASM worklet failed, fallback to JS worklet:', err);
        await loadJsWorkletImpl(ctx, noteBus);
      }
    } else {
      await loadJsWorkletImpl(ctx, noteBus);
    }

    return ctx;
  }, [loadJsWorkletImpl]);

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
  // trackVol: 0-1 通道音量缩放（P2 防爆音）
  function scheduleSynthNote(whenSec, pitch, duration, velocity, program, trackVol = 1) {
    const ctx = audioCtxRef.current;
    if (!ctx) return null;

    const preset = getOscillatorPreset(program) || getOscillatorPreset(0);
    const midi = noteToMidi(pitch);
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const vol = (velocity / 127) * 0.2 * trackVol;

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
    filter.connect(noteBusRef.current);

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
      gain.connect(noteBusRef.current);
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
      gain.connect(noteBusRef.current);
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
        oscGain.connect(noteBusRef.current);
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
    noiseGain.connect(noteBusRef.current);
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
    bodyGain.connect(noteBusRef.current);
    const stopT = whenSec + decay + release + 0.1;
    osc.start(whenSec);
    osc.stop(stopT);
    oscillators.push(osc);
    allNodes.push(bodyGain);

    return { oscillators, sources, allNodes, stopTime: stopT };
  }

  function scheduleSF2Sample(whenSec, pitch, duration, velocity, program, isDrum, batchBuffer, trackVol = 1) {
    const ctx = audioCtxRef.current;
    // v8: WASM backend 批量调度，避免大量 setTimeout 导致主线程卡顿
    if (workletBackendRef.current === 'wasm' && workletReadyRef.current && workletNodeRef.current) {
      const midi = noteToMidi(pitch);
      const channel = isDrum ? 9 : 0;  // GM 鼓组在 channel 9
      // 收集到 batchBuffer，由调用方一次性发送
      // 不再用 setTimeout 逐个调度，避免密集音符时主线程被定时器淹没
      const noteMsg = {
        type: 'note-on',
        channel,
        key: midi,
        velocity,
        whenSec,         // 调度时间
        duration,        // 音符时长（用于 note-off 调度）
      };
      if (batchBuffer) {
        batchBuffer.push(noteMsg);
      } else {
        // 单音符试听场景：直接发送
        workletNodeRef.current.port.postMessage(noteMsg);
      }
      // 返回轻量占位 group
      const stopT = whenSec + duration + 0.15;
      return { oscillators: [], sources: [], allNodes: [], stopTime: stopT, worklet: true };
    }

    if (!ctx || !sf2DataRef.current) {
      return scheduleSynthNote(whenSec, pitch, duration, velocity, program, trackVol);
    }

    // worklet 未就绪时回退到合成器
    if (!workletReadyRef.current || !workletNodeRef.current) {
      return scheduleSynthNote(whenSec, pitch, duration, velocity, program, trackVol);
    }

    const midi = noteToMidi(pitch);

    // 鼓组使用 bank 128，旋律乐器使用 bank 0
    const cacheKey = isDrum ? `drum_${program}` : `melodic_${program}`;

    let preset = sf2PresetMapRef.current.get(cacheKey);
    if (!preset) {
      const presets = sf2DataRef.current.presets;
      if (isDrum) {
        // 鼓组：优先 bank 128，然后任意 bank 的同 program
        preset = presets.find(p => p.program === program && p.bank === 128)
              || presets.find(p => p.bank === 128)
              || presets.find(p => p.program === program);
      } else {
        // 旋律乐器：优先 bank 0 精确匹配，然后非鼓组同 program，
        // 最后回退到 Acoustic Grand Piano (program 0, bank 0) 而非 presets[0]（可能是鼓组）
        preset = presets.find(p => p.program === program && p.bank === 0)
              || presets.find(p => p.program === program && p.bank !== 128)
              || presets.find(p => p.program === program)
              || presets.find(p => p.bank === 0 && p.program === 0)
              || presets.find(p => p.bank === 0)
              || presets.find(p => p.bank !== 128)
              || presets[0];
      }
      if (preset) {
        sf2PresetMapRef.current.set(cacheKey, preset);
      }
    }

    if (!preset || !preset.sampleIndex) {
      return scheduleSynthNote(whenSec, pitch, duration, velocity, program, trackVol);
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
      return scheduleSynthNote(whenSec, pitch, duration, velocity, program, trackVol);
    }

    // 样本数据未传输到 worklet（应在 loadSF2 时已传输），回退到合成器
    if (bestSample.workletSampleId === undefined) {
      return scheduleSynthNote(whenSec, pitch, duration, velocity, program, trackVol);
    }

    // 发送 noteOn 消息到 worklet，由音频线程完成样本读取、变调、包络、混音
    // 不再创建任何 AudioNode —— 所有处理在 worklet 内完成
    // P4 优化：若提供 batchBuffer，则收集消息由调用方批量发送，避免逐音符 postMessage
    const noteMsg = {
      type: 'note-on',
      sampleId: bestSample.workletSampleId,
      whenSec: whenSec,
      duration: duration,
      velocity: velocity,
      midi: midi,
      rootKey: bestSample.rootKey || 60,
      coarseTune: bestSample.coarseTune || 0,
      fineTune: bestSample.fineTune || 0,
      pitchCorrection: bestSample.pitchCorrection || 0,
      gainScale: trackVol,
      isDrum: !!isDrum,
      // SF2 循环点（持续音符如弦乐/铜管不会过早结束）
      hasLoop: !!bestSample.hasLoop,
      loopStart: bestSample.loopStart || 0,
      loopEnd: bestSample.loopEnd || 0,
      // SF2 真实 ADSR（秒，0 表示用默认值）
      attackSec: bestSample.attackSec || 0,
      holdSec: bestSample.holdSec || 0,
      decaySec: bestSample.decaySec || 0,
      sustainPerc: bestSample.sustainPerc ?? 1,
      releaseSec: bestSample.releaseSec || 0,
    };
    if (batchBuffer) {
      batchBuffer.push(noteMsg);
    } else {
      workletNodeRef.current.port.postMessage(noteMsg);
    }

    // 返回轻量占位 group，保持与现有 cleanup 逻辑兼容
    // oscillators/sources/allNodes 均为空数组，disconnectNodeGroup 是 no-op
    const stopT = whenSec + duration + 0.15;
    return { oscillators: [], sources: [], allNodes: [], stopTime: stopT, worklet: true };
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
      // worklet 占位 group 没有 AudioNode 需要停止
      if (!group.worklet) {
        if (group.stopTime > now) {
          group.oscillators.forEach(osc => { try { osc.stop(now + 0.01); } catch(e) {} });
          group.sources.forEach(src => { try { src.stop(now + 0.01); } catch(e) {} });
        }
        disconnectNodeGroup(group);
      }
    });
    activeNodeGroupsRef.current = [];
    // 立即静音 worklet 中所有活跃 voice
    if (workletReadyRef.current && workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: 'all-notes-off' });
    }
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

    // 节流更新性能信息（每 2 秒最多更新一次，减少 React re-render）
    // 优化：只在 level 真正变化时才 setState，避免无谓 re-render
    const elapsedSinceLastUpdate = now - lastPerfUpdateRef.current;
    if (elapsedSinceLastUpdate > 2.0) {
      lastPerfUpdateRef.current = now;
      const mem = performance.memory?.usedJSHeapSize / 1048576 || 0;
      let level = 'low';
      let polyphonyChanged = false;
      if (schedulerLag > 0.15) {
        level = 'critical';
        const newPoly = Math.max(LOW_END_MIN_POLYPHONY, adaptivePolyphonyRef.current - 4);
        if (newPoly !== adaptivePolyphonyRef.current) {
          adaptivePolyphonyRef.current = newPoly;
          polyphonyChanged = true;
        }
      } else if (schedulerLag > 0.05) {
        level = 'warn';
        const newPoly = Math.max(LOW_END_MIN_POLYPHONY, adaptivePolyphonyRef.current - 2);
        if (newPoly !== adaptivePolyphonyRef.current) {
          adaptivePolyphonyRef.current = newPoly;
          polyphonyChanged = true;
        }
      } else if (schedulerLag > 0.001) {
        level = 'normal';
      } else {
        if (adaptivePolyphonyRef.current < MAX_POLYPHONY) {
          adaptivePolyphonyRef.current = Math.min(MAX_POLYPHONY, adaptivePolyphonyRef.current + 1);
          polyphonyChanged = true;
        }
      }
      // 只在 level 变化时才 setState，减少 React re-render 链
      if (lastPerfLevelRef.current !== level) {
        lastPerfLevelRef.current = level;
        setPerformanceInfo({ level, mem });
      }
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
    // 优化：worklet 占位 group 不再 push 到 activeNodeGroupsRef，避免数组膨胀
    // 只有合成器路径（scheduleSynthNote）才需要跟踪 AudioNode 用于 cleanup
    const sf2BatchBuffer = (src === 'sf2' && workletReadyRef.current && workletNodeRef.current) ? [] : null;

    while (nextEventIndexRef.current < events.length) {
      const ev = events[nextEventIndexRef.current];
      const whenSec = startTimeRef.current + ev.time;

      if (whenSec > lookahead) break;

      // 复音数限制（自适应）——仅对合成器路径生效
      // SF2 worklet 内部管理 voice stealing，不需要主线程限制
      const polyLimit = (src === 'sf2') ? 1024 : adaptivePolyphonyRef.current;
      if (groups.length >= polyLimit) break;

      let group = null;
      if (src === 'network' && instrumentRef.current) {
        const delayMs = Math.max(0, (whenSec - now) * 1000);
        const tv = ev.trackVol ?? 1;
        const tid = setTimeout(() => {
          if (isPlayingRef.current && !isPausedRef.current) {
            const v = (ev.velocity / 127) * 0.5 * tv;
            instrumentRef.current.play(ev.pitch, ctx.currentTime, { gain: v, duration: ev.duration });
          }
        }, delayMs);
        scheduledTimeoutsRef.current.push(tid);
      } else if (src === 'sf2' && (sf2DataRef.current || workletBackendRef.current === 'wasm')) {
        group = scheduleSF2Sample(whenSec, ev.pitch, ev.duration, ev.velocity, ev.program, ev.isDrum, sf2BatchBuffer, ev.trackVol ?? 1);
      } else {
        group = scheduleSynthNote(whenSec, ev.pitch, ev.duration, ev.velocity, ev.program, ev.trackVol ?? 1);
      }

      // 只有合成器路径的 group 才需要跟踪（worklet group 是轻量占位，不需要 cleanup）
      if (group && !group.worklet) {
        groups.push(group);
      }

      nextEventIndexRef.current++;
    }

    // 一次性发送批量 note-on（减少 postMessage 次数）
    if (sf2BatchBuffer && sf2BatchBuffer.length > 0) {
      workletNodeRef.current.port.postMessage({ type: 'note-on-batch', notes: sf2BatchBuffer });
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
  // trackVol: 0-1 通道音量缩放（可选，P2）
  const playNote = useCallback(async (pitch, duration, velocity, program = 0, isDrum = false, trackVol = 1) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();

    const when = ctx.currentTime;
    const src = soundSourceRef.current;

    let group = null;
    if (src === 'network' && instrumentRef.current) {
      const vol = (velocity / 127) * 0.5 * trackVol;
      instrumentRef.current.play(pitch, when, { gain: vol, duration });
    } else if (src === 'sf2' && (sf2DataRef.current || workletBackendRef.current === 'wasm')) {
      // WASM 模式 sf2DataRef 可能为 null（rustysynth 内部管理），但 soundSource 仍是 'sf2'
      group = scheduleSF2Sample(when, pitch, duration, velocity, program, isDrum, null, trackVol);
    } else {
      group = scheduleSynthNote(when, pitch, duration, velocity, program, trackVol);
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
      clearTimeout(playIntervalRef.current);
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
      // P2 通道音量：0-100 映射为 0-1 增益缩放，用于防止多轨叠加爆音
      const trackVol = Math.max(0, Math.min(1, (track.volume ?? 80) / 100));
      track.notes.forEach(note => {
        events.push({
          time: note.startSec,
          duration: note.durationSec,
          pitch: note.pitch,
          velocity: note.velocity,
          program: track.program,
          isDrum: track.isDrum || false,
          trackVol,
        });
      });
    });
    events.sort((a, b) => a.time - b.time);
    let total = 0;
    for (let i = 0; i < events.length; i++) {
      const end = events[i].time + events[i].duration;
      if (end > total) total = end;
    }
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

    // 播放结束检查：用 setTimeout 链而非 setInterval，减少定时器数量
    // 500ms 检查一次足够（比 200ms 稀疏，减少主线程定时器唤醒）
    const checkPlaybackEnd = () => {
      if (!isPlayingRef.current || isPausedRef.current) return;
      const elapsed = ctx.currentTime - startTime;
      if (elapsed >= total + 0.5) {
        stopPlayback();
      } else {
        playIntervalRef.current = setTimeout(checkPlaybackEnd, 500);
      }
    };
    playIntervalRef.current = setTimeout(checkPlaybackEnd, 500);
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
    if (isPausedRef.current) return pauseTimeRef.current;
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
    // EQ 3 段均衡器（-12 ~ +12 dB）
    eqLow,
    setEqLow: (val) => {
      setEqLowState(val);
      if (eqLowRef.current) eqLowRef.current.gain.value = val;
    },
    eqMid,
    setEqMid: (val) => {
      setEqMidState(val);
      if (eqMidRef.current) eqMidRef.current.gain.value = val;
    },
    eqHigh,
    setEqHigh: (val) => {
      setEqHighState(val);
      if (eqHighRef.current) eqHighRef.current.gain.value = val;
    },
    audioCtxRef,
    soundSource,
    setSoundSource,
    loadSF2: async (arrayBuffer, onProgress) => {
      await initAudio();
      try {
        // v8: 根据 worklet backend 选择加载方式
        // WASM backend：整个 SF2 文件传给 worklet，rustysynth 内部解析
        // JS backend：主线程/worker 解析后传 sample 给 worklet
        if (onProgress) onProgress({ stage: 'parsing', percent: 0 });

        if (workletBackendRef.current === 'wasm' && workletReadyRef.current && workletNodeRef.current) {
          // WASM 路径：传 SF2 字节给 WASM worklet，等待 worklet 确认加载成功
          if (onProgress) onProgress({ stage: 'wasm-loading', percent: 50 });

          const sf2Copy = arrayBuffer.slice(0);
          try {
            await new Promise((resolve, reject) => {
              const handler = (e) => {
                const msg = e.data;
                if (msg.type === 'load-success') {
                  workletNodeRef.current.port.removeEventListener('message', handler);
                  resolve();
                } else if (msg.type === 'load-error') {
                  workletNodeRef.current.port.removeEventListener('message', handler);
                  reject(new Error(msg.message || 'WASM SF2 load failed'));
                }
              };
              workletNodeRef.current.port.addEventListener('message', handler);
              workletNodeRef.current.port.postMessage({
                type: 'load-sf2',
                data: sf2Copy,
              }, [sf2Copy]);
              // 超时保护（30 秒）——超时后自动 fallback 到 JS 路径
              setTimeout(() => {
                workletNodeRef.current?.port.removeEventListener('message', handler);
                reject(new Error('WASM SF2 load timeout (30s)'));
              }, 30000);
            });

            if (onProgress) onProgress({ stage: 'done', percent: 100, backend: 'wasm' });
            sf2DataRef.current = null;
            sf2PresetMapRef.current.clear();
            setSoundSource('sf2');
            return { success: true, name: 'SF2 (WASM)' };
          } catch (wasmErr) {
            // WASM 失败时自动 fallback 到 JS 路径，不报错给用户
            console.warn('[arvgrid] WASM SF2 load failed, falling back to JS:', wasmErr.message);
            if (onProgress) onProgress({ stage: 'wasm-fallback', message: wasmErr.message });
            // 重新加载 JS worklet（之前加载的是 WASM worklet）
            const ctx = audioCtxRef.current;
            if (ctx && noteBusRef.current) {
              if (workletNodeRef.current) {
                try { workletNodeRef.current.disconnect(); } catch(e) {}
                workletNodeRef.current = null;
              }
              workletReadyRef.current = false;
              await loadJsWorkletImpl(ctx, noteBusRef.current);
            }
          }
        }

        // JS 路径：用 Web Worker 解析
        let sf2Data;
        let parseMs = 0;
        try {
          const result = await parseSF2InWorker(arrayBuffer, (p) => {
            if (onProgress) onProgress({ stage: 'parsing', percent: p });
          });
          sf2Data = result.sf2Data;
          parseMs = result.parseMs;
        } catch (err) {
          console.warn('[arvgrid] SF2 worker failed, fallback to main thread:', err);
          sf2Data = parseSF2(arrayBuffer, audioCtxRef.current);
        }
        if (onProgress) onProgress({ stage: 'parsing', percent: 100, parseMs, backend: 'js' });

        sf2DataRef.current = sf2Data;
        sf2BuffersRef.current = {};
        sf2PresetMapRef.current.clear();
        adaptivePolyphonyRef.current = MAX_POLYPHONY;
        setSoundSource('sf2');

        // 阶段 2：将样本数据传输到 worklet（分批进行，不阻塞 UI）
        if (workletReadyRef.current && workletNodeRef.current) {
          workletNodeRef.current.port.postMessage({ type: 'clear-samples' });
          await sendSamplesToWorklet(sf2Data, workletNodeRef.current, workletSampleIdCounterRef, (p) => {
            if (onProgress) onProgress({ stage: 'transferring', percent: p });
          });
          workletNodeRef.current.port.postMessage({
            type: 'set-polyphony',
            value: adaptivePolyphonyRef.current,
          });
        }
        if (onProgress) onProgress({ stage: 'done', percent: 100 });

        return { success: true, name: sf2Data.name || 'SF2' };
      } catch (err) {
        console.error('SF2 load failed:', err);
        if (onProgress) onProgress({ stage: 'error', message: err?.message || String(err) });
        return { success: false, name: '', error: err?.message || String(err) };
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
    masterVolume,
    setMasterVolume: (vol) => {
      setMasterVolume(vol);
      if (masterGainRef.current) {
        masterGainRef.current.gain.setValueAtTime(vol, audioCtxRef.current?.currentTime || 0);
      }
    },
    startTimeRef,
    analyserNodeRef,
    performanceInfo,
  }), [playNote, startPlayback, stopPlayback, pausePlayback, resumePlayback,
      isPlaying, isPaused, currentTime, totalDuration, getPlaybackTime, seekTo,
      reverbSend, delaySend, delayTime, delayFeedback, eqLow, eqMid, eqHigh, soundSource, metronomeOn,
      bufferSize, performanceInfo, initAudio, setSoundSource, setBufferSize, masterVolume]);
}

function noteToMidi(pitch) {
  const m = pitch.match(/^([A-G][#b]?)(\d+)$/);
  if (!m) return 60;
  const map = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11 };
  return (parseInt(m[2])+1)*12 + map[m[1]];
}

// 在 Web Worker 里解析 SF2，避免阻塞主线程
// Worker 通过 Vite 自动 chunk 化，运行时是纯本地后台线程
// Worker 加载失败（极旧浏览器）会抛出异常，调用方应回退到主线程 parseSF2
async function parseSF2InWorker(arrayBuffer, onProgress) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('../workers/sf2-parser.worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }
    const cleanup = () => {
      worker.terminate();
    };
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'parse-success') {
        cleanup();
        // sf2Data 里的 sampleObj.pcmData 已经被 transfer，原主线程副本不可用
        // 但 worker 返回的 sf2Data 是结构化克隆 + transferable 后的新引用，主线程可直接用
        resolve({ sf2Data: msg.sf2Data, parseMs: msg.parseMs });
      } else if (msg.type === 'parse-error') {
        cleanup();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (err) => {
      cleanup();
      reject(new Error(err.message || 'Worker error'));
    };
    // 不传 transferList：让结构化克隆完整复制 arrayBuffer
    // worker 解析完后会再 postMessage 回主线程，再传一次（也是结构化克隆）
    // 400MB SF2 多 100-200ms 开销可接受，避免 transferable 导致的 detached buffer 问题
    worker.postMessage({ type: 'parse-sf2', arrayBuffer });
  });
}

// 将 SF2 样本数据传输到 AudioWorklet
// 分批进行以避免阻塞主线程；通过 transferable 转移 Int16Array 所有权到 worklet
// 保留主线程的 pcmData (Int16Array) 供 audioExport.ts 离线渲染使用
// 注意：从 worker 返回的 pcmData 是 transferable 后的新引用，这里传输时会再次 transfer，
//      所以 audioExport.ts 读到的 pcmData 会变 null，但 audioExport 已做兜底（重新解析或回退合成器）
async function sendSamplesToWorklet(sf2Data, workletNode, idCounterRef, onProgress) {
  if (!sf2Data || !sf2Data.presets || !workletNode) return;

  // 按 pcmData 引用去重：同一 pcmData 可能被多个 sampleObj 共享（不同 zone 有不同音高参数）
  // 但每个 sampleObj 需要记录自己的 workletSampleId 以便 noteOn 时查找
  const pcmMap = new Map();  // pcmData(Int16Array) -> { id, pcmData, sampleRate, sampleObjs: [] }

  for (const preset of sf2Data.presets) {
    if (!preset.sampleIndex) continue;
    for (let m = 0; m < 128; m++) {
      const sampleObj = preset.sampleIndex[m];
      if (!sampleObj || !sampleObj.pcmData) continue;

      let entry = pcmMap.get(sampleObj.pcmData);
      if (!entry) {
        const id = idCounterRef.current++;
        entry = {
          id,
          pcmData: sampleObj.pcmData,
          sampleRate: sampleObj.sampleRate,
          sampleObjs: [],
        };
        pcmMap.set(sampleObj.pcmData, entry);
      }
      entry.sampleObjs.push(sampleObj);
    }
  }

  if (pcmMap.size === 0) return;

  const tasks = Array.from(pcmMap.values());
  const total = tasks.length;
  const BATCH_SIZE = 8;

  for (let i = 0; i < tasks.length; i++) {
    const entry = tasks[i];
    const pcmData = entry.pcmData;
    // 防御：检查 pcmData 是否已 detached（极少数情况，比如内存压力下浏览器回收）
    // detached 的 Int16Array length 为 0，构造新 Int16Array 会抛 detached 错误
    let length;
    try {
      length = pcmData.length;
    } catch (e) {
      console.warn('[arvgrid] sample pcmData detached, skipping:', e.message);
      continue;
    }
    if (length === 0) continue;

    // 直接传输 Int16Array 副本（2字节/样本），worklet 内部用预乘 _INV_32768 转换
    // 相比 Float32Array（4字节/样本）节省 50% worklet 内存，且零额外 CPU 开销
    // v7: 传输后释放主线程 pcmData（设为 null），让 GC 回收，降低内存占用
    // audioExport.ts 有合成器 fallback，pcmData 为 null 时自动用合成器渲染
    const int16Copy = new Int16Array(pcmData);

    workletNode.port.postMessage({
      type: 'load-sample',
      id: entry.id,
      data: int16Copy,
      sampleRate: entry.sampleRate,
      isInt16: true,
    }, [int16Copy.buffer]);

    // 传输完成后释放主线程 pcmData（降低内存：100MB SF2 不再占用 800MB）
    for (let k = 0; k < entry.sampleObjs.length; k++) {
      entry.sampleObjs[k].pcmData = null;
      entry.sampleObjs[k].workletSampleId = entry.id;
    }

    // 进度回调
    if (onProgress && ((i + 1) % BATCH_SIZE === 0 || i === total - 1)) {
      onProgress(Math.round(((i + 1) / total) * 100));
    }

    // 每 BATCH_SIZE 个样本让出主线程一次，避免长时间阻塞 UI
    if ((i + 1) % BATCH_SIZE === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }
}
