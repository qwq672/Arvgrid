// 预设风格

export const PRESETS = {
  'piano-ballad': {
    bpm: 72,
    key: 'Am',
    scale: 'minor',
    mood: 'sad',
    tempo: 'slow',
    sections: 4,
    bars: 4,
    tracks: [
      { program: 0, name: 'Piano', role: 'melody' },
      { program: 48, name: 'Strings', role: 'pad' },
    ],
  },
  'electronic': {
    bpm: 128,
    key: 'Cm',
    scale: 'minor',
    mood: 'epic',
    tempo: 'fast',
    sections: 4,
    bars: 4,
    tracks: [
      { program: 81, name: 'Lead', role: 'melody' },
      { program: 88, name: 'Pad', role: 'pad' },
      { program: 0, name: 'Bass', role: 'bass' },
      { program: 0, name: 'Drums', role: 'drums', isDrum: true },
    ],
  },
  'rock': {
    bpm: 120,
    key: 'E',
    scale: 'major',
    mood: 'epic',
    tempo: 'medium',
    sections: 4,
    bars: 4,
    tracks: [
      { program: 30, name: 'Guitar', role: 'melody' },
      { program: 34, name: 'Bass', role: 'bass' },
      { program: 0, name: 'Drums', role: 'drums', isDrum: true },
    ],
  },
  'jazz': {
    bpm: 100,
    key: 'Dm',
    scale: 'dorian',
    mood: 'chill',
    tempo: 'medium',
    sections: 4,
    bars: 4,
    tracks: [
      { program: 0, name: 'Piano', role: 'melody' },
      { program: 33, name: 'Bass', role: 'bass' },
      { program: 0, name: 'Drums', role: 'drums', isDrum: true },
    ],
  },
  'ambient': {
    bpm: 60,
    key: 'C',
    scale: 'pentatonic',
    mood: 'chill',
    tempo: 'slow',
    sections: 3,
    bars: 8,
    tracks: [
      { program: 88, name: 'Pad', role: 'pad' },
      { program: 9, name: 'Bells', role: 'melody' },
    ],
  },
};
