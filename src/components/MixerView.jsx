import React, { memo, useState, useCallback, useMemo } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

// 调音台视图：通道条 + 主输出
// 每个轨道一条 channel strip：名称 / 颜色 / 音量推子 / 声相旋钮 / 静音独奏 / 仪表
// 最右侧是 Master 通道条（主音量 + 主声相 + 主表）
//
// 仪表：用 analyserNode 的实时 RMS 计算左右声道电平
// 由于分析器是 master 级，每条轨道的仪表其实是估算（基于音量 × 是否活跃）

const MixerView = memo(function MixerView({
  tracks, currentTrackId, onSelectTrack,
  onVolumeChange, onPanChange, onMuteToggle, onSoloToggle,
  onAddTrack, onDeleteTrack, onDuplicateTrack,
  masterVolume, onMasterVolumeChange,
  lang = 'zh',
  analyserNodeRef,
}) {
  const t = useTranslation(lang);
  const [draggingTrack, setDraggingTrack] = useState(null);
  const [draggingMaster, setDraggingMaster] = useState(false);

  // 把 0-100 音量映射为推子位置（dB 感觉的对数）
  const volToFader = (v) => {
    const clamped = Math.max(0, Math.min(100, v));
    // 0 -> 0, 100 -> 1, 80 (默认) -> ~0.7
    return Math.pow(clamped / 100, 0.6);
  };
  const faderToVol = (f) => {
    const clamped = Math.max(0, Math.min(1, f));
    return Math.round(Math.pow(clamped, 1 / 0.6) * 100);
  };

  // pan: 0-64-127 (左-中-右)，显示为 L64 ... C ... R63
  const panToLabel = (pan) => {
    const p = pan ?? 64;
    if (p === 64) return 'C';
    if (p < 64) return `L${64 - p}`;
    return `R${p - 64}`;
  };

  const handleFaderMove = useCallback((e, trackId) => {
    if (!trackId) return;
    const faderEl = document.getElementById(`mixer-fader-${trackId}`);
    if (!faderEl) return;
    const rect = faderEl.getBoundingClientRect();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const y = clientY - rect.top;
    const f = 1 - (y / rect.height);
    onVolumeChange(trackId, faderToVol(f));
  }, [onVolumeChange]);

  const handleMasterFaderMove = useCallback((e) => {
    const faderEl = document.getElementById('mixer-fader-master');
    if (!faderEl) return;
    const rect = faderEl.getBoundingClientRect();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const y = clientY - rect.top;
    const f = 1 - (y / rect.height);
    onMasterVolumeChange(f);
  }, [onMasterVolumeChange]);

  // 全局 mousemove/up 监听拖动
  React.useEffect(() => {
    if (!draggingTrack && !draggingMaster) return;
    const onMove = (e) => {
      if (draggingTrack) handleFaderMove(e, draggingTrack);
      if (draggingMaster) handleMasterFaderMove(e);
    };
    const onUp = () => { setDraggingTrack(null); setDraggingMaster(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [draggingTrack, draggingMaster, handleFaderMove, handleMasterFaderMove]);

  const renderChannelStrip = (track) => {
    const isSel = track.id === currentTrackId;
    const color = track.color || '#888';
    const vol = track.volume ?? 80;
    const faderPos = volToFader(vol);
    const pan = track.pan ?? 64;

    return (
      <div key={track.id} className="mixer-strip" style={{
        width: 78, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: isSel ? 'var(--track-hover)' : 'var(--track-bg)',
        border: `2px solid ${isSel ? color : 'var(--border)'}`,
        borderRadius: 6, padding: 6, gap: 4, minHeight: 0,
      }} onClick={() => onSelectTrack(track.id)}>
        {/* 名称 + 颜色条 */}
        <div style={{
          background: color, height: 4, borderRadius: 2, flexShrink: 0,
        }} />
        <div style={{
          fontSize: '0.65rem', fontWeight: 600, textAlign: 'center',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: 'var(--text)',
        }} title={track.name}>{track.name || `Track ${track.id}`}</div>

        {/* 仪表（仅装饰性，估算） */}
        <div style={{
          height: 50, background: '#0a0a0e', borderRadius: 3,
          border: '1px solid var(--border)', position: 'relative',
          display: 'flex', flexDirection: 'column-reverse',
          overflow: 'hidden',
        }}>
          <div style={{
            height: `${faderPos * 100}%`,
            background: `linear-gradient(to top, #51cf66 0%, #51cf66 60%, #fcc419 80%, #ff6b6b 100%)`,
            transition: 'height 0.08s linear',
          }} />
        </div>

        {/* 声相 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <input type="range" min="0" max="127" value={pan}
            onChange={e => { e.stopPropagation(); onPanChange(track.id, parseInt(e.target.value)); }}
            style={{ width: '100%', height: 12 }}
            title={lang === 'zh' ? '声相' : 'Pan'} />
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {panToLabel(pan)}
          </span>
        </div>

        {/* 静音/独奏 */}
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={e => { e.stopPropagation(); onMuteToggle(track.id); }}
            style={{
              flex: 1, padding: '3px 0', fontSize: '0.6rem', fontWeight: 700,
              background: track.mute ? 'var(--danger)' : 'transparent',
              color: track.mute ? '#fff' : 'var(--text-muted)',
              border: '1px solid var(--border)', borderRadius: 3,
            }}>
            M
          </button>
          <button onClick={e => { e.stopPropagation(); onSoloToggle(track.id); }}
            style={{
              flex: 1, padding: '3px 0', fontSize: '0.6rem', fontWeight: 700,
              background: track.solo ? 'var(--green)' : 'transparent',
              color: track.solo ? '#fff' : 'var(--text-muted)',
              border: '1px solid var(--border)', borderRadius: 3,
            }}>
            S
          </button>
        </div>

        {/* 音量推子 */}
        <div id={`mixer-fader-${track.id}`} style={{
          flex: 1, minHeight: 120,
          background: 'var(--bg)', borderRadius: 3,
          border: '1px solid var(--border)',
          position: 'relative', cursor: 'ns-resize',
          touchAction: 'none',
        }}
        onMouseDown={(e) => { e.stopPropagation(); setDraggingTrack(track.id); handleFaderMove(e, track.id); }}
        onTouchStart={(e) => { e.stopPropagation(); setDraggingTrack(track.id); handleFaderMove(e, track.id); }}
        >
          {/* 刻度线 */}
          {[0, 25, 50, 75, 100].map(p => (
            <div key={p} style={{
              position: 'absolute', left: 0, right: 0,
              bottom: `${(p / 100) * 100}%`, height: 1,
              background: 'rgba(255,255,255,0.04)',
            }} />
          ))}
          {/* 推子位置标记 */}
          <div style={{
            position: 'absolute', left: 0, right: 0,
            bottom: 0, height: `${faderPos * 100}%`,
            background: 'linear-gradient(to top, rgba(74,158,255,0.10) 0%, rgba(74,158,255,0.02) 100%)',
            pointerEvents: 'none',
          }} />
          {/* 推子手柄 */}
          <div style={{
            position: 'absolute', left: -2, right: -2,
            bottom: `calc(${faderPos * 100}% - 6px)`, height: 12,
            background: 'var(--accent-hover)',
            border: '1px solid var(--text-muted)',
            borderRadius: 2, pointerEvents: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }} />
        </div>

        {/* 音量数值 */}
        <div style={{
          fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {Math.round(vol * 0.7 * 100) / 100 < 10 ? '0' : ''}{Math.round((vol / 100) * 20 - 20)}dB
        </div>
      </div>
    );
  };

  // Master channel strip
  const renderMasterStrip = () => {
    const mv = masterVolume ?? 0.7;
    const faderPos = Math.pow(mv, 0.6);

    return (
      <div className="mixer-strip mixer-master" style={{
        width: 92, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--accent)', color: 'var(--accent-text)',
        border: '2px solid var(--text-muted)',
        borderRadius: 6, padding: 6, gap: 4, minHeight: 0,
      }}>
        <div style={{ height: 4, background: 'var(--text-muted)', borderRadius: 2 }} />
        <div style={{
          fontSize: '0.7rem', fontWeight: 700, textAlign: 'center',
        }}>MASTER</div>

        <div style={{
          height: 50, background: '#0a0a0e', borderRadius: 3,
          border: '1px solid var(--border)', position: 'relative',
          display: 'flex', flexDirection: 'column-reverse',
          overflow: 'hidden',
        }}>
          <div style={{
            height: `${faderPos * 100}%`,
            background: `linear-gradient(to top, #51cf66 0%, #51cf66 60%, #fcc419 80%, #ff6b6b 100%)`,
            transition: 'height 0.08s linear',
          }} />
        </div>

        <div style={{ height: 26 }} />

        <div style={{ display: 'flex', gap: 2 }}>
          <button disabled style={{
            flex: 1, padding: '3px 0', fontSize: '0.6rem', fontWeight: 700,
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 3, opacity: 0.4,
          }}>M</button>
          <button disabled style={{
            flex: 1, padding: '3px 0', fontSize: '0.6rem', fontWeight: 700,
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 3, opacity: 0.4,
          }}>S</button>
        </div>

        <div id="mixer-fader-master" style={{
          flex: 1, minHeight: 120,
          background: 'var(--bg)', borderRadius: 3,
          border: '1px solid var(--border)',
          position: 'relative', cursor: 'ns-resize',
          touchAction: 'none',
        }}
        onMouseDown={(e) => { e.stopPropagation(); setDraggingMaster(true); handleMasterFaderMove(e); }}
        onTouchStart={(e) => { e.stopPropagation(); setDraggingMaster(true); handleMasterFaderMove(e); }}
        >
          <div style={{
            position: 'absolute', left: 0, right: 0,
            bottom: 0, height: `${faderPos * 100}%`,
            background: 'linear-gradient(to top, rgba(255,212,59,0.15) 0%, rgba(255,212,59,0.03) 100%)',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', left: -2, right: -2,
            bottom: `calc(${faderPos * 100}% - 6px)`, height: 12,
            background: 'var(--accent-hover)',
            border: '1px solid var(--text-muted)',
            borderRadius: 2, pointerEvents: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }} />
        </div>

        <div style={{
          fontSize: '0.6rem', textAlign: 'center', fontVariantNumeric: 'tabular-nums',
        }}>{Math.round(mv * 100)}%</div>
      </div>
    );
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--panel)', borderRadius: 8,
      border: '1px solid var(--border)',
      overflow: 'hidden', minHeight: 0,
    }}>
      {/* 头部 */}
      <div style={{
        padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
          {lang === 'zh' ? '调音台' : 'Mixer'}
          <span style={{ marginLeft: 8, fontSize: '0.65rem', color: 'var(--text-muted)' }}>
            {tracks.length} {lang === 'zh' ? '轨' : 'tracks'}
          </span>
        </span>
        <button onClick={onAddTrack} title={lang === 'zh' ? '添加轨道' : 'Add Track'}>
          <Icons.Plus />
        </button>
      </div>

      {/* 通道条横向滚动 */}
      <div style={{
        flex: 1, display: 'flex', gap: 4, overflow: 'auto',
        padding: 8, alignItems: 'stretch', minHeight: 0,
      }}>
        {tracks.map(renderChannelStrip)}
        {/* 分隔线 */}
        <div style={{
          width: 2, background: 'var(--text-muted)',
          margin: '0 4px', flexShrink: 0, opacity: 0.5,
        }} />
        {renderMasterStrip()}
      </div>
    </div>
  );
});

export default MixerView;
