// 工程生成器：根据参数生成 arvgrid v3 工程文件

import { parseKey, SCALES, CHORD_PROGRESSIONS, generateChordNotes, generateMelody, midiToNoteName, createRng, ROMAN_TO_SCALE } from './theory.js';
import { PRESETS } from './presets.js';

let trackIdCounter = 1;

function genId() {
  return trackIdCounter++;
}

export function generateProject(opts) {
  trackIdCounter = 1;
  
  // 应用预设
  if (opts.preset && PRESETS[opts.preset]) {
    const preset = PRESETS[opts.preset];
    opts = { ...preset, ...opts }; // 命令行参数覆盖预设
  }

  const { rootMidi, scaleName } = parseKey(opts.key);
  const scale = SCALES[opts.scale] || SCALES.major;
  const rng = createRng(opts.seed);
  
  // BPM 映射
  const tempoMap = { slow: 70, medium: 110, fast: 140 };
  const bpm = opts.bpm || tempoMap[opts.tempo] || 120;

  // 选择和弦进行
  const moodKey = opts.mood || 'happy';
  const scaleType = scaleName === 'minor' ? 'minor' : 'major';
  const progressions = CHORD_PROGRESSIONS[scaleType]?.[moodKey] || CHORD_PROGRESSIONS.major.happy;
  const progression = progressions[Math.floor(rng() * progressions.length)];

  // 生成段落
  const tracks = [];
  const trackConfigs = opts.tracks || [
    { program: 0, name: 'Piano', role: 'melody' },
    { program: 48, name: 'Strings', role: 'pad' },
    { program: 0, name: 'Drums', role: 'drums', isDrum: true },
  ];

  for (const config of trackConfigs) {
    const track = generateTrack(config, rootMidi, scale, progression, opts, rng, bpm);
    if (track.notes.length > 0) {
      tracks.push(track);
    }
  }

  // 生成工程文件（arvgrid v3 格式）
  return {
    v: 3,
    tracks: tracks.map((t, idx) => ({
      id: t.id,
      n: t.name,
      p: t.program,
      v: 80,
      pn: 64,
      m: 0,
      g: '',
      r: 0,
      c: TRACK_COLORS[idx % TRACK_COLORS.length],
      ch: t.channel ?? idx,
      fx: null,
      notes: t.notes.map(n => ({
        p: midiToNoteName(n.midi),
        s: Math.round(n.startSec * 1000) / 1000,
        d: Math.round(n.durationSec * 1000) / 1000,
        v: n.velocity,
      })),
    })),
    bpm,
    meta: {
      title: opts.title || `${opts.preset || opts.key} ${opts.mood} ${bpm}BPM`,
      artist: opts.artist || 'Arvgrid CLI',
      singer: '',
      copyright: '',
    },
  };
}

const TRACK_COLORS = ['#339af0', '#ff6b6b', '#ff922b', '#fcc419', '#51cf66', '#20c997', '#845ef7', '#e64980'];

function generateTrack(config, rootMidi, scale, progression, opts, rng, bpm) {
  const track = {
    id: genId(),
    name: config.name || `Track ${config.program}`,
    program: config.program || 0,
    channel: config.channel,
    notes: [],
  };

  const beatSec = 60 / bpm;
  let sectionTime = 0;

  for (let s = 0; s < opts.sections; s++) {
    for (let b = 0; b < opts.bars; b++) {
      const barStart = sectionTime + b * beatSec * 4;
      const progIdx = b % progression.length;
      const chordStr = progression[progIdx];
      const chordDegree = ROMAN_TO_SCALE[chordStr] ?? 0;
      const isMinorChord = chordStr === chordStr.toLowerCase();

      if (config.role === 'melody') {
        // 旋律：基于音阶随机生成
        for (let beat = 0; beat < 4; beat++) {
          if (rng() < 0.75) {
            const scaleIdx = Math.floor(rng() * scale.length);
            const octave = 4 + (config.isDrum ? 0 : Math.floor(rng() * 2));
            const midi = rootMidi + (octave + 1) * 12 + scale[scaleIdx % scale.length];
            const dur = (1 + Math.floor(rng() * 2)) * beatSec * 0.25;
            track.notes.push({
              midi, startSec: barStart + beat * beatSec, durationSec: dur,
              velocity: 60 + Math.floor(rng() * 40),
            });
          }
        }
      } else if (config.role === 'pad') {
        // 铺底：每个小节一个和弦
        const chordRoot = rootMidi + 5 * 12 + scale[chordDegree % scale.length];
        const chordType = isMinorChord ? [0, 3, 7] : [0, 4, 7];
        for (const offset of chordType) {
          track.notes.push({
            midi: chordRoot + offset,
            startSec: barStart,
            durationSec: beatSec * 4,
            velocity: 50,
          });
        }
      } else if (config.role === 'bass') {
        // 贝斯：和弦根音
        const bassRoot = rootMidi + 3 * 12 + scale[chordDegree % scale.length];
        track.notes.push({
          midi: bassRoot, startSec: barStart, durationSec: beatSec * 2,
          velocity: 80,
        });
        track.notes.push({
          midi: bassRoot, startSec: barStart + beatSec * 2, durationSec: beatSec * 2,
          velocity: 70,
        });
      } else if (config.role === 'drums' || config.isDrum) {
        // 鼓组：基本节奏
        // 底鼓 (kick = MIDI 36)
        track.notes.push({ midi: 36, startSec: barStart, durationSec: 0.2, velocity: 100 });
        track.notes.push({ midi: 36, startSec: barStart + beatSec * 2, durationSec: 0.2, velocity: 90 });
        // 军鼓 (snare = MIDI 38)
        track.notes.push({ midi: 38, startSec: barStart + beatSec, durationSec: 0.2, velocity: 95 });
        track.notes.push({ midi: 38, startSec: barStart + beatSec * 3, durationSec: 0.2, velocity: 85 });
        // 踩镲 (hihat = MIDI 42)
        for (let h = 0; h < 8; h++) {
          track.notes.push({
            midi: 42, startSec: barStart + h * beatSec * 0.5, durationSec: 0.1,
            velocity: 60 + Math.floor(rng() * 20),
          });
        }
      }
    }
    sectionTime += opts.bars * beatSec * 4;
  }

  return track;
}
