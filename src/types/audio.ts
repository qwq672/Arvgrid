// MIDI 相关类型定义

export interface MidiNote {
  pitch: string; // 音高名称，如 "C4"
  startSec: number; // 开始时间（秒）
  durationSec: number; // 持续时间（秒）
  velocity: number; // 力度 (1-127)
}

export interface MidiTrack {
  name: string;
  program: number; // MIDI 程序号 (0-127)
  notes: MidiNote[];
  mute?: boolean;
}

export interface MidiMeta {
  title?: string;
  artist?: string;
  singer?: string;
  copyright?: string;
}

export interface MidiData {
  bpm: number;
  tracks: MidiTrack[];
  title?: string;
  copyright?: string;
}

// SF2 相关类型定义

export interface SF2Sample {
  name: string;
  rootKey: number;
  pitchCorrection: number;
  sampleRate: number;
  keyRange: { low: number; high: number } | null;
  pcmData: Float32Array;
  buffer: AudioBuffer | null;
}

export interface SF2Preset {
  name: string;
  program: number;
  bank: number;
  samples: SF2Sample[];
}

export interface SF2Data {
  name: string;
  presets: SF2Preset[];
}

// 音频导出相关类型定义

export type AudioExportFormat = 'wav' | 'mp3' | 'flac' | 'aac';
export type ExportQuality = 'higher' | 'balanced' | 'faster';

export interface ExportOptions {
  format: AudioExportFormat;
  quality?: ExportQuality;
  sampleRate?: number;
  bitDepth?: number;
  bitrate?: number; // 用于有损压缩格式
}

export interface ExportProgress {
  current: number;
  total: number;
  stage: 'rendering' | 'encoding' | 'complete';
}

// 音频引擎相关类型定义

export interface AudioEngineState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  totalDuration: number;
  soundSource: 'default' | 'network' | 'sf2';
  bufferSize: 'short' | 'medium' | 'long';
  metronomeOn: boolean;
  reverbSend: number;
  delaySend: number;
  delayTime: number;
  delayFeedback: number;
}

export interface PlaybackEvent {
  time: number;
  duration: number;
  pitch: string;
  velocity: number;
  program: number;
}
