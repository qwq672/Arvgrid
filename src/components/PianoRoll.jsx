import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { noteToMidi, midiToNote } from '../lib/midi';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

const BASE_MIDI = 36, NOTE_COUNT = 61;
const noteNames = [];
for (let i = 0; i < NOTE_COUNT; i++) noteNames.push(midiToNote(BASE_MIDI + i));

function parseQ(v) {
  if (!v) return 0.25;
  if (v.includes('/')) { const [a, b] = v.split('/').map(Number); return a / b; }
  return Number(v) || 0.25;
}

function lightenColor(hex, factor = 0.35) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * factor));
  const lg = Math.min(255, Math.round(g + (255 - g) * factor));
  const lb = Math.min(255, Math.round(b + (255 - b) * factor));
  return `rgb(${lr},${lg},${lb})`;
}

// 预计算颜色缓存，避免每帧重复解析
const colorCache = new Map();
function getColorRgba(hex, alpha) {
  const key = `${hex}_${alpha}`;
  let cached = colorCache.get(key);
  if (!cached) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    cached = `rgba(${r},${g},${b},${alpha})`;
    colorCache.set(key, cached);
  }
  return cached;
}

export default function PianoRoll({ track, trackColor = '#888', ghostTracks = [], tracks = [], currentTrackId = null, onNotesChange, playNote, isPlaying, getPlaybackTime, lang = 'zh', editMode = 'pointer', quantizeValue = '1/4' }) {
  const canvasRef = useRef(null);
  const playheadCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const [zoomX, setZoomX] = useState(80);
  const [zoomY, setZoomY] = useState(20);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);
  const [dragState, setDragState] = useState({ active: false, type: null, startX: 0, startY: 0, notes: [] });
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 });
  const [selectedNotes, setSelectedNotes] = useState([]);
  const [clipboard, setClipboard] = useState([]);
  const [marqueeRect, setMarqueeRect] = useState(null);
  const t = useTranslation(lang);
  const maxSecRef = useRef(4);
  const selectedSetRef = useRef(new Set());
  const rafRef = useRef(null);
  const playheadSizeRef = useRef({ width: 0, height: 0 });
  const drawPendingRef = useRef(false);

  // 使用 refs 存储频繁变化的数据，避免 useCallback 依赖变化
  const trackRef = useRef(track);
  const trackColorRef = useRef(trackColor);
  const ghostTracksRef = useRef(ghostTracks);
  const zoomXRef = useRef(zoomX);
  const zoomYRef = useRef(zoomY);
  const editModeRef = useRef(editMode);
  const qStepRef = useRef(parseQ(quantizeValue));
  const onNotesChangeRef = useRef(onNotesChange);
  const playNoteRef = useRef(playNote);
  const dragStateRef = useRef(dragState);
  const selectedNotesRef = useRef(selectedNotes);
  const marqueeRectRef = useRef(marqueeRect);
  const lastMoveTimeRef = useRef(0);

  // 同步 refs
  useEffect(() => { trackRef.current = track; }, [track]);
  useEffect(() => { trackColorRef.current = trackColor; }, [trackColor]);
  useEffect(() => { ghostTracksRef.current = ghostTracks; }, [ghostTracks]);
  useEffect(() => { zoomXRef.current = zoomX; }, [zoomX]);
  useEffect(() => { zoomYRef.current = zoomY; }, [zoomY]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);
  useEffect(() => { qStepRef.current = parseQ(quantizeValue); }, [quantizeValue]);
  useEffect(() => { onNotesChangeRef.current = onNotesChange; }, [onNotesChange]);
  useEffect(() => { playNoteRef.current = playNote; }, [playNote]);
  useEffect(() => { dragStateRef.current = dragState; }, [dragState]);
  useEffect(() => { selectedNotesRef.current = selectedNotes; }, [selectedNotes]);
  useEffect(() => { marqueeRectRef.current = marqueeRect; }, [marqueeRect]);

  if (!track || !track.notes) return null;

  const qStep = parseQ(quantizeValue);

  // Assign stable IDs to notes for fast lookup
  useEffect(() => {
    track.notes.forEach((n, i) => { if (n._id === undefined) n._id = i; });
  }, [track.notes]);

  useEffect(() => { selectedSetRef.current = new Set(selectedNotes); }, [selectedNotes]);

  useEffect(() => {
    maxSecRef.current = track.notes.length ? Math.max(4, ...track.notes.map(n => n.startSec + n.durationSec)) : 4;
  }, [track.notes]);

  // 空间索引：按 pitch 分桶，加速音符查找
  const spatialIndexRef = useRef(new Map());
  useEffect(() => {
    if (!track || !track.notes) return;
    const idx = new Map();
    track.notes.forEach(n => {
      const midi = noteToMidi(n.pitch);
      if (!idx.has(midi)) idx.set(midi, []);
      idx.get(midi).push(n);
    });
    spatialIndexRef.current = idx;
  }, [track.notes]);

  // 稳定的 draw 函数 - 使用 refs 读取最新值
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const trk = trackRef.current;
    if (!canvas || !trk || !trk.notes) return;
    const ctx = canvas.getContext('2d');
    const maxSec = maxSecRef.current;
    const ox = offsetXRef.current;
    const oy = offsetYRef.current;
    const zx = zoomXRef.current;
    const zy = zoomYRef.current;
    const tc = trackColorRef.current;
    const ghosts = ghostTracksRef.current;
    const mRect = marqueeRectRef.current;

    canvas.width = Math.max(800, maxSec * zx + 120);
    canvas.height = NOTE_COUNT * zy;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 节拍网格 - 只绘制可见区域
    const beatSec = 60 / 120;
    const startBeat = Math.max(0, Math.floor(ox / (beatSec * zx)));
    const endBeat = Math.min(Math.ceil(maxSec / beatSec) + 1, Math.ceil((ox + canvas.width) / (beatSec * zx)) + 1);
    for (let b = startBeat; b <= endBeat; b++) {
      const x = b * beatSec * zx - ox;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      if (b % 4 === 0) { ctx.strokeStyle = '#3a3a42'; ctx.lineWidth = 1; }
      else { ctx.strokeStyle = '#2c2c34'; ctx.lineWidth = 0.5; }
      ctx.stroke();
    }
    // 水平网格 - 只绘制可见区域
    const startNote = Math.max(0, Math.floor(oy / zy));
    const endNote = Math.min(NOTE_COUNT, Math.ceil((oy + canvas.height) / zy) + 1);
    for (let i = startNote; i <= endNote; i++) {
      const y = i * zy - oy;
      if (i % 12 === 0) { ctx.strokeStyle = '#3a3a42'; ctx.lineWidth = 0.8; }
      else { ctx.strokeStyle = '#2a2a30'; ctx.lineWidth = 0.4; }
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    const selSet = selectedSetRef.current;

    // Ghost notes from other tracks (50% opacity) - 只绘制可见区域
    for (let gi = 0; gi < ghosts.length; gi++) {
      const { track: gt, color: gc } = ghosts[gi];
      if (!gt || !gt.notes) continue;
      const gcRgba = gc && gc.startsWith('#') ? getColorRgba(gc, 0.5) : 'rgba(136,136,136,0.5)';
      ctx.fillStyle = gcRgba;
      for (let ni = 0; ni < gt.notes.length; ni++) {
        const n = gt.notes[ni];
        const midi = noteToMidi(n.pitch);
        const pitchIdx = NOTE_COUNT - 1 - (midi - BASE_MIDI);
        if (pitchIdx < 0 || pitchIdx >= NOTE_COUNT) continue;
        const x = n.startSec * zx - ox;
        const y = pitchIdx * zy - oy;
        const w = Math.max(2, n.durationSec * zx);
        // 可见性检查
        if (x + w < 0 || x > canvas.width || y + zy < 0 || y > canvas.height) continue;
        ctx.fillRect(x, y, w, zy - 2);
      }
    }

    // 当前轨道音符 - 只绘制可见区域
    const notes = trk.notes;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const midi = noteToMidi(n.pitch);
      const pitchIdx = NOTE_COUNT - 1 - (midi - BASE_MIDI);
      if (pitchIdx < 0 || pitchIdx >= NOTE_COUNT) continue;
      const x = n.startSec * zx - ox;
      const y = pitchIdx * zy - oy;
      const w = Math.max(2, n.durationSec * zx);
      const h = zy - 2;
      // 可见性检查
      if (x + w < 0 || x > canvas.width || y + h < 0 || y > canvas.height) continue;
      const isSel = selSet.has(n);
      ctx.fillStyle = isSel ? lightenColor(tc) : tc;
      ctx.fillRect(x, y, w, h);
      // Velocity highlight
      const velAlpha = 0.08 + (n.velocity || 90) / 350;
      ctx.fillStyle = tc.startsWith('#') ? getColorRgba(tc, velAlpha) : `rgba(255,255,255,${velAlpha})`;
      ctx.fillRect(x, y, w, h / 3);
      if (isSel) { ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h); }
    }

    if (mRect) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.fillRect(mRect.x, mRect.y, mRect.w, mRect.h);
      ctx.strokeRect(mRect.x, mRect.y, mRect.w, mRect.h);
      ctx.setLineDash([]);
    }
    drawPendingRef.current = false;
  }, []); // 空依赖 - 所有数据通过 refs 读取

  // 惰性重绘
  const requestRedraw = useCallback(() => {
    if (!drawPendingRef.current) {
      drawPendingRef.current = true;
      requestAnimationFrame(() => draw());
    }
  }, [draw]);

  // 初始绘制和依赖变化时触发 - 使用 requestRedraw 批量处理
  useEffect(() => {
    requestRedraw();
  }, [track, trackColor, ghostTracks, zoomX, zoomY, marqueeRect, draw]);

  // 选中状态变化时触发重绘
  useEffect(() => {
    requestRedraw();
  }, [selectedNotes]);

  const drawPlayhead = useCallback((currentTime) => {
    const canvas = playheadCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const mainCanvas = canvasRef.current;
    if (mainCanvas) {
      const w = mainCanvas.width, h = mainCanvas.height;
      if (playheadSizeRef.current.width !== w || playheadSizeRef.current.height !== h) {
        canvas.width = w; canvas.height = h;
        playheadSizeRef.current = { width: w, height: h };
      }
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isPlaying && currentTime > 0) {
      const px = currentTime * zoomX - offsetXRef.current;
      ctx.strokeStyle = '#cc4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, canvas.height);
      ctx.stroke();
    }
  }, [isPlaying, zoomX]);

  useEffect(() => {
    if (!isPlaying) { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } drawPlayhead(0); return; }
    let lastTime = 0;
    const animate = (ts) => {
      if (ts - lastTime < 33) { rafRef.current = requestAnimationFrame(animate); return; } // ~30fps
      lastTime = ts;
      if (getPlaybackTime) drawPlayhead(getPlaybackTime());
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, drawPlayhead, getPlaybackTime]);

  const canvasToLogical = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  };

  const logicalToSecPitch = (lx, ly) => {
    const sec = (lx + offsetXRef.current) / zoomX;
    let pitchIdx = Math.min(Math.max(Math.floor((ly + offsetYRef.current) / zoomY), 0), NOTE_COUNT - 1);
    return { sec: Math.max(0, sec), pitch: midiToNote(BASE_MIDI + (NOTE_COUNT - 1 - pitchIdx)) };
  };

  // 使用空间索引加速音符查找
  const findNoteAtLogical = (lx, ly) => {
    const trk = trackRef.current;
    if (!trk || !trk.notes) return null;
    const ox = offsetXRef.current, oy = offsetYRef.current;
    const zx = zoomXRef.current, zy = zoomYRef.current;
    // 先通过空间索引缩小范围
    const lyWorld = ly + oy;
    const pitchIdx = Math.min(Math.max(Math.floor(lyWorld / zy), 0), NOTE_COUNT - 1);
    const targetMidi = BASE_MIDI + (NOTE_COUNT - 1 - pitchIdx);
    // 检查附近几个音高
    for (let offset = 0; offset <= 2; offset++) {
      for (const midi of [targetMidi + offset, targetMidi - offset]) {
        const bucket = spatialIndexRef.current.get(midi);
        if (!bucket) continue;
        for (let i = bucket.length - 1; i >= 0; i--) {
          const n = bucket[i];
          const nPitchIdx = NOTE_COUNT - 1 - (midi - BASE_MIDI);
          const nx = n.startSec * zx - ox;
          const ny = nPitchIdx * zy - oy;
          const nw = Math.max(2, n.durationSec * zx);
          if (lx >= nx && lx <= nx + nw && ly >= ny && ly <= ny + zy - 2) return n;
        }
      }
    }
    return null;
  };

  const findNotesInRect = (rx, ry, rw, rh) => {
    const trk = trackRef.current;
    if (!trk || !trk.notes) return [];
    const ox = offsetXRef.current, oy = offsetYRef.current;
    const zx = zoomXRef.current, zy = zoomYRef.current;
    return trk.notes.filter(n => {
      const midi = noteToMidi(n.pitch);
      const pitchIdx = NOTE_COUNT - 1 - (midi - BASE_MIDI);
      const nx = n.startSec * zx - ox;
      const ny = pitchIdx * zy - oy;
      const nw = Math.max(2, n.durationSec * zx);
      const nh = zy - 2;
      return nx < rx + rw && nx + nw > rx && ny < ry + rh && ny + nh > ry;
    });
  };

  const quantizeSec = (sec) => {
    const q = qStepRef.current;
    return Math.round(sec / q) * q;
  };

  // 使用 refs 的事件处理器 - 避免重新绑定
  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = e.touches ? e.touches[0] : e;
    const { x: lx, y: ly } = canvasToLogical(point.clientX, point.clientY);
    const mode = editModeRef.current;
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;

    if (mode === 'pointer') {
      const note = findNoteAtLogical(lx, ly);
      setSelectedNotes(note ? [note] : []);
      return;
    }

    if (mode === 'draw') {
      const { sec, pitch } = logicalToSecPitch(lx, ly);
      const q = qStepRef.current;
      const newNote = { pitch, startSec: Math.round(sec / q) * q, durationSec: Math.max(q, 0.05), velocity: 90 };
      onNotesChangeRef.current([...trk.notes, newNote].sort((a, b) => a.startSec - b.startSec));
      playNoteRef.current(pitch, 0.3, 90);
      return;
    }

    const note = findNoteAtLogical(lx, ly);

    if (mode === 'erase') {
      if (note) { onNotesChangeRef.current(trk.notes.filter(n => n !== note)); setSelectedNotes(prev => prev.filter(n => n !== note)); }
      setDragState({ active: true, type: 'erase', startX: lx, startY: ly, notes: [] });
      return;
    }

    if (mode === 'select') {
      const selSet = selectedSetRef.current;
      if (note && !e.shiftKey) {
        if (selSet.has(note)) {
          setDragState({ active: true, type: 'move', startX: lx, startY: ly, notes: [...selectedNotesRef.current] });
        } else {
          setSelectedNotes([note]);
          setDragState({ active: true, type: 'move', startX: lx, startY: ly, notes: [note] });
        }
      } else if (note && e.shiftKey) {
        setSelectedNotes(prev => prev.includes(note) ? prev.filter(n => n !== note) : [...prev, note]);
      } else if (!note) {
        setSelectedNotes([]);
        setDragState({ active: true, type: 'marquee', startX: lx, startY: ly, notes: [] });
        setMarqueeRect({ x: lx, y: ly, w: 0, h: 0 });
      }
    }
  }, []);

  const handlePointerMove = useCallback((e) => {
    const ds = dragStateRef.current;
    if (!ds.active) return;
    
    // 节流：限制状态更新频率为 ~30fps，减少 React 重渲染
    const now = performance.now();
    if (now - lastMoveTimeRef.current < 33) return;
    lastMoveTimeRef.current = now;
    
    e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    const { x: lx, y: ly } = canvasToLogical(point.clientX, point.clientY);
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    const zx = zoomXRef.current, zy = zoomYRef.current;
    const q = qStepRef.current;

    if (ds.type === 'move') {
      const dx = lx - ds.startX, dy = ly - ds.startY;
      const dSec = dx / zx, dPitch = Math.round(dy / zy);
      const selSet = new Set(ds.notes);
      const updated = trk.notes.map(n => {
        if (!selSet.has(n)) return n;
        const midi = noteToMidi(n.pitch);
        const newIdx = Math.min(Math.max(0, (NOTE_COUNT - 1 - (midi - BASE_MIDI)) + dPitch), NOTE_COUNT - 1);
        return { ...n, startSec: Math.max(0, Math.round((n.startSec + dSec) / q) * q), pitch: midiToNote(BASE_MIDI + (NOTE_COUNT - 1 - newIdx)) };
      });
      updated.sort((a, b) => a.startSec - b.startSec);
      onNotesChangeRef.current(updated);
      const newSel = updated.filter(n => selSet.has(n));
      setDragState(prev => ({ ...prev, startX: lx, startY: ly, notes: newSel }));
      setSelectedNotes(newSel);
    }

    if (ds.type === 'marquee') {
      const rx = Math.min(ds.startX, lx), ry = Math.min(ds.startY, ly);
      const rw = Math.abs(lx - ds.startX), rh = Math.abs(ly - ds.startY);
      setMarqueeRect({ x: rx, y: ry, w: rw, h: rh });
      setSelectedNotes(findNotesInRect(rx, ry, rw, rh));
    }

    if (ds.type === 'erase') {
      const note = findNoteAtLogical(lx, ly);
      if (note) { onNotesChangeRef.current(trk.notes.filter(n => n !== note)); setSelectedNotes(prev => prev.filter(n => n !== note)); }
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    if (dragStateRef.current.type === 'marquee') setMarqueeRect(null);
    setDragState({ active: false, type: null, startX: 0, startY: 0, notes: [] });
  }, []);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    const { x: lx, y: ly } = canvasToLogical(point.clientX, point.clientY);
    const note = findNoteAtLogical(lx, ly);
    if (note && !selectedSetRef.current.has(note)) setSelectedNotes([note]);
    setContextMenu({ visible: true, x: point.clientX, y: point.clientY });
  }, []);

  const closeCM = useCallback(() => setContextMenu({ visible: false, x: 0, y: 0 }), []);

  const quantizeNotes = useCallback((step) => {
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    const sv = 1 / step;
    onNotesChange(trk.notes.map(n => {
      if (!selectedSetRef.current.has(n)) return n;
      const qS = Math.round(n.startSec * sv) / sv;
      const qE = Math.round((n.startSec + n.durationSec) * sv) / sv;
      return { ...n, startSec: qS, durationSec: Math.max(0.05, qE - qS) };
    }));
    closeCM();
  }, [onNotesChange, closeCM]);

  const changeVelocity = useCallback((delta) => {
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    onNotesChange(trk.notes.map(n => selectedSetRef.current.has(n) ? { ...n, velocity: Math.max(1, Math.min(127, (n.velocity || 90) + delta)) } : n));
    closeCM();
  }, [onNotesChange, closeCM]);

  const copySelected = useCallback(() => {
    if (selectedNotes.length === 0) return;
    const minStart = Math.min(...selectedNotes.map(n => n.startSec));
    setClipboard(selectedNotes.map(n => ({ ...n, startSec: n.startSec - minStart })));
    closeCM();
  }, [selectedNotes, closeCM]);

  const cutSelected = useCallback(() => {
    if (selectedNotes.length === 0) return;
    copySelected();
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    onNotesChange(trk.notes.filter(n => !selectedSetRef.current.has(n)));
    setSelectedNotes([]);
  }, [selectedNotes, copySelected, onNotesChange]);

  const pasteNotes = useCallback(() => {
    if (clipboard.length === 0) return;
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    const newNotes = clipboard.map(n => ({ ...n }));
    onNotesChange([...trk.notes, ...newNotes].sort((a, b) => a.startSec - b.startSec));
    setSelectedNotes(newNotes);
    closeCM();
  }, [clipboard, onNotesChange, closeCM]);

  const deleteSelected = useCallback(() => {
    if (selectedNotes.length === 0) return;
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    onNotesChange(trk.notes.filter(n => !selectedSetRef.current.has(n)));
    setSelectedNotes([]);
    closeCM();
  }, [selectedNotes, onNotesChange, closeCM]);

  const selectAll = useCallback(() => {
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    setSelectedNotes([...trk.notes]);
  }, []);

  // Ctrl shortcuts
  useEffect(() => {
    const h = (e) => {
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
        return;
      }
      if (e.key === 'c') { e.preventDefault(); copySelected(); }
      else if (e.key === 'x') { e.preventDefault(); cutSelected(); }
      else if (e.key === 'v') { e.preventDefault(); pasteNotes(); }
      else if (e.key === 'a') { e.preventDefault(); selectAll(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [copySelected, cutSelected, pasteNotes, selectAll, deleteSelected]);

  // Canvas事件绑定 - 稳定引用，只在挂载时绑定一次
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('mousedown', handlePointerDown);
    canvas.addEventListener('touchstart', handlePointerDown, { passive: false });
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchend', handlePointerUp);
    return () => {
      canvas.removeEventListener('mousedown', handlePointerDown);
      canvas.removeEventListener('touchstart', handlePointerDown);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, handleContextMenu]);

  // 键盘标签画布 - 只在 zoomY 变化时重绘
  const keyLabelCanvasRef = useCallback((el) => {
    if (!el) return;
    el.width = 38;
    el.height = NOTE_COUNT * zoomY;
    const ctx = el.getContext('2d');
    ctx.clearRect(0, 0, 38, el.height);
    ctx.fillStyle = '#6a6a70';
    ctx.font = '9px monospace';
    for (let i = 0; i < NOTE_COUNT; i++) {
      const y = i * zoomY;
      ctx.fillText(noteNames[NOTE_COUNT - 1 - i], 2, y + 11);
    }
  }, [zoomY]);

  return (
    <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', borderRadius: 6, overflow: 'hidden', minHeight: 0 }}>
      {/* 工具栏 */}
      <div style={{ padding: '3px 6px', display: 'flex', gap: 4, flexShrink: 0, background: 'var(--panel)', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <button onClick={() => setZoomX(z => Math.min(300, z * 1.2))} title={t.zoomIn} style={{ padding: '2px 6px' }}><Icons.ZoomIn /></button>
        <button onClick={() => setZoomX(z => Math.max(20, z * 0.8))} title={t.zoomOut} style={{ padding: '2px 6px' }}><Icons.ZoomOut /></button>
        <button onClick={() => { offsetXRef.current = 0; offsetYRef.current = 0; setZoomX(80); setZoomY(20); }} title={t.resetView} style={{ padding: '2px 6px' }}><Icons.Reset /></button>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {selectedNotes.length > 0 ? `${selectedNotes.length} ${lang === 'zh' ? '个音符' : ' notes'}` : ''}
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ width: 38, flexShrink: 0, background: 'var(--track-bg)', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
          <canvas ref={keyLabelCanvasRef} style={{ display: 'block' }} />
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }} onScroll={(e) => { offsetXRef.current = e.target.scrollLeft; offsetYRef.current = e.target.scrollTop; requestRedraw(); }}>
          <canvas ref={canvasRef} width={800} height={300} style={{ display: 'block' }} />
          <canvas ref={playheadCanvasRef} width={800} height={300} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
        </div>
      </div>

      {contextMenu.visible && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={closeCM} onContextMenu={e => { e.preventDefault(); closeCM(); }}>
          <div style={{ position: 'fixed', top: Math.min(contextMenu.y, window.innerHeight - 260), left: Math.min(contextMenu.x, window.innerWidth - 150), background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 1000, minWidth: 140, padding: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid var(--border)', marginBottom: 3 }}>
              {selectedNotes.length > 0 ? `${selectedNotes.length} ${lang === 'zh' ? '个音符' : ' notes'}` : ''}
            </div>
            <button onClick={() => quantizeNotes(1/8)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.quantize8th}</button>
            <button onClick={() => quantizeNotes(1/4)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.quantize4th}</button>
            <button onClick={() => quantizeNotes(1/2)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.quantizeHalf}</button>
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
            <button onClick={() => changeVelocity(10)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.changeVelocity} +10</button>
            <button onClick={() => changeVelocity(-10)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.changeVelocity} -10</button>
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
            <button onClick={copySelected} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.copy}</button>
            <button onClick={cutSelected} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.cut}</button>
            <button onClick={pasteNotes} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.paste}</button>
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
            <button onClick={deleteSelected} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--danger)' }}>{t.deleteSelected}</button>
          </div>
        </div>
      )}
    </div>
  );
}
