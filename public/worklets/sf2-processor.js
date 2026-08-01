// SF2 采样播放 AudioWorklet Processor
// 在音频线程内完成样本读取、playbackRate 变调、ADSR 包络、混音
//
// 性能优化：
// - voice 常量在创建时预计算（rateRatio/durationSamples/倒数），避免每 quantum 重复
// - 内循环用乘法替代除法（预计算 1/x）
// - pending voice 独立队列，不参与每帧渲染遍历
// - 复 poly 计数仅在上限附近才触发（O(n) Rarely runs）
// - voice stealing 用 5ms 线性淡出替代硬切，消除 click
// - 声道展开，避免内循环 for 分支
// - 旋律 release 尾声早期终止（env < 阈值 → done）
// - voice 对象池（消除 GC 压力）
// - 支持 Int16Array 样本（内存减半，零额外 CPU：32768inv 预乘入 peakGain）

// 包络常量（全局预计算）
const _ATTACK_SAMPLES = Math.floor(0.020 * sampleRate);
const _RELEASE_SAMPLES = Math.floor(0.080 * sampleRate);
const _DRUM_MAX_SAMPLES = Math.floor(0.5 * sampleRate);
const _INV_32768 = 1 / 32768;  // Int16 → Float32 转换因子

class SF2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Map();
    this.voices = [];
    this.pendingVoices = [];
    this.maxPolyphony = 128;
    this._voiceIdCounter = 0;
    this._fadeoutSamples = Math.floor(0.005 * sampleRate);
    this._fadeoutDecrement = 1 / this._fadeoutSamples;
    // Voice 对象池：复用已完成 voice 的对象，消除 GC 压力
    this._voicePool = [];

    this.port.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'load-sample': {
          this.samples.set(msg.id, {
            data: msg.data,
            isInt16: !!msg.isInt16,
            sampleRate: msg.sampleRate,
            length: msg.data.length,
          });
          break;
        }
        case 'clear-samples': {
          this.samples.clear();
          this.voices.length = 0;
          this.pendingVoices.length = 0;
          break;
        }
        case 'note-on': {
          this._startVoice(msg);
          break;
        }
        case 'note-on-batch': {
          const arr = msg.notes;
          if (arr) {
            for (let i = 0; i < arr.length; i++) {
              this._startVoice(arr[i]);
            }
          }
          break;
        }
        case 'all-notes-off': {
          this.voices.length = 0;
          this.pendingVoices.length = 0;
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

    const midi = msg.midi;
    const rootKey = (msg.rootKey !== undefined && msg.rootKey !== null) ? msg.rootKey : 60;
    const coarseTune = msg.coarseTune || 0;
    const fineTune = msg.fineTune || 0;
    const pitchCorrection = msg.pitchCorrection || 0;
    const semitoneOffset = (midi - rootKey) + coarseTune + (fineTune / 100) + (pitchCorrection / 100);
    const playbackRate = Math.pow(2, semitoneOffset / 12);
    const ctxRate = sampleRate;

    // peakGain：Int16 样本需预乘 _INV_32768 转为 Float 范围
    // 0.08 per voice，配合软削波和压缩器防止多音叠加爆音
    // gainScale: 通道音量（P2），0-1 缩放每轨增益防止多轨叠加爆音
    let peakGain = (msg.velocity / 127) * 0.08 * (msg.gainScale ?? 1);
    if (sample.isInt16) peakGain *= _INV_32768;

    const isDrum = !!msg.isDrum;

    // 预计算 per-voice 常量
    const rateRatio = (sample.sampleRate / ctxRate) * playbackRate;
    let durationSamples = Math.floor(msg.duration * ctxRate);
    if (isDrum && durationSamples > _DRUM_MAX_SAMPLES) durationSamples = _DRUM_MAX_SAMPLES;
    const voiceReleaseSamples = isDrum
      ? Math.floor(Math.min(durationSamples, _DRUM_MAX_SAMPLES))
      : _RELEASE_SAMPLES;

    // 从对象池获取 voice 对象（消除 GC）
    let voice = this._voicePool.pop();
    if (!voice) voice = {};

    voice.data = sample.data;
    voice.srcLength = sample.length;
    voice.position = 0;
    voice.rateRatio = rateRatio;
    voice.startAtTime = msg.whenSec;
    voice.durationSamples = durationSamples;
    voice.isDrum = isDrum;
    voice.peakGain = peakGain;
    voice.state = 'pending';
    voice.elapsedSamples = 0;
    voice.fadeout = 0;
    voice.fadeoutGain = 1;
    voice.invDuration = 1 / Math.max(durationSamples, 1);
    voice.invAttack = 1 / Math.max(_ATTACK_SAMPLES, 1);
    voice.invRelease = 1 / Math.max(voiceReleaseSamples, 1);
    voice.attackSamples = _ATTACK_SAMPLES;
    voice.voiceReleaseSamples = voiceReleaseSamples;

    this.pendingVoices.push(voice);
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const numChannels = output.length;
    const blockSize = output[0].length;
    const ctxRate = sampleRate;
    const now = currentTime;
    const quantumDuration = blockSize / ctxRate;
    const stereo = numChannels >= 2;
    const out0 = output[0];
    const out1 = stereo ? output[1] : out0;
    const fadeoutSamples = this._fadeoutSamples;
    const fadeoutDecrement = this._fadeoutDecrement;
    const pool = this._voicePool;

    // 清零输出
    for (let ch = 0; ch < numChannels; ch++) output[ch].fill(0);

    // 1. 激活 pending voices
    if (this.pendingVoices.length > 0) {
      const stillPending = [];
      for (let i = 0; i < this.pendingVoices.length; i++) {
        const v = this.pendingVoices[i];
        if (v.startAtTime <= now + quantumDuration + 0.0001) {
          // 仅在接近复音上限时才遍历计数 + steal
          if (this.voices.length >= this.maxPolyphony) {
            let activeCount = 0;
            for (let j = 0; j < this.voices.length; j++) {
              if (this.voices[j].fadeout === 0) activeCount++;
            }
            while (activeCount >= this.maxPolyphony) {
              let stolen = false;
              for (let j = 0; j < this.voices.length; j++) {
                if (this.voices[j].fadeout === 0) {
                  this.voices[j].fadeout = fadeoutSamples;
                  this.voices[j].fadeoutGain = 1;
                  activeCount--;
                  stolen = true;
                  break;
                }
              }
              if (!stolen) break;
            }
          }
          this.voices.push(v);
        } else {
          stillPending.push(v);
        }
      }
      this.pendingVoices = stillPending;
    }

    if (this.voices.length === 0) return true;

    // 2. 渲染所有活跃 voices
    const remaining = [];
    const voices = this.voices;
    const numVoices = voices.length;

    for (let v = 0; v < numVoices; v++) {
      const voice = voices[v];

      let blockStartOffset = 0;
      if (voice.state === 'pending') {
        if (voice.startAtTime > now + quantumDuration + 0.0001) {
          remaining.push(voice);
          continue;
        }
        voice.state = 'active';
        if (voice.startAtTime > now) {
          blockStartOffset = Math.floor((voice.startAtTime - now) * ctxRate);
          if (blockStartOffset >= blockSize) {
            voice.state = 'pending';
            remaining.push(voice);
            continue;
          }
        }
      }

      // 从 voice 读取预计算常量
      const srcData = voice.data;
      const srcLen = voice.srcLength;
      const rateRatio = voice.rateRatio;
      const durationSamples = voice.durationSamples;
      const peak = voice.peakGain;  // Int16 时已含 _INV_32768 缩放
      const isDrum = voice.isDrum;
      const invDuration = voice.invDuration;
      const invAttack = voice.invAttack;
      const invRelease = voice.invRelease;
      const attackSamples = voice.attackSamples;
      const voiceReleaseSamples = voice.voiceReleaseSamples;

      let position = voice.position;
      let elapsed = voice.elapsedSamples;
      let state = voice.state;
      let fadeout = voice.fadeout;
      let fadeoutGain = voice.fadeoutGain;

      for (let i = blockStartOffset; i < blockSize; i++) {
        if (state === 'done') break;
        if (position >= srcLen) { state = 'done'; break; }

        // 线性插值（Int16/Float32 通用，peakGain 已含转换因子）
        const idx = position | 0;
        const frac = position - idx;
        const s0 = srcData[idx];
        const s1 = (idx + 1 < srcLen) ? srcData[idx + 1] : s0;

        // 包络计算（预计算倒数，乘法替代除法）
        let env;
        if (isDrum) {
          if (elapsed < durationSamples) {
            const inv = 1 - elapsed * invDuration;
            env = peak * inv * inv;
            if (env < 0.0000001) { env = 0; state = 'done'; }
          } else {
            env = 0; state = 'done';
          }
        } else {
          if (elapsed < attackSamples) {
            env = elapsed * invAttack * peak;
          } else if (elapsed < durationSamples) {
            env = peak;
          } else if (elapsed < durationSamples + voiceReleaseSamples) {
            const relT = (elapsed - durationSamples) * invRelease;
            const inv = 1 - relT;
            env = peak * inv * inv;
            if (env < 0.0000001) { env = 0; state = 'done'; }
          } else {
            env = 0; state = 'done';
          }
        }

        // Voice stealing 淡出
        if (fadeout > 0) {
          env *= fadeoutGain;
          fadeoutGain -= fadeoutDecrement;
          if (fadeoutGain <= 0) { env = 0; state = 'done'; }
          fadeout--;
        }

        const out = (s0 + (s1 - s0) * frac) * env;
        // 声道展开
        if (stereo) {
          out0[i] += out;
          out1[i] += out;
        } else {
          out0[i] += out;
        }

        position += rateRatio;
        elapsed++;
      }

      voice.position = position;
      voice.elapsedSamples = elapsed;
      voice.state = state;
      voice.fadeout = fadeout;
      voice.fadeoutGain = fadeoutGain;

      if (state !== 'done') {
        remaining.push(voice);
      } else {
        // 回收到对象池（消除 GC）
        voice.data = null;
        pool.push(voice);
      }
    }

    this.voices = remaining;

    // 软削波保护：防止多音叠加导致硬削波爆音
    // x / (1 + |x|) 的近似 — 仅对超过 0.99 的样本做软压缩，零额外开销
    for (let i = 0; i < blockSize; i++) {
      let s0 = out0[i];
      if (s0 > 0.99) out0[i] = 0.99 + (s0 - 0.99) * 0.15;
      else if (s0 < -0.99) out0[i] = -0.99 + (s0 + 0.99) * 0.15;
      if (stereo) {
        let s1 = out1[i];
        if (s1 > 0.99) out1[i] = 0.99 + (s1 - 0.99) * 0.15;
        else if (s1 < -0.99) out1[i] = -0.99 + (s1 + 0.99) * 0.15;
      }
    }

    return true;
  }
}

registerProcessor('sf2-processor', SF2Processor);
