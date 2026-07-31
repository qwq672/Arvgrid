// SF2 采样播放 AudioWorklet Processor
// 在音频线程内完成样本读取、playbackRate 变调、ADSR 包络、混音
// 通过单 processor 实例 + voice pool 替代每音符创建 BufferSource+Gain 的节点模型
// 100 个同时发声从 200+ AudioNode 降为 1 个 AudioWorkletNode + 100 个 voice 对象
//
// 注意：本文件由 AudioWorkletGlobalScope 加载（classic script，非 module）
// 不可使用 import/export，但可使用 class 和顶层变量

class SF2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 样本库：id -> { data: Float32Array, sampleRate, length }
    this.samples = new Map();
    // 活跃 voice 池
    this.voices = [];
    // 复音数上限（由主线程通过 set-polyphony 消息控制）
    this.maxPolyphony = 64;
    this._voiceIdCounter = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'load-sample': {
          // data 是 Float32Array（通过 transfer 转移所有权，主线程 pcmData 不受影响）
          this.samples.set(msg.id, {
            data: msg.data,
            sampleRate: msg.sampleRate,
            length: msg.data.length,
          });
          break;
        }
        case 'clear-samples': {
          this.samples.clear();
          this.voices.length = 0;
          break;
        }
        case 'note-on': {
          this._startVoice(msg);
          break;
        }
        case 'note-on-batch': {
          // 批量启动多个 voice（P4 优化）：减少主线程→音频线程的 IPC 次数
          const arr = msg.notes;
          if (arr) {
            for (let i = 0; i < arr.length; i++) {
              this._startVoice(arr[i]);
            }
          }
          break;
        }
        case 'all-notes-off': {
          // 立即静音所有 voice（停止播放/暂停时调用）
          this.voices.length = 0;
          break;
        }
        case 'set-polyphony': {
          this.maxPolyphony = Math.max(1, msg.value | 0);
          break;
        }
        case 'perf-query': {
          this.port.postMessage({
            type: 'perf-report',
            activeVoices: this.voices.length,
            loadedSamples: this.samples.size,
          });
          break;
        }
      }
    };
  }

  _startVoice(msg) {
    const sample = this.samples.get(msg.sampleId);
    if (!sample) return;

    // 复音数限制：超过上限时偷取最早的 voice（FIFO 老化策略）
    while (this.voices.length >= this.maxPolyphony) {
      this.voices.shift();
    }

    const midi = msg.midi;
    const rootKey = (msg.rootKey !== undefined && msg.rootKey !== null) ? msg.rootKey : 60;
    const coarseTune = msg.coarseTune || 0;
    const fineTune = msg.fineTune || 0;
    const pitchCorrection = msg.pitchCorrection || 0;
    const semitoneOffset = (midi - rootKey) + coarseTune + (fineTune / 100) + (pitchCorrection / 100);
    const playbackRate = Math.pow(2, semitoneOffset / 12);

    // 音量缩放：与原 scheduleSF2Sample 一致 (velocity/127 * 0.12)
    const peakGain = (msg.velocity / 127) * 0.12;

    this.voices.push({
      id: this._voiceIdCounter++,
      data: sample.data,
      sampleRate: sample.sampleRate,
      srcLength: sample.length,
      position: 0,
      playbackRate: playbackRate,
      // 绝对开始时间（音频线程 currentTime 域）
      startAtTime: msg.whenSec,
      duration: msg.duration,
      isDrum: !!msg.isDrum,
      peakGain: peakGain,
      state: 'pending',  // pending -> active -> done
      elapsedSamples: 0,
    });
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const numChannels = output.length;
    const blockSize = output[0].length;  // 通常 128（AudioWorklet 量子大小）
    const ctxRate = sampleRate;            // AudioWorkletGlobalScope 全局变量
    const now = currentTime;               // AudioWorkletGlobalScope 全局变量
    const quantumDuration = blockSize / ctxRate;

    // 清零输出缓冲
    for (let ch = 0; ch < numChannels; ch++) {
      output[ch].fill(0);
    }

    if (this.voices.length === 0) return true;

    // 包络时间常数（与原 scheduleSF2Sample 对齐）
    const ATTACK_SEC = 0.020;
    const RELEASE_SEC = 0.080;
    const DRUM_MAX_SEC = 0.5;  // 鼓组最长持续时间（防止过长的鼓样本占用 voice）
    const attackSamples = Math.floor(ATTACK_SEC * ctxRate);
    const releaseSamples = Math.floor(RELEASE_SEC * ctxRate);

    // 遍历所有 voice，将输出累加到 output 缓冲
    const remaining = [];
    for (let v = 0; v < this.voices.length; v++) {
      const voice = this.voices[v];

      // 处理开始时间延迟
      let blockStartOffset = 0;
      if (voice.state === 'pending') {
        // 还没到开始时间，留到下一个 quantum
        if (voice.startAtTime > now + quantumDuration + 0.0001) {
          remaining.push(voice);
          continue;
        }
        // 进入 active 状态
        voice.state = 'active';
        if (voice.startAtTime > now) {
          // 在本 quantum 中途开始
          blockStartOffset = Math.floor((voice.startAtTime - now) * ctxRate);
          if (blockStartOffset >= blockSize) {
            voice.state = 'pending';
            remaining.push(voice);
            continue;
          }
        }
      }

      const srcData = voice.data;
      const srcLen = voice.srcLength;
      const rateRatio = (voice.sampleRate / ctxRate) * voice.playbackRate;
      let durationSamples = Math.floor(voice.duration * ctxRate);
      const peak = voice.peakGain;
      const isDrum = voice.isDrum;

      // 鼓组限制最长持续时间
      if (isDrum) {
        const drumMaxSamples = Math.floor(DRUM_MAX_SEC * ctxRate);
        if (durationSamples > drumMaxSamples) durationSamples = drumMaxSamples;
      }

      // 鼓组使用指数衰减包络；旋律使用 attack->sustain->release
      const voiceReleaseSamples = isDrum
        ? Math.floor(Math.min(durationSamples, DRUM_MAX_SEC * ctxRate))
        : releaseSamples;

      let position = voice.position;
      let elapsed = voice.elapsedSamples;
      let state = voice.state;

      for (let i = blockStartOffset; i < blockSize; i++) {
        if (state === 'done') break;

        // 到达样本末尾
        if (position >= srcLen) {
          state = 'done';
          break;
        }

        // 线性插值读取（实现变调播放）
        const idx = position | 0;
        const frac = position - idx;
        const s0 = srcData[idx];
        const s1 = (idx + 1 < srcLen) ? srcData[idx + 1] : s0;
        const sampleVal = s0 + (s1 - s0) * frac;

        // 包络计算
        let env;
        if (isDrum) {
          // 鼓组：从 peak 开始指数衰减到 0
          if (elapsed < durationSamples) {
            const t = elapsed / Math.max(durationSamples, 1);
            env = peak * Math.pow(1 - t, 2);
            if (env < 0.0001) { env = 0; state = 'done'; }
          } else {
            env = 0;
            state = 'done';
          }
        } else {
          if (elapsed < attackSamples) {
            // Attack 阶段：线性上升
            env = (elapsed / Math.max(attackSamples, 1)) * peak;
          } else if (elapsed < durationSamples) {
            // Sustain 阶段
            env = peak;
          } else if (elapsed < durationSamples + voiceReleaseSamples) {
            // Release 阶段：二次曲线衰减
            const relT = (elapsed - durationSamples) / Math.max(voiceReleaseSamples, 1);
            env = peak * Math.pow(1 - relT, 2);
          } else {
            env = 0;
            state = 'done';
          }
        }

        const out = sampleVal * env;
        // 单声道样本输出到所有通道
        for (let ch = 0; ch < numChannels; ch++) {
          output[ch][i] += out;
        }

        position += rateRatio;
        elapsed++;
      }

      voice.position = position;
      voice.elapsedSamples = elapsed;
      voice.state = state;

      if (state !== 'done') {
        remaining.push(voice);
      }
    }

    this.voices = remaining;
    return true;
  }
}

registerProcessor('sf2-processor', SF2Processor);
