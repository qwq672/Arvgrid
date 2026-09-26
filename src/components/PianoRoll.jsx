import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { noteToMidi, midiToNote } from '../lib/midi';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

const BASE_MIDI = 36, NOTE_COUNT = 61;
const DPR = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

function parseQ(v) {
  if (!v) return 0.25;
  if (v.includes('/')) { const [a, b] = v.split('/').map(Number); return a / b; }
  return Number(v) || 0.25;
}

// 预计算颜色缓存，避免每帧重复解析
const colorCache = new Map();
const lightenColorCache = new Map();
function lightenColor(hex, factor = 0.35) {
  const key = `${hex}_${factor}`;
  let cached = lightenColorCache.get(key);
  if (cached) return cached;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * factor));
  const lg = Math.min(255, Math.round(g + (255 - g) * factor));
  const lb = Math.min(255, Math.round(b + (255 - b) * factor));
  cached = `rgb(${lr},${lg},${lb})`;
  lightenColorCache.set(key, cached);
  return cached;
}
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
  // 小屏默认更紧凑的视图：zoomX 略小（更宽视野），zoomY 略小（更多行）
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 768;
  const [zoomX, setZoomX] = useState(isNarrow ? 60 : 80);
  const [zoomY, setZoomY] = useState(isNarrow ? 16 : 20);
  const pinchStateRef = useRef(null); // 双指缩放状态
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);
  const [dragState, setDragState] = useState({ active: false, type: null, startX: 0, startY: 0, notes: [] });
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 });
  const [selectedNotes, setSelectedNotes] = useState([]);
  const [clipboard, setClipboard] = useState([]);
  const [marqueeRect, setMarqueeRect] = useState(null);
  const [showGhosts, setShowGhosts] = useState(true);
  const [snapMode, setSnapMode] = useState(true); // true=网格吸附, false=自由放置
  const [showArrange, setShowArrange] = useState(false); // P6 编排概览
  const t = useTranslation(lang);
  const maxSecRef = useRef(4);
  const selectedSetRef = useRef(new Set());
  const rafRef = useRef(null);
  const playheadSizeRef = useRef({ width: 0, height: 0 });
  const drawPendingRef = useRef(false);
  // 离屏网格 canvas（P3 优化）：网格预渲染，draw() 时直接 drawImage
  const gridCanvasRef = useRef(null);
  const gridSizeRef = useRef({ w: 0, h: 0, maxSec: 0, zx: 0, zy: 0 });
  // 拖动预览（P5 优化）：拖动时不提交，仅用 ref 存临时位移
  const dragOriginRef = useRef(null); // { notes: [...], selSet: Set, startX, startY }
  const dragOffsetRef = useRef({ dSec: 0, dPitch: 0 });

  // 使用 refs 存储频繁变化的数据，避免 useCallback 依赖变化
  const trackRef = useRef(track);
  const trackColorRef = useRef(trackColor);
  const ghostTracksRef = useRef(ghostTracks);
  const showGhostsRef = useRef(showGhosts);
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
  const snapModeRef = useRef(snapMode);
  const keyboardCanvasRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressStartRef = useRef(null);
  const arrangeCanvasRef = useRef(null);
  const scrollRef = useRef(null);

  // 同步 refs
  useEffect(() => { trackRef.current = track; }, [track]);
  useEffect(() => { trackColorRef.current = trackColor; }, [trackColor]);
  useEffect(() => { ghostTracksRef.current = ghostTracks; }, [ghostTracks]);
  useEffect(() => { showGhostsRef.current = showGhosts; }, [showGhosts]);
  useEffect(() => { zoomXRef.current = zoomX; }, [zoomX]);
  useEffect(() => { zoomYRef.current = zoomY; }, [zoomY]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);
  useEffect(() => { qStepRef.current = parseQ(quantizeValue); }, [quantizeValue]);
  useEffect(() => { onNotesChangeRef.current = onNotesChange; }, [onNotesChange]);
  useEffect(() => { playNoteRef.current = playNote; }, [playNote]);
  useEffect(() => { dragStateRef.current = dragState; }, [dragState]);
  useEffect(() => { selectedNotesRef.current = selectedNotes; }, [selectedNotes]);
  useEffect(() => { marqueeRectRef.current = marqueeRect; }, [marqueeRect]);
  useEffect(() => { snapModeRef.current = snapMode; }, [snapMode]);

  if (!track || !track.notes) return null;

  const qStep = parseQ(quantizeValue);

  // Assign stable IDs to notes for fast lookup
  useEffect(() => {
    track.notes.forEach((n, i) => { if (n._id === undefined) n._id = i; });
  }, [track.notes]);

  useEffect(() => { selectedSetRef.current = new Set(selectedNotes); }, [selectedNotes]);

  useEffect(() => {
    let maxSec = 4;
    for (let i = 0; i < track.notes.length; i++) {
      const end = track.notes[i].startSec + track.notes[i].durationSec;
      if (end > maxSec) maxSec = end;
    }
    maxSecRef.current = maxSec;
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

  // 网格预渲染到离屏 canvas（P3 优化）：仅在 maxSec/zx/zy 变化时重绘网格
  // draw() 中用 drawImage 复制可见区域，避免每帧逐线 stroke
  useEffect(() => {
    const maxSec = maxSecRef.current;
    const zx = zoomXRef.current;
    const zy = zoomYRef.current;
    const logicalW = Math.max(800, maxSec * zx + 120);
    const logicalH = NOTE_COUNT * zy;
    if (!gridCanvasRef.current) gridCanvasRef.current = document.createElement('canvas');
    const gc = gridCanvasRef.current;
    const physW = Math.round(logicalW * DPR);
    const physH = Math.round(logicalH * DPR);
    if (gc.width !== physW) gc.width = physW;
    if (gc.height !== physH) gc.height = physH;
    const gctx = gc.getContext('2d');
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    gctx.clearRect(0, 0, logicalW, logicalH);
    // 黑键行底纹（DAW 风格：黑键行加深，提升可读性）
    for (let i = 0; i < NOTE_COUNT; i++) {
      const midi = BASE_MIDI + (NOTE_COUNT - 1 - i);
      const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
      if (isBlack) {
        gctx.fillStyle = '#1f1f25';
        gctx.fillRect(0, i * zy, logicalW, zy);
      }
    }
    // 节拍竖线
    const beatSec = 60 / 120;
    const totalBeats = Math.ceil(maxSec / beatSec) + 1;
    for (let b = 0; b <= totalBeats; b++) {
      const x = b * beatSec * zx;
      gctx.beginPath();
      gctx.moveTo(x, 0);
      gctx.lineTo(x, logicalH);
      if (b % 4 === 0) { gctx.strokeStyle = '#3a3a42'; gctx.lineWidth = 1; }
      else { gctx.strokeStyle = '#2c2c34'; gctx.lineWidth = 0.5; }
      gctx.stroke();
    }
    // 水平横线
    for (let i = 0; i <= NOTE_COUNT; i++) {
      const y = i * zy;
      const midi = BASE_MIDI + (NOTE_COUNT - 1 - i);
      if (midi % 12 === 0) { gctx.strokeStyle = '#4a4a52'; gctx.lineWidth = 1; }
      else if ([1, 3, 6, 8, 10].includes(midi % 12)) { gctx.strokeStyle = '#2a2a30'; gctx.lineWidth = 0.3; }
      else { gctx.strokeStyle = '#33333a'; gctx.lineWidth = 0.4; }
      gctx.beginPath();
      gctx.moveTo(0, y);
      gctx.lineTo(logicalW, y);
      gctx.stroke();
    }
    gridSizeRef.current = { w: logicalW, h: logicalH, maxSec, zx, zy };
  }, [track.notes, zoomX, zoomY]);

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

    // 高 DPI 支持：逻辑尺寸用于绘制，物理尺寸 = 逻辑 × DPR
    const logicalW = Math.max(800, maxSec * zx + 120);
    const logicalH = NOTE_COUNT * zy;
    const physW = Math.round(logicalW * DPR);
    const physH = Math.round(logicalH * DPR);
    if (canvas.width !== physW) canvas.width = physW;
    if (canvas.height !== physH) canvas.height = physH;
    canvas.style.width = logicalW + 'px';
    canvas.style.height = logicalH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    ctx.clearRect(0, 0, logicalW, logicalH);

    // 网格：从离屏 canvas drawImage 复制可见区域（P3 优化）
    const gc = gridCanvasRef.current;
    const gs = gridSizeRef.current;
    if (gc && gs.w > 0 && gs.maxSec === maxSec && gs.zx === zx && gs.zy === zy) {
      // 源矩形（gridCanvas 物理像素）= 可见区域；目的矩形（主 canvas 逻辑像素）= 全屏
      const srcX = Math.max(0, Math.min(gs.w - 1, ox * DPR));
      const srcY = Math.max(0, Math.min(gs.h - 1, oy * DPR));
      const srcW = Math.min(logicalW * DPR, gs.w - srcX);
      const srcH = Math.min(logicalH * DPR, gs.h - srcY);
      if (srcW > 0 && srcH > 0) {
        // drawImage 不受 setTransform 影响，源坐标用物理像素，目的坐标用逻辑像素
        ctx.drawImage(gc, srcX, srcY, srcW, srcH, srcX / DPR - ox, srcY / DPR - oy, srcW / DPR, srcH / DPR);
      }
    } else {
      // 后备：直接绘制（grid effect 还未执行）
      const startNote = Math.max(0, Math.floor(oy / zy));
      const endNote = Math.min(NOTE_COUNT, Math.ceil((oy + logicalH) / zy) + 1);
      for (let i = startNote; i < endNote; i++) {
        const midi = BASE_MIDI + (NOTE_COUNT - 1 - i);
        if ([1, 3, 6, 8, 10].includes(midi % 12)) {
          ctx.fillStyle = '#1f1f25';
          ctx.fillRect(0, i * zy - oy, logicalW, zy);
        }
      }
      const beatSec = 60 / 120;
      const startBeat = Math.max(0, Math.floor(ox / (beatSec * zx)));
      const endBeat = Math.min(Math.ceil(maxSec / beatSec) + 1, Math.ceil((ox + logicalW) / (beatSec * zx)) + 1);
      for (let b = startBeat; b <= endBeat; b++) {
        const x = b * beatSec * zx - ox;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, logicalH);
        if (b % 4 === 0) { ctx.strokeStyle = '#3a3a42'; ctx.lineWidth = 1; }
        else { ctx.strokeStyle = '#2c2c34'; ctx.lineWidth = 0.5; }
        ctx.stroke();
      }
      for (let i = startNote; i <= endNote; i++) {
        const y = i * zy - oy;
        const midi = BASE_MIDI + (NOTE_COUNT - 1 - i);
        if (midi % 12 === 0) { ctx.strokeStyle = '#4a4a52'; ctx.lineWidth = 1; }
        else { ctx.strokeStyle = '#33333a'; ctx.lineWidth = 0.4; }
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(logicalW, y);
        ctx.stroke();
      }
    }

    const selSet = selectedSetRef.current;

    // Ghost notes from other tracks (50% opacity) - 只绘制可见区域
    if (showGhostsRef.current) {
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
        if (x + w < 0 || x > logicalW || y + zy < 0 || y > logicalH) continue;
        ctx.fillRect(x, y, w, zy - 2);
      }
    }
    } // end if showGhosts

    // 当前轨道音符 - 只绘制可见区域
    // P5 优化：拖动期间选中的音符用预览位置（基于 dragOffsetRef）绘制
    const notes = trk.notes;
    const dragOrigin = dragOriginRef.current;
    const dragActive = dragOrigin && dragStateRef.current.active && dragStateRef.current.type === 'move';
    const dragOffset = dragOffsetRef.current;
    const dragSet = dragActive ? dragOrigin.selSet : null;
    const q = qStepRef.current;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const midi = noteToMidi(n.pitch);
      let pitchIdx = NOTE_COUNT - 1 - (midi - BASE_MIDI);
      let startSec = n.startSec;
      // 拖动预览：选中的音符应用偏移
      if (dragSet && dragSet.has(n)) {
        pitchIdx = Math.min(Math.max(0, pitchIdx + dragOffset.dPitch), NOTE_COUNT - 1);
        const target = n.startSec + dragOffset.dSec;
        startSec = snapModeRef.current ? Math.max(0, Math.round(target / q) * q) : Math.max(0, target);
      }
      if (pitchIdx < 0 || pitchIdx >= NOTE_COUNT) continue;
      const x = startSec * zx - ox;
      const y = pitchIdx * zy - oy;
      const w = Math.max(2, n.durationSec * zx);
      const h = zy - 2;
      // 可见性检查
      if (x + w < 0 || x > logicalW || y + h < 0 || y > logicalH) continue;
      const isSel = selSet.has(n);
      ctx.fillStyle = isSel ? lightenColor(tc) : tc;
      ctx.fillRect(x, y, w, h);
      // Velocity highlight
      const velAlpha = 0.08 + (n.velocity || 90) / 350;
      ctx.fillStyle = tc.startsWith('#') ? getColorRgba(tc, velAlpha) : `rgba(255,255,255,${velAlpha})`;
      ctx.fillRect(x, y, w, h / 3);
      // 细描边，让音符更立体
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5);
      if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h); }
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
  }, [track, trackColor, ghostTracks, showGhosts, zoomX, zoomY, marqueeRect, draw]);

  // 选中状态变化时触发重绘
  useEffect(() => {
    requestRedraw();
  }, [selectedNotes]);

  const drawPlayhead = useCallback((currentTime) => {
    const canvas = playheadCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const mainCanvas = canvasRef.current;
    // 高 DPI：playhead canvas 匹配主 canvas 的物理尺寸和逻辑尺寸
    if (mainCanvas) {
      const physW = mainCanvas.width, physH = mainCanvas.height;
      const logicalW = physW / DPR, logicalH = physH / DPR;
      if (playheadSizeRef.current.width !== physW || playheadSizeRef.current.height !== physH) {
        canvas.width = physW; canvas.height = physH;
        canvas.style.width = logicalW + 'px';
        canvas.style.height = logicalH + 'px';
        playheadSizeRef.current = { width: physW, height: physH };
      }
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, logicalW, logicalH);
      if (isPlaying && currentTime > 0) {
        const px = currentTime * zoomX - offsetXRef.current;
        ctx.strokeStyle = '#cc4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, logicalH);
        ctx.stroke();
      }
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

  // P6 编排概览：所有轨道在同一时间线上的迷你总览
  const drawArrange = useCallback(() => {
    const el = arrangeCanvasRef.current;
    const cont = containerRef.current;
    if (!el || !cont) return;
    const w = cont.clientWidth;
    if (w <= 0) return;
    // 全局最大时长
    let gMax = 4;
    for (let ti = 0; ti < tracks.length; ti++) {
      const trk = tracks[ti];
      if (!trk || !trk.notes) continue;
      for (let ni = 0; ni < trk.notes.length; ni++) {
        const n = trk.notes[ni];
        const end = n.startSec + n.durationSec;
        if (end > gMax) gMax = end;
      }
    }
    const laneH = 11;
    const pad = 2;
    const h = tracks.length * laneH + pad * 2;
    el.width = Math.round(w * DPR);
    el.height = Math.round(h * DPR);
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    const ctx = el.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#16161b';
    ctx.fillRect(0, 0, w, h);
    const scaleX = w / gMax;
    for (let ti = 0; ti < tracks.length; ti++) {
      const trk = tracks[ti];
      const y0 = pad + ti * laneH;
      // 当前轨道底色高亮
      if (trk.id === currentTrackId) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, y0, w, laneH - 1);
      }
      const c = trk.color || '#888';
      ctx.fillStyle = c;
      if (trk.notes) {
        for (let ni = 0; ni < trk.notes.length; ni++) {
          const n = trk.notes[ni];
          const x = n.startSec * scaleX;
          const nw = Math.max(1, n.durationSec * scaleX);
          ctx.fillRect(x, y0 + 1, nw, laneH - 3);
        }
      }
      // 分隔线
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y0 + laneH - 0.5);
      ctx.lineTo(w, y0 + laneH - 0.5);
      ctx.stroke();
    }
    // 当前可视区域矩形
    const sc = scrollRef.current;
    if (sc) {
      const visSec = sc.clientWidth / zoomXRef.current;
      const startSec = sc.scrollLeft / zoomXRef.current;
      const vx = startSec * scaleX;
      const vw = visSec * scaleX;
      ctx.strokeStyle = 'rgba(204,68,68,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(vx, 0.5, Math.max(2, vw), h - 1);
    }
  }, [tracks, currentTrackId]);

  useEffect(() => {
    if (showArrange) drawArrange();
  }, [showArrange, drawArrange, track, zoomX]);

  // 编排概览点击/拖动：水平定位到对应时间
  const arrangeSeek = useCallback((clientX) => {
    const el = arrangeCanvasRef.current;
    const sc = scrollRef.current;
    if (!el || !sc) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    let gMax = 4;
    for (let ti = 0; ti < tracks.length; ti++) {
      const trk = tracks[ti];
      if (!trk || !trk.notes) continue;
      for (let ni = 0; ni < trk.notes.length; ni++) {
        const end = trk.notes[ni].startSec + trk.notes[ni].durationSec;
        if (end > gMax) gMax = end;
      }
    }
    const targetSec = ratio * gMax;
    sc.scrollLeft = Math.max(0, targetSec * zoomXRef.current - sc.clientWidth / 2);
  }, [tracks]);

  const canvasToLogical = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // 高 DPI 下 canvas.style.width = logicalW, rect.width = logicalW
    // 所以 CSS 坐标直接映射到逻辑坐标
    return { x: (clientX - rect.left) * (canvas.width / rect.width / DPR), y: (clientY - rect.top) * (canvas.height / rect.height / DPR) };
  };

  const logicalToSecPitch = (lx, ly) => {
    const sec = (lx + offsetXRef.current) / zoomX;
    let pitchIdx = Math.min(Math.max(Math.floor((ly + offsetYRef.current) / zoomY), 0), NOTE_COUNT - 1);
    return { sec: Math.max(0, sec), pitch: midiToNote(BASE_MIDI + (NOTE_COUNT - 1 - pitchIdx)) };
  };

  // 左侧钢琴键盘：点击试听音高
  const handleKeyboardClick = useCallback((e) => {
    const el = keyboardCanvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ly = (e.clientY - rect.top) * (el.height / rect.height / DPR);
    const pitchIdx = Math.min(Math.max(Math.floor(ly / zoomYRef.current), 0), NOTE_COUNT - 1);
    const midi = BASE_MIDI + (NOTE_COUNT - 1 - pitchIdx);
    playNoteRef.current(midiToNote(midi), 0.5, 100);
  }, []);

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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = e.touches ? e.touches[0] : e;
    const { x: lx, y: ly } = canvasToLogical(point.clientX, point.clientY);
    const isMiddle = !e.touches && e.button === 1; // 中键 = 高效删除（任意模式）
    const mode = isMiddle ? 'erase' : editModeRef.current;
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;

    // 中键：阻止自动滚动等默认行为
    if (isMiddle) e.preventDefault();

    // 触屏 + 指针模式：允许原生滚动，只在点击音符时选中
    if (mode === 'pointer') {
      const note = findNoteAtLogical(lx, ly);
      if (note) {
        e.preventDefault();
        setSelectedNotes(note ? [note] : []);
      }
      // 触屏长按：弹出右键菜单（P9）
      if (e.touches) {
        const touchPoint = point;
        longPressStartRef.current = { x: touchPoint.clientX, y: touchPoint.clientY };
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          // 长按触发时选中音符并打开菜单
          const lp = longPressStartRef.current;
          if (!lp) return;
          const { x: lpx, y: lpy } = canvasToLogical(lp.x, lp.y);
          const lpNote = findNoteAtLogical(lpx, lpy);
          if (lpNote && !selectedSetRef.current.has(lpNote)) setSelectedNotes([lpNote]);
          setContextMenu({ visible: true, x: lp.x, y: lp.y });
        }, 500);
      }
      return;
    }

    // 非指针模式才阻止默认行为（防止滚动）
    e.preventDefault();

    if (mode === 'draw') {
      const { sec, pitch } = logicalToSecPitch(lx, ly);
      const q = qStepRef.current;
      // 吸附模式：音符起点落在光标所在网格线（floor，标准 DAW 行为）
      // 自由模式：音符起点 = 光标精确位置
      const startSec = snapModeRef.current ? Math.floor(sec / q) * q : sec;
      const dur = snapModeRef.current ? Math.max(q, 0.05) : 0.2;
      const newNote = { pitch, startSec, durationSec: dur, velocity: 90 };
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
        // P5 优化：拖动开始时快照原始 notes 和选中集合，拖动期间仅用 ref 存位移
        const movingNotes = selSet.has(note) ? [...selectedNotesRef.current] : [note];
        if (!selSet.has(note)) setSelectedNotes([note]);
        dragOriginRef.current = {
          notes: trk.notes,
          selSet: new Set(movingNotes),
          startX: lx,
          startY: ly,
        };
        dragOffsetRef.current = { dSec: 0, dPitch: 0 };
        setDragState({ active: true, type: 'move', startX: lx, startY: ly, notes: movingNotes });
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
    // 触屏长按取消：移动超过阈值则取消长按菜单
    if (e.touches && longPressStartRef.current) {
      const tp = e.touches[0];
      const lp = longPressStartRef.current;
      if (tp && Math.hypot(tp.clientX - lp.x, tp.clientY - lp.y) > 12) {
        if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
        longPressStartRef.current = null;
      }
    }
    const ds = dragStateRef.current;
    if (!ds.active) return;

    // 拖拽时始终阻止滚动，即使被节流也要 preventDefault
    e.preventDefault();

    // 节流：限制状态更新频率为 ~30fps，减少 React 重渲染
    const now = performance.now();
    if (now - lastMoveTimeRef.current < 33) return;
    lastMoveTimeRef.current = now;

    const point = e.touches ? e.touches[0] : e;
    const { x: lx, y: ly } = canvasToLogical(point.clientX, point.clientY);
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    const zx = zoomXRef.current, zy = zoomYRef.current;

    if (ds.type === 'move') {
      // P5 优化：拖动期间不提交 onNotesChange/setSelectedNotes/setDragState
      // 仅更新 dragOffsetRef 并请求重绘，draw() 中绘制预览位置
      const origin = dragOriginRef.current;
      if (!origin) return;
      const dx = lx - origin.startX, dy = ly - origin.startY;
      // 自由模式：保留亚像素位移；吸附模式：dPitch 仍按行取整
      dragOffsetRef.current = { dSec: dx / zx, dPitch: Math.round(dy / zy) };
      requestRedraw();
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
    // 清理触屏长按计时器
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    longPressStartRef.current = null;
    const ds = dragStateRef.current;
    // P5 优化：拖动结束时一次性提交 move 结果
    if (ds.type === 'move' && dragOriginRef.current) {
      const origin = dragOriginRef.current;
      const off = dragOffsetRef.current;
      dragOriginRef.current = null;
      if (off.dSec !== 0 || off.dPitch !== 0) {
        const trk = trackRef.current;
        if (trk && trk.notes) {
          const selSet = origin.selSet;
          const q = qStepRef.current;
          const newSel = [];
          const updated = trk.notes.map(n => {
            if (!selSet.has(n)) return n;
            const midi = noteToMidi(n.pitch);
            const oldIdx = NOTE_COUNT - 1 - (midi - BASE_MIDI);
            const newIdx = Math.min(Math.max(0, oldIdx + off.dPitch), NOTE_COUNT - 1);
            const target = n.startSec + off.dSec;
            const newStart = snapModeRef.current ? Math.max(0, Math.round(target / q) * q) : Math.max(0, target);
            const newObj = {
              ...n,
              startSec: newStart,
              pitch: midiToNote(BASE_MIDI + (NOTE_COUNT - 1 - newIdx)),
            };
            newSel.push(newObj);
            return newObj;
          });
          updated.sort((a, b) => a.startSec - b.startSec);
          onNotesChangeRef.current(updated);
          setSelectedNotes(newSel);
        }
      }
    }
    if (ds.type === 'marquee') setMarqueeRect(null);
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
  }, [onNotesChange]);

  const setVelocity = useCallback((value) => {
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    onNotesChange(trk.notes.map(n => selectedSetRef.current.has(n) ? { ...n, velocity: Math.max(1, Math.min(127, value)) } : n));
  }, [onNotesChange]);

  // 移调（半音为单位）：+12 = 升八度，-12 = 降八度
  const transposeSelected = useCallback((semitones) => {
    const trk = trackRef.current;
    if (!trk || !trk.notes) return;
    const selSet = selectedSetRef.current;
    if (selSet.size === 0) return;
    const newSel = [];
    const updated = trk.notes.map(n => {
      if (!selSet.has(n)) return n;
      const midi = noteToMidi(n.pitch);
      const newMidi = Math.min(127, Math.max(0, midi + semitones));
      const newObj = { ...n, pitch: midiToNote(newMidi) };
      newSel.push(newObj);
      return newObj;
    });
    onNotesChangeRef.current(updated);
    setSelectedNotes(newSel);
    // 试听移调后第一个音符
    if (newSel.length > 0) playNoteRef.current(newSel[0].pitch, 0.3, newSel[0].velocity || 90);
  }, []);

  const copySelected = useCallback(() => {
    if (selectedNotes.length === 0) return;
    let minStart = Infinity;
    for (const n of selectedNotes) { if (n.startSec < minStart) minStart = n.startSec; }
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
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

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
      if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
      canvas.removeEventListener('mousedown', handlePointerDown);
      canvas.removeEventListener('touchstart', handlePointerDown);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, handleContextMenu]);

  // 双指缩放（pinch zoom）- 在指针模式下生效
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleTouchStartPinch = (e) => {
      if (e.touches.length !== 2) return;
      if (editModeRef.current !== 'pointer') return;
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      pinchStateRef.current = { startDist: dist, startZoomX: zoomXRef.current, startZoomY: zoomYRef.current };
      e.preventDefault();
    };

    const handleTouchMovePinch = (e) => {
      if (!pinchStateRef.current || e.touches.length !== 2) return;
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const scale = dist / pinchStateRef.current.startDist;
      const newZoomX = Math.min(300, Math.max(20, pinchStateRef.current.startZoomX * scale));
      const newZoomY = Math.min(40, Math.max(10, pinchStateRef.current.startZoomY * scale));
      setZoomX(newZoomX);
      setZoomY(newZoomY);
    };

    const handleTouchEndPinch = () => {
      pinchStateRef.current = null;
    };

    canvas.addEventListener('touchstart', handleTouchStartPinch, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMovePinch, { passive: false });
    canvas.addEventListener('touchend', handleTouchEndPinch);
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStartPinch);
      canvas.removeEventListener('touchmove', handleTouchMovePinch);
      canvas.removeEventListener('touchend', handleTouchEndPinch);
    };
  }, []);

  // 钢琴键盘画布 - 真实钢琴外观（黑白键 3D 渐变 + 高光/阴影），仅在 zoomY 变化时重绘
  const KEY_W = isNarrow ? 48 : 64;
  useEffect(() => {
    const el = keyboardCanvasRef.current;
    if (!el) return;
    const logicalH = NOTE_COUNT * zoomY;
    el.width = Math.round(KEY_W * DPR);
    el.height = Math.round(logicalH * DPR);
    el.style.width = KEY_W + 'px';
    el.style.height = logicalH + 'px';
    const ctx = el.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, KEY_W, logicalH);
    const blackW = Math.max(28, Math.round(KEY_W * 0.625));
    const blackX = KEY_W - blackW;
    const rowH = zoomY;
    // 先画所有白键底色（黑键下方也铺白底，模拟白键延续）
    for (let i = 0; i < NOTE_COUNT; i++) {
      const y = i * zoomY;
      // 白键渐变（上亮下暗，模拟弧面）
      const wg = ctx.createLinearGradient(0, y, 0, y + rowH);
      wg.addColorStop(0, '#f4f4f7');
      wg.addColorStop(0.5, '#e8e8ed');
      wg.addColorStop(1, '#d4d4da');
      ctx.fillStyle = wg;
      ctx.fillRect(0, y, KEY_W, rowH);
      // 白键之间缝隙阴影
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, y + rowH - 1, KEY_W, 1);
    }
    // 再画黑键（叠在白键上，带 3D 高光与投影）
    for (let i = 0; i < NOTE_COUNT; i++) {
      const midi = BASE_MIDI + (NOTE_COUNT - 1 - i);
      const y = i * zoomY;
      const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
      if (!isBlack) continue;
      // 黑键主体渐变
      const bg = ctx.createLinearGradient(0, y, 0, y + rowH);
      bg.addColorStop(0, '#3a3a42');
      bg.addColorStop(0.12, '#1e1e24');
      bg.addColorStop(0.85, '#0c0c10');
      bg.addColorStop(1, '#242428'); // 前缘反光
      ctx.fillStyle = bg;
      ctx.fillRect(blackX, y, blackW, rowH);
      // 顶部高光
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(blackX, y, blackW, 1);
      // 左右侧轻微高光（圆度感）
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(blackX, y, 1, rowH);
      // 底部前缘阴影线
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(blackX, y + rowH - 1.5, blackW, 1.5);
    }
    // C 音名标注（白键左侧）
    for (let i = 0; i < NOTE_COUNT; i++) {
      const midi = BASE_MIDI + (NOTE_COUNT - 1 - i);
      if (midi % 12 !== 0) continue;
      const y = i * zoomY;
      ctx.fillStyle = '#3a3a40';
      ctx.font = `${Math.min(10, Math.max(7, zoomY - 4))}px ui-monospace, monospace`;
      ctx.fillText(midiToNote(midi), 3, y + zoomY - 3);
    }
  }, [zoomY]);

  return (
    <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', borderRadius: 6, overflow: 'hidden', minHeight: 0 }}>
      {/* 工具栏：窄屏不 wrap（避免撑高挤压钢琴卷帘），改用横向滚动 */}
      <div style={{ padding: '3px 6px', display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'nowrap', overflowX: 'auto', background: 'var(--panel)', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <button onClick={() => setZoomX(z => Math.min(300, z * 1.2))} title={t.zoomIn} style={{ padding: '2px 6px' }}><Icons.ZoomIn /></button>
        <button onClick={() => setZoomX(z => Math.max(20, z * 0.8))} title={t.zoomOut} style={{ padding: '2px 6px' }}><Icons.ZoomOut /></button>
        <button onClick={() => { offsetXRef.current = 0; offsetYRef.current = 0; setZoomX(isNarrow ? 60 : 80); setZoomY(isNarrow ? 16 : 20); }} title={t.resetView} style={{ padding: '2px 6px' }}><Icons.Reset /></button>
        <button
          onClick={() => setShowGhosts(s => !s)}
          className={showGhosts ? 'active' : ''}
          title={lang === 'zh' ? (showGhosts ? '隐藏其他轨道' : '显示其他轨道') : (showGhosts ? 'Hide other tracks' : 'Show other tracks')}
          style={{ padding: '2px 6px', fontSize: '0.65rem' }}
        >
          Ghost
        </button>
        <button
          onClick={() => setSnapMode(s => !s)}
          className={snapMode ? 'active' : ''}
          title={lang === 'zh' ? (snapMode ? '吸附：网格（点击关闭自由放置）' : '吸附：自由（点击开启网格吸附）') : (snapMode ? 'Snap: Grid (click for free)' : 'Snap: Free (click for grid)')}
          style={{ padding: '2px 6px', fontSize: '0.65rem' }}
        >
          {snapMode ? (lang === 'zh' ? '吸附' : 'Snap') : (lang === 'zh' ? '自由' : 'Free')}
        </button>
        <button
          onClick={() => setShowArrange(s => !s)}
          className={showArrange ? 'active' : ''}
          title={lang === 'zh' ? (showArrange ? '隐藏编排概览' : '显示编排概览（所有轨道同时间线）') : (showArrange ? 'Hide arrangement' : 'Show arrangement overview')}
          style={{ padding: '2px 6px', fontSize: '0.65rem' }}
        >
          {lang === 'zh' ? '编排' : 'Arrng'}
        </button>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {selectedNotes.length > 0 ? `${selectedNotes.length} ${lang === 'zh' ? '个音符' : ' notes'}` : ''}
        </span>
      </div>

      {/* P6 编排概览：所有轨道同时间线迷你总览 */}
      {showArrange && (
        <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', background: '#16161b', position: 'relative' }}>
          <canvas
            ref={arrangeCanvasRef}
            style={{ display: 'block', cursor: 'pointer' }}
            onMouseDown={(e) => arrangeSeek(e.clientX)}
          />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ width: KEY_W, flexShrink: 0, background: 'var(--track-bg)', borderRight: '1px solid var(--border)', overflow: 'hidden', position: 'relative' }}>
          <canvas ref={keyboardCanvasRef} style={{ display: 'block', cursor: 'pointer', transform: 'translateY(0px)' }} onMouseDown={handleKeyboardClick} onTouchStart={(e) => { if (e.touches[0]) handleKeyboardClick(e.touches[0]); }} />
        </div>
        <div className="piano-roll-scroll" ref={scrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }} onScroll={(e) => {
          offsetXRef.current = e.target.scrollLeft;
          offsetYRef.current = e.target.scrollTop;
          if (keyboardCanvasRef.current) keyboardCanvasRef.current.style.transform = `translateY(${-e.target.scrollTop}px)`;
          requestRedraw();
          if (showArrange) drawArrange();
        }}>
          <canvas ref={canvasRef} width={800} height={300} style={{ display: 'block', touchAction: editMode === 'pointer' ? 'pan-x pan-y' : 'none' }} />
          <canvas ref={playheadCanvasRef} width={800} height={300} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
        </div>
      </div>

      {contextMenu.visible && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={closeCM} onContextMenu={e => { e.preventDefault(); closeCM(); }}>
          <div style={{ position: 'fixed', top: Math.min(contextMenu.y, window.innerHeight - 380), left: Math.min(contextMenu.x, window.innerWidth - 170), background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 1000, minWidth: 160, padding: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', padding: '4px 8px', borderBottom: '1px solid var(--border)', marginBottom: 3 }}>
              {selectedNotes.length > 0 ? `${selectedNotes.length} ${lang === 'zh' ? '个音符' : ' notes'}` : ''}
            </div>
            <button onClick={() => quantizeNotes(1/8)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.quantize8th}</button>
            <button onClick={() => quantizeNotes(1/4)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.quantize4th}</button>
            <button onClick={() => quantizeNotes(1/2)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.quantizeHalf}</button>
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
            <button onClick={() => changeVelocity(10)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.changeVelocity} +10</button>
            <button onClick={() => changeVelocity(-10)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>{t.changeVelocity} -10</button>
            {selectedNotes.length > 0 && (
              <div style={{ padding: '4px 8px' }}>
                <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>
                  {lang === 'zh' ? '音量' : 'Volume'}: {selectedNotes[0]?.velocity || 0}
                </label>
                <input type="range" min="1" max="127" value={selectedNotes[0]?.velocity || 90}
                  onChange={e => setVelocity(parseInt(e.target.value))}
                  onMouseDown={e => e.stopPropagation()}
                  style={{ width: '100%', cursor: 'pointer' }} />
              </div>
            )}
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
            {/* 移调 */}
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', padding: '4px 8px 2px' }}>{lang === 'zh' ? '移调' : 'Transpose'}</div>
            <div style={{ display: 'flex', gap: 3, padding: '0 8px 4px' }}>
              <button onClick={() => transposeSelected(-12)} style={{ flex: 1, padding: '4px 0', fontSize: '0.68rem', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--track-bg)', color: 'var(--text)' }}>-8va</button>
              <button onClick={() => transposeSelected(-1)} style={{ flex: 1, padding: '4px 0', fontSize: '0.68rem', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--track-bg)', color: 'var(--text)' }}>−1</button>
              <button onClick={() => transposeSelected(1)} style={{ flex: 1, padding: '4px 0', fontSize: '0.68rem', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--track-bg)', color: 'var(--text)' }}>+1</button>
              <button onClick={() => transposeSelected(12)} style={{ flex: 1, padding: '4px 0', fontSize: '0.68rem', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--track-bg)', color: 'var(--text)' }}>+8va</button>
            </div>
            <div style={{ display: 'flex', gap: 3, padding: '0 8px 4px', alignItems: 'center' }}>
              <input type="number" id="transpose-input" defaultValue="0" style={{ width: 50, fontSize: '0.7rem', padding: '2px 4px' }} onMouseDown={e => e.stopPropagation()} placeholder="±N" />
              <button onClick={() => { const inp = document.getElementById('transpose-input'); const v = parseInt(inp?.value); if (!isNaN(v) && v !== 0) transposeSelected(v); }} style={{ flex: 1, padding: '4px 0', fontSize: '0.68rem', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--track-bg)', color: 'var(--text)' }}>{lang === 'zh' ? '应用' : 'Apply'}</button>
            </div>
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
