import { useState, useCallback } from 'react';

let nextId = 1;
function generateId() { return nextId++; }

// 音轨自动配色调色板
export const TRACK_COLORS = [
  '#4a9eff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8',
  '#ff922b', '#22b8cf', '#e64980', '#94d82d', '#5c7cfa',
  '#f06595', '#fcc419', '#20c997', '#845ef7', '#ff8787',
];

// 本地存储键名
export const AUTOSAVE_KEY = 'arvgrid_autosave';
export const RECENT_PROJECTS_KEY = 'arvgrid_recent_projects';

// 保存自动保存的工程
export function saveAutosave(project) {
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
}

// 加载自动保存的工程
export function loadAutosave() {
  const data = localStorage.getItem(AUTOSAVE_KEY);
  return data ? JSON.parse(data) : null;
}

// 清除自动保存的工程
export function clearAutosave() {
  localStorage.removeItem(AUTOSAVE_KEY);
}

// 获取最近工程列表
export function getRecentProjects() {
  const data = localStorage.getItem(RECENT_PROJECTS_KEY);
  return data ? JSON.parse(data) : [];
}

// 添加最近工程
export function addRecentProject(project) {
  const recents = getRecentProjects();
  const existing = recents.find(p => p.id === project.id);
  if (existing) {
    existing.timestamp = Date.now();
    existing.title = project.title || '未命名工程';
  } else {
    recents.unshift({ id: project.id, title: project.title || '未命名工程', timestamp: Date.now() });
    if (recents.length > 10) recents.pop();
  }
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(recents));
}

// 删除单个最近工程
export function removeRecentProject(id) {
  const recents = getRecentProjects().filter(p => p.id !== id);
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(recents));
}

// 清空所有最近工程
export function clearAllRecentProjects() {
  localStorage.removeItem(RECENT_PROJECTS_KEY);
}

