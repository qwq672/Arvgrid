// SF2 采样播放 AudioWorklet Processor
// 简化版 v9：移除 LFO/双缓冲等复杂优化，回归简洁高效
//
// 核心优化保留：
// - voice 常量预计算（rateRatio/durationSamples/倒数）
// - pending voice 独立队列
// - voice stealing 5ms 淡出
// - voice 对象池
// - Int16 样本支持
// - 线性插值
// - SF2 循环点 + ADSR

const _ATTACK_SAMPLES_DEFAULT = Math.floor(0.020 * sampleRate);
const _RELEASE_SAMPLES_DEFAULT = Math.floor(0.200 * sampleRate);
const _DRUM_MAX_SAMPLES = Math.floor(0.5 * sampleRate);
const _INV_32768 = 1 / 32768;
const _ENV_DONE_THRESHOLD = 0.0000001;

class SF2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Map();
    this.voices = [];
    this.pendingVoices = [];
    this.maxPolyphony = 64;
    this._voiceIdCounter = 0;
    this._fadeoutSamples = Math.floor(0.005 * sampleRate);
    this._fadeoutDecrement = 1 / this._fadeoutSamples;
    this._voicePool = [];
    this._maxPoolSize = 128;

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

    let peakGain = (msg.velocity / 127) * 0.08 * (msg.gainScale ?? 1);
    if (sample.isInt16) peakGain *= _INV_32768;

    const isDrum = !!msg.isDrum;
    const rateRatio = (sample.sampleRate / ctxRate) * playbackRate;
    let durationSamples = Math.floor(msg.duration * ctxRate);
    if (isDrum && durationSamples > _DRUM_MAX_SAMPLES) durationSamples = _DRUM_MAX_SAMPLES;

    let attackSamples, holdSamples, decaySamples, sustainLevel, releaseSamples;
    if (isDrum) {
      attackSamples = 0;
      holdSamples = 0;
      decaySamples = 0;
      sustainLevel = 0;
      releaseSamples = Math.floor(Math.min(durationSamples, _DRUM_MAX_SAMPLES));
    } else {
      attackSamples = Math.floor(Math.min(2.0, Math.max(0, msg.attackSec || 0)) * ctxRate);
      holdSamples = Math.floor(Math.min(2.0, Math.max(0, msg.holdSec || 0)) * ctxRate);
      decaySamples = Math.floor(Math.min(8.0, Math.max(0, msg.decaySec || 0)) * ctxRate);
      sustainLevel = Math.max(0, Math.min(1, msg.sustainPerc ?? 1));
      releaseSamples = Math.floor(Math.min(8.0, Math.max(0.1, msg.releaseSec || 0.2)) * ctxRate);
      if (releaseSamples < _RELEASE_SAMPLES_DEFAULT) releaseSamples = _RELEASE_SAMPLES_DEFAULT;
    }

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
    voice.invRelease = 1 / Math.max(releaseSamples, 1);
    voice.attackSamples = attackSamples;
    voice.holdSamples = holdSamples;
    voice.decaySamples = decaySamples;
    voice.sustainLevel = sustainLevel;
    voice.voiceReleaseSamples = releaseSamples;
    voice.hasLoop = !!msg.hasLoop && !isDrum;
    voice.loopStart = msg.loopStart || 0;
    voice.loopEnd = msg.loopEnd || 0;
    voice.inRelease = false;
    voice.releaseStartGain = 0;

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

    // 激活 pending voices
    if (this.pendingVoices.length > 0) {
      const stillPending = [];
      for (let i = 0; i < this.pendingVoices.length; i++) {
        const v = this.pendingVoices[i];
        if (v.startAtTime <= now + quantumDuration + 0.0001) {
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

    // 渲染所有活跃 voices
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

      const srcData = voice.data;
      const srcLen = voice.srcLength;
      const rateRatio = voice.rateRatio;
      const durationSamples = voice.durationSamples;
      const peak = voice.peakGain;
      const isDrum = voice.isDrum;
      const invDuration = voice.invDuration;
      const invAttack = voice.invAttack;
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

      for (let i = blockStartOffset; i < blockSize; i++) {
        if (state === 'done') break;

        // 循环点处理
        if (!inRelease && hasLoop && position >= loopEnd && loopEnd > loopStart) {
          const loopLen = loopEnd - loopStart;
          position = loopStart + ((position - loopStart) % loopLen);
        }
        if (position >= srcLen) { state = 'done'; break; }

        // 线性插值
        const idx = position | 0;
        const frac = position - idx;
        const s0 = srcData[idx];
        const s1 = (idx + 1 < srcLen) ? srcData[idx + 1] : s0;
        const sampleValue = s0 + (s1 - s0) * frac;

        // 包络计算
        let env;
        if (isDrum) {
          if (elapsed < durationSamples) {
            const inv = 1 - elapsed * invDuration;
            env = peak * inv * inv;
            if (env < _ENV_DONE_THRESHOLD) { env = 0; state = 'done'; }
          } else {
            env = 0; state = 'done';
          }
        } else {
          if (!inRelease && elapsed >= durationSamples) {
            inRelease = true;
            if (elapsed < attackSamples) {
              releaseStartGain = elapsed * invAttack * peak;
            } else if (elapsed < attackSamples + holdSamples) {
              releaseStartGain = peak;
            } else if (elapsed < attackSamples + holdSamples + decaySamples) {
              const decayT = (elapsed - attackSamples - holdSamples) * (1 / Math.max(decaySamples, 1));
              releaseStartGain = peak + (sustainLevel * peak - peak) * decayT;
            } else {
              releaseStartGain = sustainLevel * peak;
            }
            elapsed = 0;
          }

          if (!inRelease) {
            if (elapsed < attackSamples) {
              env = elapsed * invAttack * peak;
            } else if (elapsed < attackSamples + holdSamples) {
              env = peak;
            } else if (elapsed < attackSamples + holdSamples + decaySamples) {
              const decayT = (elapsed - attackSamples - holdSamples) * (1 / Math.max(decaySamples, 1));
              env = peak + (sustainLevel * peak - peak) * decayT;
            } else {
              env = sustainLevel * peak;
            }
          } else {
            const relT = elapsed * invRelease;
            if (relT >= 1) {
              env = 0; state = 'done';
            } else {
              const inv = 1 - relT;
              env = releaseStartGain * inv * inv * inv;
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
        out0[i] += out;
        if (stereo) out1[i] += out;

        position += rateRatio;
        elapsed++;
      }

      voice.position = position;
      voice.elapsedSamples = elapsed;
      voice.state = state;
      voice.fadeout = fadeout;
      voice.fadeoutGain = fadeoutGain;
      voice.inRelease = inRelease;
      voice.releaseStartGain = releaseStartGain;

      if (state !== 'done') {
        remaining.push(voice);
      } else {
        voice.data = null;
        if (pool.length < this._maxPoolSize) pool.push(voice);
      }
    }

    this.voices = remaining;

    // 软限幅（仅在需要时）
    let needClip = false;
    for (let i = 0; i < blockSize; i++) {
      if (out0[i] > 0.95 || out0[i] < -0.95) { needClip = true; break; }
      if (stereo && (out1[i] > 0.95 || out1[i] < -0.95)) { needClip = true; break; }
    }
    if (needClip) {
      const CLIP_THRESH = 0.95;
      const CLIP_RANGE = 0.05;
      for (let i = 0; i < blockSize; i++) {
        let s0 = out0[i];
        if (s0 > CLIP_THRESH) { const e = s0 - CLIP_THRESH; out0[i] = CLIP_THRESH + CLIP_RANGE * e / (CLIP_RANGE + e); }
        else if (s0 < -CLIP_THRESH) { const e = -s0 - CLIP_THRESH; out0[i] = -(CLIP_THRESH + CLIP_RANGE * e / (CLIP_RANGE + e)); }
        if (stereo) {
          let s1 = out1[i];
          if (s1 > CLIP_THRESH) { const e = s1 - CLIP_THRESH; out1[i] = CLIP_THRESH + CLIP_RANGE * e / (CLIP_RANGE + e); }
          else if (s1 < -CLIP_THRESH) { const e = -s1 - CLIP_THRESH; out1[i] = -(CLIP_THRESH + CLIP_RANGE * e / (CLIP_RANGE + e)); }
        }
      }
    }

    return true;
  }
}

registerProcessor('sf2-processor', SF2Processor);
