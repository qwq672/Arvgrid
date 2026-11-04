import React, { useRef, useState, useCallback, useEffect, memo } from 'react';
import { sampleAutomation } from '../lib/automation';

// SVG 关键帧编辑器
// props:
//   points:   [{ t, v }]  v 已归一化到 0~1
//   duration: 横轴总秒数
//   param:    AUTOMATION_PARAMS 项（用于显示自然单位值）
//   currentTime: 当前播放时间（用于画播放头）
//   onChange: (nextPoints) => void
//   height:   SVG 高度（默认 140）
//
// 交互：
//   - 拖拽关键帧点
//   - 双击空白添加点
//   - 右键点删除（或长按移动端）
//   - 拖拽点不会跨越相邻点
const AutomationCurveEditor = memo(({
  points = [],
  duration = 16,
  param,
  currentTime = 0,
  onChange,
  height = 140,
}) => {
  const svgRef = useRef(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [dragMode, setDragMode] = useState(null); // 'move' | 'time' | 'value'
  const WIDTH = 600; // viewBox 宽度，实际可缩放
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 10;
  const PAD_B = 18;
  const PLOT_W = WIDTH - PAD_L - PAD_R;
  const PLOT_H = height - PAD_T - PAD_B;

  // t -> x
  const tToX = useCallback((t) => {
    const d = Math.max(0.001, duration);
    const clampedT = Math.max(0, Math.min(d, t));
    return PAD_L + (clampedT / d) * PLOT_W;
  }, [duration, PAD_L, PLOT_W]);

  // v (0~1) -> y
  const vToY = useCallback((v) => {
    const clampedV = Math.max(0, Math.min(1, v));
    return PAD_T + (1 - clampedV) * PLOT_H;
  }, [PAD_T, PLOT_H]);

  const xToT = useCallback((x) => {
    return Math.max(0, Math.min(duration, ((x - PAD_L) / PLOT_W) * duration));
  }, [duration, PAD_L, PLOT_W]);

  const yToV = useCallback((y) => {
    const v = 1 - (y - PAD_T) / PLOT_H;
    return Math.max(0, Math.min(1, v));
  }, [PAD_T, PLOT_H]);

  // 把 svg 坐标系转成 viewBox 坐标
  const toViewBox = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const handlePointDown = useCallback((e, idx, mode) => {
    e.preventDefault();
    e.stopPropagation();
    setDragIdx(idx);
    setDragMode(mode);
  }, []);

  const handleBgDoubleClick = useCallback((e) => {
    if (!onChange) return;
    const { x } = toViewBox(e.clientX, e.clientY);
    const t = xToT(x);
    const next = points.slice().sort((a, b) => a.t - b.t);
    next.push({ t, v: 0.5 });
    next.sort((a, b) => a.t - b.t);
    onChange(next);
  }, [points, onChange, toViewBox, xToT]);

  const handleBgContextMenu = useCallback((e) => {
    // 右键空白处不做删除（避免误删）
    e.preventDefault();
  }, []);

  // 全局 mousemove / mouseup（拖拽时即使鼠标移出 SVG 也响应）
  useEffect(() => {
    if (dragIdx == null) return;
    const onMove = (e) => {
      const { x, y } = toViewBox(e.clientX, e.clientY);
      const newT = xToT(x);
      const newV = yToV(y);
      const next = points.slice();
      const original = next[dragIdx];
      let updated;
      if (dragMode === 'time') {
        // 只改时间
        // 不允许跨越邻居
        const prevPt = next[dragIdx - 1];
        const nextPt = next[dragIdx + 1];
        let clampedT = newT;
        if (prevPt) clampedT = Math.max(clampedT, prevPt.t + 0.01);
        if (nextPt) clampedT = Math.min(clampedT, nextPt.t - 0.01);
        updated = { ...original, t: Math.max(0, clampedT) };
      } else if (dragMode === 'value') {
        updated = { ...original, v: newV };
      } else {
        // move: 改时间 + 改值
        const prevPt = next[dragIdx - 1];
        const nextPt = next[dragIdx + 1];
        let clampedT = newT;
        if (prevPt) clampedT = Math.max(clampedT, prevPt.t + 0.01);
        if (nextPt) clampedT = Math.min(clampedT, nextPt.t - 0.01);
        updated = { ...original, t: Math.max(0, clampedT), v: newV };
      }
      next[dragIdx] = updated;
      if (onChange) onChange(next);
    };
    const onUp = () => {
      setDragIdx(null);
      setDragMode(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragIdx, dragMode, points, onChange, toViewBox, xToT, yToV]);

  // 删除点（右键点）
  const handlePointContext = useCallback((e, idx) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onChange) return;
    if (points.length <= 2) return; // 至少保留 2 个点
    const next = points.slice();
    next.splice(idx, 1);
    onChange(next);
  }, [points, onChange]);

  // 计算插值曲线 path
  const sortedPts = points.slice().sort((a, b) => a.t - b.t);
  const linePath = sortedPts.length > 0
    ? sortedPts.map((p, i) => {
        const x = tToX(p.t);
        const y = vToY(p.v);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      }).join(' ')
    : '';
  // 填充区域 path（曲线下方）
  const areaPath = sortedPts.length > 0
    ? `${linePath} L${tToX(sortedPts[sortedPts.length - 1].t).toFixed(2)},${vToY(0).toFixed(2)} L${tToX(sortedPts[0].t).toFixed(2)},${vToY(0).toFixed(2)} Z`
    : '';

  // 当前播放头
  const playheadX = tToX(currentTime);
  const currentV = sampleAutomation(points, currentTime);
  const playheadY = currentV != null ? vToY(currentV) : null;

  // 横轴时间刻度
  const tickCount = Math.min(8, Math.max(4, Math.floor(duration / 2)));
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (duration * i) / tickCount);

  // 纵轴刻度（min / mid / max 自然值）
  const minLabel = param ? formatVal(param.fromNormalized(0), param) : '0';
  const midLabel = param ? formatVal(param.fromNormalized(0.5), param) : '0.5';
  const maxLabel = param ? formatVal(param.fromNormalized(1), param) : '1';

  return (
    <div style={{ width: '100%', userSelect: 'none' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, background: 'var(--automation-bg, #1a1d23)', borderRadius: 6, cursor: 'crosshair', touchAction: 'none' }}
        onDoubleClick={handleBgDoubleClick}
        onContextMenu={handleBgContextMenu}
      >
        {/* 网格 */}
        {ticks.map((t, i) => {
          const x = tToX(t);
          return (
            <g key={`tick-${i}`}>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + PLOT_H} stroke="var(--automation-grid, #2a2e36)" strokeWidth="0.5" />
              <text x={x} y={height - 4} fill="var(--automation-tick, #6b7280)" fontSize="8" textAnchor="middle">{formatTime(t)}</text>
            </g>
          );
        })}
        {/* 水平网格 */}
        {[0, 0.25, 0.5, 0.75, 1].map(v => {
          const y = vToY(v);
          return <line key={`h-${v}`} x1={PAD_L} y1={y} x2={WIDTH - PAD_R} y2={y} stroke="var(--automation-grid, #2a2e36)" strokeWidth="0.5" />;
        })}
        {/* 纵轴标签 */}
        <text x={4} y={PAD_T + 4} fill="var(--automation-tick, #6b7280)" fontSize="8">{maxLabel}</text>
        <text x={4} y={PAD_T + PLOT_H / 2 + 3} fill="var(--automation-tick, #6b7280)" fontSize="8">{midLabel}</text>
        <text x={4} y={PAD_T + PLOT_H} fill="var(--automation-tick, #6b7280)" fontSize="8">{minLabel}</text>

        {/* 区域填充 */}
        {areaPath && (
          <path d={areaPath} fill="var(--automation-area, rgba(74,158,255,0.12))" stroke="none" />
        )}
        {/* 曲线 */}
        {linePath && (
          <path d={linePath} fill="none" stroke="var(--automation-line, #4a9eff)" strokeWidth="1.5" strokeLinejoin="round" />
        )}

        {/* 播放头 */}
        {playheadY != null && (
          <g>
            <line x1={playheadX} y1={PAD_T} x2={playheadX} y2={PAD_T + PLOT_H} stroke="var(--automation-playhead, #ffd43b)" strokeWidth="0.8" strokeDasharray="3 2" />
            <circle cx={playheadX} cy={playheadY} r="3" fill="var(--automation-playhead, #ffd43b)" stroke="#000" strokeWidth="0.5" />
          </g>
        )}

        {/* 关键帧点 */}
        {sortedPts.map((p, i) => {
          const x = tToX(p.t);
          const y = vToY(p.v);
          const isDragging = dragIdx === i;
          const isHover = hoverIdx === i;
          const r = isDragging ? 5 : isHover ? 4.5 : 3.5;
          return (
            <g key={i}>
              {/* 拖拽热区（透明大圆，方便点击） */}
              <circle
                cx={x} cy={y} r="9"
                fill="transparent"
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => handlePointDown(e, i, 'move')}
                onContextMenu={(e) => handlePointContext(e, i)}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
              <circle
                cx={x} cy={y} r={r}
                fill={isDragging ? 'var(--automation-point-active, #ffd43b)' : 'var(--automation-point, #fff)'}
                stroke="var(--automation-point-stroke, #4a9eff)"
                strokeWidth="1.2"
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
        <span>双击空白添加点 · 右键点删除</span>
        <span>{sortedPts.length} 个关键帧</span>
      </div>
    </div>
  );
});

function formatTime(sec) {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(0).padStart(2, '0')}`;
}

function formatVal(naturalVal, param) {
  if (!param) return naturalVal.toFixed(2);
  const v = param.step && param.step >= 1 ? Math.round(naturalVal) : naturalVal.toFixed(2);
  return `${v}${param.unit || ''}`;
}

export default AutomationCurveEditor;
