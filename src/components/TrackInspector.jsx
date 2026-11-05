import React, { memo, useState, useCallback } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

// 右侧 Inspector 面板：当前选中轨道的属性 + FX 链
// 1. 轨道名 + 颜色 + 重命名
// 2. 乐器选择按钮
// 3. 音量 / 声相 / 静音 / 独奏
// 4. 单轨效果器 (eqLow/eqMid/eqHigh + reverbSend + delaySend)
// 5. 注释
//
// 设计目标：把 TrackPanel 里杂乱的控件抽出来到右侧，让 TrackPanel 只显示轨道列表
const TrackInspector = memo(function TrackInspector({
  track,
  onRename, onColorChange, onCommentChange,
  onVolumeChange, onPanChange, onMuteToggle, onSoloToggle,
  onProgramChange, onEffectsChange, onTrackReverbChange,
  onOpenInstrumentPicker,
  lang = 'zh',
}) {
  const t = useTranslation(lang);
  const [nameEdit, setNameEdit] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  if (!track) {
    return (
      <div className="track-inspector" style={{
        width: 'clamp(180px, 18vw, 240px)', flexShrink: 0,
        background: 'var(--panel)', borderRadius: 8,
        border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, color: 'var(--text-muted)', fontSize: '0.75rem',
      }}>
        {lang === 'zh' ? '选中一条轨道查看属性' : 'Select a track'}
      </div>
    );
  }

  const color = track.color || '#888';
  const effects = track.effects || { eqLow: 0, eqMid: 0, eqHigh: 0, reverbSend: 0, delaySend: 0 };
  const TRACK_COLORS = ['#339af0','#ff6b6b','#ff922b','#fcc419','#51cf66','#20c997','#845ef7','#e64980','#adb5bd','#ff8787','#d8f5a2','#748ffc'];

  const updateEffect = (key, val) => {
    onEffectsChange && onEffectsChange(track.id, { ...effects, [key]: val });
  };

  return (
    <div className="track-inspector" style={{
      width: 'clamp(180px, 18vw, 240px)', flexShrink: 0,
      background: 'var(--panel)', borderRadius: 8,
      border: `2px solid ${color}`,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', minHeight: 0,
    }}>
      {/* 头部 */}
      <div style={{
        padding: '8px 10px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
        {nameEdit ? (
          <input
            type="text" value={nameDraft} autoFocus
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => { onRename && onRename(track.id, nameDraft); setNameEdit(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { onRename && onRename(track.id, nameDraft); setNameEdit(false); }
              if (e.key === 'Escape') setNameEdit(false);
            }}
            style={{ flex: 1, fontSize: '0.8rem', padding: '2px 4px' }}
          />
        ) : (
          <span
            onDoubleClick={() => { setNameDraft(track.name || ''); setNameEdit(true); }}
            style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: 'text' }}
            title={lang === 'zh' ? '双击重命名' : 'Double-click to rename'}
          >
            {track.name || `Track ${track.id}`}
          </span>
        )}
      </div>

      {/* 内容滚动 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* 乐器选择 */}
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {lang === 'zh' ? '乐器' : 'Instrument'}
          </div>
          <button
            onClick={() => onOpenInstrumentPicker && onOpenInstrumentPicker(track.id)}
            style={{
              width: '100%', padding: '6px 8px', textAlign: 'left',
              background: 'var(--track-bg)', border: '1px solid var(--border)',
              borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer',
            }}
          >
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>P{track.program ?? 0}</span>
            {track.isDrum
              ? (lang === 'zh' ? '鼓组' : 'Drum Kit')
              : `${track.program ?? 0}: ${(GM_NAME(track.program, lang))}`}
          </button>
        </div>

        {/* 颜色 */}
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {lang === 'zh' ? '颜色' : 'Color'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {TRACK_COLORS.map(c => (
              <div
                key={c}
                onClick={() => onColorChange && onColorChange(track.id, c)}
                style={{
                  width: 18, height: 18, borderRadius: 4, background: c,
                  cursor: 'pointer',
                  border: c === color ? '2px solid var(--text)' : '1px solid var(--border)',
                }}
              />
            ))}
          </div>
        </div>

        {/* 音量 + 声相 + M/S */}
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {lang === 'zh' ? '混音' : 'Mixer'}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <button
              onClick={() => onMuteToggle && onMuteToggle(track.id)}
              style={{
                flex: 1, padding: '4px 0', fontSize: '0.7rem', fontWeight: 700,
                background: track.mute ? 'var(--danger)' : 'var(--track-bg)',
                color: track.mute ? '#fff' : 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 4,
              }}
            >M</button>
            <button
              onClick={() => onSoloToggle && onSoloToggle(track.id)}
              style={{
                flex: 1, padding: '4px 0', fontSize: '0.7rem', fontWeight: 700,
                background: track.solo ? 'var(--green)' : 'var(--track-bg)',
                color: track.solo ? '#fff' : 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 4,
              }}
            >S</button>
          </div>
          <InspRow label={lang === 'zh' ? '音量' : 'Vol'} value={`${track.volume ?? 80}`} min={0} max={100}
            onChange={v => onVolumeChange && onVolumeChange(track.id, Math.round(v))} current={track.volume ?? 80} />
          <InspRow label={lang === 'zh' ? '声相' : 'Pan'} value={panLabel(track.pan ?? 64)} min={0} max={127}
            onChange={v => onPanChange && onPanChange(track.id, Math.round(v))} current={track.pan ?? 64} />
          <InspRow label={lang === 'zh' ? '混响' : 'Rev'} value={`${track.reverb ?? 0}%`} min={0} max={100}
            onChange={v => onTrackReverbChange && onTrackReverbChange(track.id, Math.round(v))} current={track.reverb ?? 0} />
        </div>

        {/* 单轨效果器 */}
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {lang === 'zh' ? '效果器 (单轨)' : 'FX (Track)'}
          </div>
          <InspRow label={lang === 'zh' ? 'EQ 低' : 'EQ Low'} value={`${effects.eqLow > 0 ? '+' : ''}${effects.eqLow?.toFixed(1) || '0.0'}`} min={-12} max={12} step={0.5}
            onChange={v => updateEffect('eqLow', v)} current={effects.eqLow || 0} />
          <InspRow label={lang === 'zh' ? 'EQ 中' : 'EQ Mid'} value={`${effects.eqMid > 0 ? '+' : ''}${effects.eqMid?.toFixed(1) || '0.0'}`} min={-12} max={12} step={0.5}
            onChange={v => updateEffect('eqMid', v)} current={effects.eqMid || 0} />
          <InspRow label={lang === 'zh' ? 'EQ 高' : 'EQ High'} value={`${effects.eqHigh > 0 ? '+' : ''}${effects.eqHigh?.toFixed(1) || '0.0'}`} min={-12} max={12} step={0.5}
            onChange={v => updateEffect('eqHigh', v)} current={effects.eqHigh || 0} />
          <InspRow label={lang === 'zh' ? '混响发送' : 'Rev Snd'} value={`${Math.round((effects.reverbSend || 0) * 100)}%`} min={0} max={1} step={0.01}
            onChange={v => updateEffect('reverbSend', v)} current={effects.reverbSend || 0} />
          <InspRow label={lang === 'zh' ? '延迟发送' : 'Dly Snd'} value={`${Math.round((effects.delaySend || 0) * 100)}%`} min={0} max={1} step={0.01}
            onChange={v => updateEffect('delaySend', v)} current={effects.delaySend || 0} />
        </div>

        {/* 注释 */}
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {lang === 'zh' ? '注释' : 'Comment'}
          </div>
          <textarea
            defaultValue={track.comment || ''}
            onBlur={e => onCommentChange && onCommentChange(track.id, e.target.value)}
            placeholder={lang === 'zh' ? '可选注释...' : 'Optional notes...'}
            style={{
              width: '100%', minHeight: 50, fontSize: '0.72rem',
              padding: '6px 8px', resize: 'vertical',
              background: 'var(--bg-input)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 4,
            }}
          />
        </div>
      </div>
    </div>
  );
});

function InspRow({ label, value, min, max, step = 1, onChange, current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
      <span style={{ width: 50, fontSize: '0.65rem', color: 'var(--text-muted)' }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step}
        value={current}
        onChange={e => onChange && onChange(parseFloat(e.target.value))}
        style={{ flex: 1, height: 12 }}
      />
      <span style={{
        width: 38, fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
    </div>
  );
}

function panLabel(pan) {
  if (pan === 64) return 'C';
  if (pan < 64) return `L${64 - pan}`;
  return `R${pan - 64}`;
}

function GM_NAME(program, lang) {
  // 简单查表，Inspector 用 (避免依赖 TrackPanel 的 GM_INSTRUMENTS)
  const NAMES = {
    0: { zh: '大钢琴', en: 'Acoustic Grand Piano' },
    1: { zh: '亮音钢琴', en: 'Bright Piano' },
    4: { zh: '电钢琴', en: 'Electric Piano' },
    9: { zh: '钟琴', en: 'Glockenspiel' },
    24: { zh: '尼龙吉他', en: 'Nylon Guitar' },
    25: { zh: '钢弦吉他', en: 'Steel Guitar' },
    29: { zh: '过载吉他', en: 'Overdrive Guitar' },
    30: { zh: '失真吉他', en: 'Distortion Guitar' },
    33: { zh: '指弹贝司', en: 'Finger Bass' },
    40: { zh: '小提琴', en: 'Violin' },
    42: { zh: '大提琴', en: 'Cello' },
    48: { zh: '弦乐合奏', en: 'Strings Ensemble' },
    56: { zh: '小号', en: 'Trumpet' },
    57: { zh: '长号', en: 'Trombone' },
    60: { zh: '圆号', en: 'French Horn' },
    65: { zh: '中音萨克斯', en: 'Alto Sax' },
    73: { zh: '长笛', en: 'Flute' },
    80: { zh: '方波主音', en: 'Square Lead' },
    81: { zh: '锯齿主音', en: 'Saw Lead' },
    88: { zh: '新世纪音垫', en: 'New Age Pad' },
  };
  const n = NAMES[program];
  if (n) return n[lang] || n.zh;
  return `Program ${program}`;
}

export default TrackInspector;