export function useProject() {
  const [tracks, setTracks] = useState([
    { id: generateId(), name: "Piano", program: 0, notes: [], volume: 80, pan: 64, mute: false, group: '', reverb: 0, effects: { eqLow: 0, eqMid: 0, eqHigh: 0, reverbSend: 0, delaySend: 0, delayTime: 0.3, delayFeedback: 0.2, spatial: 0 } }
  ]);
  const [currentTrackId, setCurrentTrackId] = useState(tracks[0].id);
  const [bpm, setBpm] = useState(120);
  const [meta, setMeta] = useState({ title: "", artist: "", singer: "", copyright: "" });
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const pushUndo = useCallback(() => {
    setUndoStack(prev => [...prev, { tracks, bpm, meta, currentTrackId }]);
    setRedoStack([]);
  }, [tracks, bpm, meta, currentTrackId]);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, { tracks, bpm, meta, currentTrackId }]);
    setTracks(last.tracks);
    setBpm(last.bpm);
    setMeta(last.meta);
    setCurrentTrackId(last.currentTrackId);
    setUndoStack(prev => prev.slice(0, -1));
  }, [undoStack, tracks, bpm, meta, currentTrackId]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, { tracks, bpm, meta, currentTrackId }]);
    setTracks(next.tracks);
    setBpm(next.bpm);
    setMeta(next.meta);
    setCurrentTrackId(next.currentTrackId);
    setRedoStack(prev => prev.slice(0, -1));
  }, [redoStack, tracks, bpm, meta, currentTrackId]);

  // 轨道操作
  const addTrack = useCallback(() => {
    pushUndo();
    const newId = generateId();
    setTracks(prev => [...prev, { id: newId, name: `Track ${prev.length+1}`, program: 0, notes: [], volume: 80, pan: 64, mute: false, group: '', reverb: 0, effects: { eqLow: 0, eqMid: 0, eqHigh: 0, reverbSend: 0, delaySend: 0, delayTime: 0.3, delayFeedback: 0.2, spatial: 0 } }]);
    setCurrentTrackId(newId);
  }, [pushUndo]);

  const deleteTrack = useCallback((id) => {
    if (tracks.length === 1) return;
    pushUndo();
    setTracks(prev => prev.filter(t => t.id !== id));
    if (currentTrackId === id) {
      setCurrentTrackId(tracks[0].id === id ? tracks[1]?.id : tracks[0].id);
    }
  }, [tracks, currentTrackId, pushUndo]);

  const updateTrack = useCallback((id, updates) => {
    pushUndo();
    setTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, [pushUndo]);

  // 音符操作
  const addNote = useCallback((trackId, note) => {
    pushUndo();
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const existing = t.notes.find(n => Math.abs(n.startSec - note.startSec) < 0.05 && n.pitch === note.pitch);
      if (existing) return t;
      const newNotes = [...t.notes, note].sort((a,b) => a.startSec - b.startSec);
      return { ...t, notes: newNotes };
    }));
  }, [pushUndo]);

  const deleteNote = useCallback((trackId, noteToDelete) => {
    pushUndo();
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, notes: t.notes.filter(n => n !== noteToDelete) };
    }));
  }, [pushUndo]);

  const updateNote = useCallback((trackId, oldNote, newNote) => {
    pushUndo();
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const notes = t.notes.map(n => n === oldNote ? newNote : n);
      notes.sort((a,b) => a.startSec - b.startSec);
      return { ...t, notes };
    }));
  }, [pushUndo]);

  const quantizeTrack = useCallback((trackId, gridSec = 0.25) => {
    pushUndo();
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const notes = t.notes.map(n => ({
        ...n,
        startSec: Math.round(n.startSec / gridSec) * gridSec,
        durationSec: Math.max(gridSec, Math.round(n.durationSec / gridSec) * gridSec),
      }));
      notes.sort((a,b) => a.startSec - b.startSec);
      return { ...t, notes };
    }));
  }, [pushUndo]);

  const clearTrack = useCallback((trackId) => {
    pushUndo();
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, notes: [] } : t));
  }, [pushUndo]);

  const duplicateTrack = useCallback((id) => {
    pushUndo();
    const newId = generateId();
    setTracks(prev => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx === -1) return prev;
      const original = prev[idx];
      const duplicate = {
        ...original,
        id: newId,
        name: (original.name || `Track ${original.id}`) + ' (copy)',
        notes: Array.isArray(original.notes) ? original.notes.map(n => ({ ...n })) : [],
        comment: original.comment || '',
        group: original.group || '',
        reverb: original.reverb || 0,
        effects: original.effects || { eqLow: 0, eqMid: 0, eqHigh: 0, reverbSend: 0, delaySend: 0, delayTime: 0.3, delayFeedback: 0.2, spatial: 0 },
        color: original.color,
      };
      const newTracks = [...prev];
      newTracks.splice(idx + 1, 0, duplicate);
      return newTracks;
    });
    setCurrentTrackId(newId);
  }, [pushUndo]);

  const updateTrackGroup = useCallback((id, group) => {
    pushUndo();
    setTracks(prev => prev.map(t => t.id === id ? { ...t, group } : t));
  }, [pushUndo]);

  // 导入 MIDI 数据（替换当前工程）
  const importMidiData = useCallback((midiData) => {
    if (!midiData || !midiData.tracks || !Array.isArray(midiData.tracks)) {
      console.error('Invalid MIDI data:', midiData);
      return;
    }
    pushUndo();
    const newTracks = midiData.tracks.map((t, idx) => ({
      id: generateId(),
      name: t.name || `Track ${idx+1}`,
      program: t.program || 0,
      isDrum: t.isDrum || false,
      notes: Array.isArray(t.notes) ? t.notes : [],
      volume: t.volume || 80,
      pan: t.pan || 64,
      mute: t.mute || false,
      group: t.group || '',
      reverb: t.reverb || 0,
      color: t.color || TRACK_COLORS[idx % TRACK_COLORS.length],
    }));
    setTracks(newTracks);
    setBpm(midiData.bpm || 120);
    // 保留已有 meta，仅用 MIDI 数据补充（不清空已有值）
    setMeta(prev => ({
      ...prev,
      title: midiData.title || prev.title || '',
      copyright: midiData.copyright || prev.copyright || '',
    }));
    setCurrentTrackId(newTracks[0]?.id);
  }, [pushUndo]);

  // 嵌入 MIDI 数据（追加到当前工程）
  const mergeMidiData = useCallback((midiData) => {
    if (!midiData || !midiData.tracks || !Array.isArray(midiData.tracks)) {
      console.error('Invalid MIDI data:', midiData);
      return;
    }
    pushUndo();
    const newTracks = midiData.tracks.map((t, idx) => ({
      id: generateId(),
      name: t.name || `Track ${idx+1}`,
      color: t.color || TRACK_COLORS[(tracks.length + idx) % TRACK_COLORS.length],
      program: t.program || 0,
      isDrum: t.isDrum || false,
      notes: Array.isArray(t.notes) ? t.notes : [],
      volume: t.volume || 80,
      pan: t.pan || 64,
      mute: t.mute || false,
      group: t.group || '',
      reverb: t.reverb || 0,
    }));
    setTracks(prev => [...prev, ...newTracks]);
    if (newTracks.length > 0) {
      setCurrentTrackId(newTracks[0].id);
    }
  }, [pushUndo]);

  // 导出工程 JSON 文件
  const exportProject = useCallback(() => {
    // 紧凑序列化：短键名 + 精度截断，减少文件大小约 60%
    const compact = {
      v: 2, // 格式版本
      tracks: tracks.map(t => ({
        id: t.id, n: t.name, p: t.program, v: t.volume, pn: t.pan,
        m: t.mute ? 1 : 0, g: t.group || '', r: t.reverb || 0, c: t.color || '',
        notes: t.notes.map(n => ({
          p: n.pitch,
          s: Math.round(n.startSec * 1000) / 1000,
          d: Math.round(n.durationSec * 1000) / 1000,
          v: n.velocity,
        })),
      })),
      bpm, meta,
    };
    const blob = new Blob([JSON.stringify(compact)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arvgrid_project.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [tracks, bpm, meta]);

  // 导入工程 JSON 文件（替换当前）
  const importProject = useCallback((jsonData) => {
    pushUndo();
    const raw = JSON.parse(jsonData);
    let data;
    if (raw.v === 2) {
      // 紧凑格式：展开短键名
      data = {
        tracks: raw.tracks.map((t, idx) => ({
          id: t.id, name: t.n || t.name || 'Track', program: t.p ?? t.program ?? 0,
          volume: t.v ?? t.volume ?? 80, pan: t.pn ?? t.pan ?? 64,
          mute: !!(t.m ?? t.mute), group: t.g ?? t.group ?? '', reverb: t.r ?? t.reverb ?? 0,
          color: t.c || t.color || TRACK_COLORS[idx % TRACK_COLORS.length],
          notes: t.notes.map(n => ({
            pitch: n.p ?? n.pitch,
            startSec: n.s ?? n.startSec ?? 0,
            durationSec: n.d ?? n.durationSec ?? 0,
            velocity: n.v ?? n.velocity ?? 90,
          })),
        })),
        bpm: raw.bpm, meta: raw.meta,
      };
    } else {
      // 旧格式（v1，长键名），直接使用
      data = raw;
    }
    setTracks(data.tracks);
    setBpm(data.bpm);
    setMeta(data.meta || { title: "", artist: "", singer: "", copyright: "" });
    setCurrentTrackId(data.tracks[0]?.id);
  }, [pushUndo]);

  // 新建工程
  const newProject = useCallback(() => {
    pushUndo();
    const newId = generateId();
    setTracks([{ id: newId, name: "Piano", program: 0, notes: [], volume: 80, pan: 64, mute: false, group: '', reverb: 0 }]);
    setBpm(120);
    setMeta({ title: "", artist: "", singer: "", copyright: "" });
    setCurrentTrackId(newId);
  }, [pushUndo]);

  // 获取当前工程数据（用于自动保存）
  const getCurrentProjectData = useCallback(() => {
    return { tracks, bpm, meta, currentTrackId };
  }, [tracks, bpm, meta, currentTrackId]);

  return {
    tracks,
    currentTrackId,
    bpm,
    meta,
    setBpm,
    setMeta,
    addTrack,
    deleteTrack,
    updateTrack,
    addNote,
    deleteNote,
    updateNote,
    quantizeTrack,
    clearTrack,
    duplicateTrack,
    updateTrackGroup,
    importMidiData,
    mergeMidiData,
    exportProject,
    importProject,
    newProject,
    undo,
    redo,
    setCurrentTrackId,
    getCurrentProjectData,
    pushUndo,
  };
}