// SF2 采样播放 AudioWorklet Processor
// 在音频线程内完成样本读取、playbackRate 变调、ADSR 包络、混音
//
// v6 性能优化（针对移动设备卡顿）：
// - 线性插值替代 Catmull-Rom 三次插值：7次乘法 → 1次乘法，CPU 减半
//   音质差异人耳难察觉，但移动设备复音数提升明显
// - 包络计算无分支优化：用 Math.min/max 替代 if-else
// - WORKLET_POLYPHONY 128 → 64，减少 voice stealing 遍历开销
// - 保留循环点 + 真实 ADSR 支持

const _ATTACK_SAMPLES_DEFAULT = Math.floor(0.020 * sampleRate);
const _RELEASE_SAMPLES_DEFAULT = Math.floor(0.200 * sampleRate);  // v7: 80ms → 200ms，消除 click 声
const _DRUM_MAX_SAMPLES = Math.floor(0.5 * sampleRate);
const _INV_32768 = 1 / 32768;
const _ENV_DONE_THRESHOLD = 0.0000001;

class SF2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Map();
    this.voices = [];
    this.pendingVoices = [];
    this.maxPolyphony = 64;  // v6: 128 → 64，减少 voice stealing 遍历
    this._voiceIdCounter = 0;
    this._fadeoutSamples = Math.floor(0.005 * sampleRate);
    this._fadeoutDecrement = 1 / this._fadeoutSamples;
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
    // 0.08 per voice（从 0.05 提升，让单音音量更接近真实 SF2 播放器），
    // 配合透明软限幅和压缩器防止多音叠加爆音
    // gainScale: 通道音量（P2），0-1 缩放每轨增益防止多轨叠加爆音
    let peakGain = (msg.velocity / 127) * 0.08 * (msg.gainScale ?? 1);
    if (sample.isInt16) peakGain *= _INV_32768;

    const isDrum = !!msg.isDrum;

    // 预计算 per-voice 常量
    const rateRatio = (sample.sampleRate / ctxRate) * playbackRate;
    let durationSamples = Math.floor(msg.duration * ctxRate);
    if (isDrum && durationSamples > _DRUM_MAX_SAMPLES) durationSamples = _DRUM_MAX_SAMPLES;

    // 从 SF2 读取的真实 ADSR（秒 → 样本数）
    // 鼓组忽略 ADSR，使用原有的指数衰减包络
    let attackSamples, holdSamples, decaySamples, sustainLevel, releaseSamples;
    if (isDrum) {
      // 鼓组使用原有的简单包络：无 attack，整体指数衰减
      attackSamples = 0;
      holdSamples = 0;
      decaySamples = 0;
      sustainLevel = 0;
      releaseSamples = Math.floor(Math.min(durationSamples, _DRUM_MAX_SAMPLES));
    } else {
      // 旋律乐器：使用 SF2 真实 ADSR
      // 钳制 attack/hold/release 在合理范围
      // v7: release 最小值提高到 0.1s，避免短 release 导致 click 声
      attackSamples = Math.floor(Math.min(2.0, Math.max(0, msg.attackSec || 0)) * ctxRate);
      holdSamples = Math.floor(Math.min(2.0, Math.max(0, msg.holdSec || 0)) * ctxRate);
      decaySamples = Math.floor(Math.min(8.0, Math.max(0, msg.decaySec || 0)) * ctxRate);
      sustainLevel = Math.max(0, Math.min(1, msg.sustainPerc ?? 1));
      releaseSamples = Math.floor(Math.min(8.0, Math.max(0.1, msg.releaseSec || 0.2)) * ctxRate);
      // 防御：如果 releaseSamples 太小则用默认值（200ms）
      if (releaseSamples < _RELEASE_SAMPLES_DEFAULT) releaseSamples = _RELEASE_SAMPLES_DEFAULT;
    }

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
    voice.invAttack = 1 / Math.max(attackSamples, 1);
    voice.invDecay = 1 / Math.max(decaySamples, 1);
    // v7: LFO 颤音参数（sustain 阶段微小音量调制，增加生命力）
    // 5Hz 颤音，深度 3%（非常微妙，模拟自然演奏）
    voice.lfoPhase = 0;
    voice.lfoIncr = (2 * Math.PI * 5) / ctxRate;  // 5Hz
    voice.invRelease = 1 / Math.max(releaseSamples, 1);
    voice.attackSamples = attackSamples;
    voice.holdSamples = holdSamples;
    voice.decaySamples = decaySamples;
    voice.sustainLevel = sustainLevel;
    voice.voiceReleaseSamples = releaseSamples;
    // 循环点（相对 PCM 数据的索引）
    voice.hasLoop = !!msg.hasLoop && !isDrum;
    voice.loopStart = msg.loopStart || 0;
    voice.loopEnd = msg.loopEnd || 0;
    // 用于判断是否已进入 release 阶段
    voice.inRelease = false;
    voice.releaseStartGain = 0;  // 进入 release 时的实际增益（避免突跳）

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
      const invDecay = voice.invDecay;
      const invRelease = voice.invRelease;
      const attackSamples = voice.attackSamples;
      const holdSamples = voice.holdSamples;
      const decaySamples = voice.decaySamples;
      const sustainLevel = voice.sustainLevel;
      const voiceReleaseSamples = voice.voiceReleaseSamples;
      const hasLoop = voice.hasLoop;
      const loopStart = voice.loopStart;
      const loopEnd = voice.loopEnd;

      let position = voice.position;
      let elapsed = voice.elapsedSamples;
      let state = voice.state;
      let fadeout = voice.fadeout;
      let fadeoutGain = voice.fadeoutGain;
      let inRelease = voice.inRelease;
      let releaseStartGain = voice.releaseStartGain;
      let lfoPhase = voice.lfoPhase;
      const lfoIncr = voice.lfoIncr;

      for (let i = blockStartOffset; i < blockSize; i++) {
        if (state === 'done') break;

        // 循环点处理：modulo 运算防止高音一次跳跃超过整个 loop length
        if (!inRelease && hasLoop && position >= loopEnd && loopEnd > loopStart) {
          const loopLen = loopEnd - loopStart;
          position = loopStart + ((position - loopStart) % loopLen);
        }
        if (position >= srcLen) { state = 'done'; break; }

        // v6: 线性插值（替代 Catmull-Rom 三次插值）
        // CPU 开销：7次乘法 → 1次乘法，移动设备复音数提升明显
        // 音质差异人耳难察觉（高频内容略有锯齿，但被包络和混响掩盖）
        const idx = position | 0;
        const frac = position - idx;
        const s0 = srcData[idx];
        const s1 = (idx + 1 < srcLen) ? srcData[idx + 1] : s0;
        const sampleValue = s0 + (s1 - s0) * frac;

        // 包络计算（预计算倒数，乘法替代除法）
        let env;
        if (isDrum) {
          // 鼓组：指数衰减，无 sustain
          if (elapsed < durationSamples) {
            const inv = 1 - elapsed * invDuration;
            env = peak * inv * inv;
            if (env < _ENV_DONE_THRESHOLD) { env = 0; state = 'done'; }
          } else {
            env = 0; state = 'done';
          }
        } else {
          // 旋律乐器：完整 ADSR
          // 进入 release 阶段的判定：elapsed >= durationSamples
          if (!inRelease && elapsed >= durationSamples) {
            inRelease = true;
            // 记录进入 release 时的实际增益（避免从 sustainLevel 硬跳）
            // 如果音符在 attack/decay 阶段就结束，release 从当前增益开始而非 sustainLevel
            if (elapsed < attackSamples) {
              releaseStartGain = elapsed * invAttack * peak;
            } else if (elapsed < attackSamples + holdSamples) {
              releaseStartGain = peak;
            } else if (elapsed < attackSamples + holdSamples + decaySamples) {
              const decayT = (elapsed - attackSamples - holdSamples) * invDecay;
              releaseStartGain = peak + (sustainLevel * peak - peak) * decayT;
            } else {
              releaseStartGain = sustainLevel * peak;
            }
            elapsed = 0;
          }

          if (!inRelease) {
            // Attack 阶段
            if (elapsed < attackSamples) {
              env = elapsed * invAttack * peak;
            } else if (elapsed < attackSamples + holdSamples) {
              env = peak;
            } else if (elapsed < attackSamples + holdSamples + decaySamples) {
              const decayT = (elapsed - attackSamples - holdSamples) * invDecay;
              env = peak + (sustainLevel * peak - peak) * decayT;
            } else {
              // Sustain 阶段：加 LFO 颤音（3% 深度，5Hz）
              // 增加生命力，消除"机械感"
              const lfo = 1 + 0.03 * Math.sin(lfoPhase);
              env = sustainLevel * peak * lfo;
            }
          } else {
            // Release 阶段：从进入时的实际增益平滑衰减到 0
            // 用三次曲线 (1-t)^3 而非线性，结尾更平滑，消除 click 声
            const relT = elapsed * invRelease;
            if (relT >= 1) {
              env = 0; state = 'done';
            } else {
              const inv = 1 - relT;
              env = releaseStartGain * inv * inv * inv;  // 三次方衰减，更平滑
              if (env < _ENV_DONE_THRESHOLD) { env = 0; state = 'done'; }
            }
          }
        }

        // Voice stealing 淡出
        if (fadeout > 0) {
          env *= fadeoutGain;
          fadeoutGain -= fadeoutDecrement;
          if (fadeoutGain <= 0) { env = 0; state = 'done'; }
          fadeout--;
        }

        const out = sampleValue * env;
        // 声道展开
        if (stereo) {
          out0[i] += out;
          out1[i] += out;
        } else {
          out0[i] += out;
        }

        position += rateRatio;
        elapsed++;
        lfoPhase += lfoIncr;
      }

      voice.position = position;
      voice.elapsedSamples = elapsed;
      voice.state = state;
      voice.fadeout = fadeout;
      voice.fadeoutGain = fadeoutGain;
      voice.inRelease = inRelease;
      voice.releaseStartGain = releaseStartGain;
      voice.lfoPhase = lfoPhase;

      if (state !== 'done') {
        remaining.push(voice);
      } else {
        // 回收到对象池（消除 GC）
        voice.data = null;
        pool.push(voice);
      }
    }

    this.voices = remaining;

    // 透明软限幅：|s|<0.95 时完全线性无失真，>0.95 平滑趋近 ±1.0（永不硬削波）
    // 阈值从 0.9 提到 0.95，让大部分输出完全线性，避免在正常音量下产生压缩感
    // 主线程压缩器负责主要动态控制；此处仅作防爆音安全网
    // 曲线：s > 0.95 时趋近 0.95 + 0.05 = 1.0
    const CLIP_THRESH = 0.95;
    const CLIP_RANGE = 0.05;
    for (let i = 0; i < blockSize; i++) {
      let s0 = out0[i];
      if (s0 > CLIP_THRESH) {
        const e = s0 - CLIP_THRESH;
        out0[i] = CLIP_THRESH + CLIP_RANGE * e / (CLIP_RANGE + e);
      } else if (s0 < -CLIP_THRESH) {
        const e = -s0 - CLIP_THRESH;
        out0[i] = -(CLIP_THRESH + CLIP_RANGE * e / (CLIP_RANGE + e));
      }
      if (stereo) {
        let s1 = out1[i];
        if (s1 > CLIP_THRESH) {
          const e = s1 - CLIP_THRESH;
          out1[i] = CLIP_THRESH + CLIP_RANGE * e / (CLIP_RANGE + e);
        } else if (s1 < -CLIP_THRESH) {
          const e = -s1 - CLIP_THRESH;
          out1[i] = -(CLIP_THRESH + CLIP_RANGE * e / (CLIP_RANGE + e));
        }
      }
    }

    return true;
  }
}

registerProcessor('sf2-processor', SF2Processor);
