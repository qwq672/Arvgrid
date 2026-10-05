// 乐理工具：调性、音阶、和弦

// 音名 → MIDI 编号偏移（相对于 C）
const NOTE_OFFSETS = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };

// 解析调性字符串，返回 { rootMidi, scaleName, isMinor }
export function parseKey(keyStr) {
  const m = keyStr.match(/^([A-G][#b]?)(m?)$/i);
  if (!m) return { rootMidi: 0, scaleName: 'major', isMinor: false };
  const root = NOTE_OFFSETS[m[1][0].toUpperCase() + (m[1][1] || '')];
  const isMinor = m[2] === 'm';
  return { rootMidi: root, scaleName: isMinor ? 'minor' : 'major', isMinor };
}

// 音阶模式（半音偏移）
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

// 和弦类型（半音偏移）
export const CHORD_TYPES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
};

// 常见和弦进行（按调性）
export const CHORD_PROGRESSIONS = {
  major: {
    happy: [['I','V','vi','IV'], ['I','IV','V','I'], ['vi','IV','I','V']],
    epic: [['I','iii','IV','V'], ['vi','V','IV','V']],
    chill: [['I','vi','IV','V'], ['ii','V','I','vi']],
  },
  minor: {
    sad: [['i','VI','III','VII'], ['i','iv','v','i'], ['i','VII','VI','VII']],
    dark: [['i','ii°','i','V'], ['i','VI','iv','i']],
  },
};

// 罗马数字 → 音阶度数
export const ROMAN_TO_SCALE = {
  'I': 0, 'II': 1, 'III': 2, 'IV': 3, 'V': 4, 'VI': 5, 'VII': 6,
  'i': 0, 'ii': 1, 'iii': 2, 'iv': 3, 'v': 4, 'vi': 5, 'vii': 6,
};

// 根据和弦进行生成音符
export function generateChordNotes(rootMidi, scale, progression, octave = 4) {
  const notes = [];
  for (const chord of progression) {
    const degree = ROMAN_TO_SCALE[chord] ?? 0;
    const isMinor = chord === chord.toLowerCase();
    const chordRoot = rootMidi + (octave + 1) * 12 + scale[degree % scale.length];
    const chordType = isMinor ? CHORD_TYPES.min : CHORD_TYPES.maj;
    for (const offset of chordType) {
      notes.push(chordRoot + offset);
    }
  }
  return notes;
}

// 生成旋律音符
export function generateMelody(rootMidi, scale, bars, rng) {
  const notes = [];
  const beatSec = 60 / 120 / 4; // 16 分音符
  let time = 0;
  
  for (let bar = 0; bar < bars; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      // 随机决定是否演奏（70% 概率）
      if (rng() < 0.7) {
        const scaleIdx = Math.floor(rng() * scale.length);
        const octave = 4 + Math.floor(rng() * 2);
        const midi = rootMidi + (octave + 1) * 12 + scale[scaleIdx];
        const dur = (1 + Math.floor(rng() * 2)) * beatSec; // 1-2 个 16 分音符
        notes.push({ midi, startSec: time, durationSec: dur, velocity: 60 + Math.floor(rng() * 40) });
        time += dur;
      } else {
        time += beatSec;
      }
    }
  }
  return notes;
}

// MIDI 编号 → 音名
export function midiToNoteName(midi) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const octave = Math.floor(midi / 12) - 1;
  return names[midi % 12] + octave;
}

// 简单种子随机数（可复现）
export function createRng(seed) {
  let state = seed || Date.now();
  return () => {
    state = (state * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (state >>> 0) / 0x100000000;
  };
}
