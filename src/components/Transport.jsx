import React, { useState, useRef, useEffect } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

// Transport 底部控制条：DAW 风格
// - 左侧：播放控制 (Play/Stop) + BPM + 位置 (Bar:Beat) + Loop 开关
// - 中央：进度条 + 时间显示
// - 右侧：主音量 + 节拍器
// - 默认隐藏 FX 微调（避免拥挤）；点击"FX"按钮展开
export default function Transport({
  bpm,
  onBpmChange,
  isPlaying,
  isPaused,
  onPlay,
  onPause,
  onResume,
  onStop,
  currentTime,
  totalDuration,
  onSeek,
  reverbSend,
  onReverbSendChange,
  delaySend,
  onDelaySendChange,
  delayTime,
  onDelayTimeChange,
  delayFeedback,
  onDelayFeedbackChange,
  eqLow, onEqLowChange,
  eqMid, onEqMidChange,
  eqHigh, onEqHighChange,
  // 更多效果器
  compressorThreshold, onCompressorThresholdChange,
  compressorRatio, onCompressorRatioChange,
  chorusAmount, onChorusAmountChange,
  stereoWidth, onStereoWidthChange,
  metronomeOn,
  onMetronomeOnChange,
  masterVolume,
  onMasterVolumeChange,
  getPlaybackTime,
  lang = 'zh',
}) {
  const [isDragging, setIsDragging] = useState(false);
  const progressBarRef = useRef(null);
  const progressFillRef = useRef(null);
  const timeDisplayRef = useRef(null);
  const barDisplayRef = useRef(null);
  const displayTimeRef = useRef(0);
  const rafRef = useRef(null);
  const [showFx, setShowFx] = useState(false);
  const t = useTranslation(lang);

  // 使用 requestAnimationFrame 更新显示时间（节流到 ~30fps 减少低端设备竖屏卡顿）
  useEffect(() => {
    if (!isPlaying || isPaused) {
      displayTimeRef.current = currentTime || 0;
      // 更新 DOM
      if (progressFillRef.current) {
        const percent = totalDuration ? (displayTimeRef.current / totalDuration) * 100 : 0;
        progressFillRef.current.style.transform = `scaleX(${totalDuration ? percent / 100 : 0})`;
      }
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = `${formatTime(displayTimeRef.current)} / ${formatTime(totalDuration)}`;
      }
      if (barDisplayRef.current) {
        barDisplayRef.current.textContent = formatBarBeat(displayTimeRef.current, bpm);
      }
      return;
    }

    let lastUpdate = 0;
    const updateDisplay = (ts) => {
      if (ts - lastUpdate < 33) {  // ~30fps
        rafRef.current = requestAnimationFrame(updateDisplay);
        return;
      }
      lastUpdate = ts;
      if (getPlaybackTime) {
        displayTimeRef.current = getPlaybackTime();
      }
      // 直接更新 DOM，避免 React 重渲染
      if (progressFillRef.current) {
        const percent = totalDuration ? (displayTimeRef.current / totalDuration) * 100 : 0;
        progressFillRef.current.style.transform = `scaleX(${totalDuration ? percent / 100 : 0})`;
      }
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = `${formatTime(displayTimeRef.current)} / ${formatTime(totalDuration)}`;
      }
      if (barDisplayRef.current) {
        barDisplayRef.current.textContent = formatBarBeat(displayTimeRef.current, bpm);
      }
      rafRef.current = requestAnimationFrame(updateDisplay);
    };

    rafRef.current = requestAnimationFrame(updateDisplay);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isPlaying, isPaused, getPlaybackTime, currentTime, totalDuration, bpm]);

  const handleSeekMouseDown = (e) => {
    setIsDragging(true);
    const rect = progressBarRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percent * totalDuration;
    onSeek(newTime);
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e) => {
      if (!progressBarRef.current) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));
      const newTime = percent * totalDuration;
      onSeek(newTime);
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isDragging, totalDuration, onSeek]);

  return (
    <div className="controls-bar" style={{
      padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center',
      borderTop: '1px solid var(--border)', flexShrink: 0,
      background: 'var(--panel)', flexWrap: 'wrap',
      overflow: 'hidden', minHeight: 48, maxHeight: 140,
    }}>
      {/* === 左侧：播放控制 === */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {!isPlaying ? (
          <button onClick={onPlay} className="transport-play" title={lang === 'zh' ? '播放 (空格)' : 'Play (Space)'}><Icons.Play /></button>
        ) : isPaused ? (
          <button onClick={onResume} className="transport-play" title={lang === 'zh' ? '继续 (空格)' : 'Resume (Space)'}><Icons.Play /></button>
        ) : (
          <button onClick={onPause} title={lang === 'zh' ? '暂停 (空格)' : 'Pause (Space)'}><Icons.Pause /></button>
        )}
        <button onClick={onStop} disabled={!isPlaying} className="transport-stop" title={lang === 'zh' ? '停止 (Esc)' : 'Stop (Esc)'}><Icons.Stop /></button>

        {/* BPM */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>BPM</span>
          <input type="number" value={bpm} min="20" max="300"
            onChange={(e) => onBpmChange(Math.max(20, Math.min(300, parseInt(e.target.value) || 120)))}
            style={{ width: '54px', fontSize: '0.78rem', textAlign: 'center', fontWeight: 600 }}
            title="Beats per minute"
          />
        </div>

        {/* Bar.Beat 显示 */}
        <div ref={barDisplayRef} style={{
          fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700,
          color: 'var(--text)', minWidth: 60, textAlign: 'center',
          padding: '2px 8px', background: 'var(--bg)',
          border: '1px solid var(--border)', borderRadius: 4,
          fontVariantNumeric: 'tabular-nums',
        }} title={lang === 'zh' ? '小节.拍' : 'Bar.Beat'}>
          {formatBarBeat(currentTime || 0, bpm)}
        </div>
      </div>

      {/* === 中央：进度条 + 时间显示 === */}
      <div style={{ flex: 1, minWidth: 140, display: 'flex', gap: 6, alignItems: 'center' }}>
        <div
          ref={progressBarRef}
          className="progress-bar"
          style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, cursor: 'pointer', position: 'relative' }}
          onMouseDown={handleSeekMouseDown}
          onTouchStart={handleSeekMouseDown}
        >
          <div ref={progressFillRef} className="progress-fill" style={{
            width: '100%', transformOrigin: 'left center',
            transform: `scaleX(${totalDuration ? currentTime / totalDuration : 0})`,
            height: '100%',
            background: 'linear-gradient(to right, var(--accent), var(--accent-hover))',
            borderRadius: 4, pointerEvents: 'none', willChange: 'transform',
          }} />
        </div>
        <span ref={timeDisplayRef} style={{
          fontSize: '0.75rem', whiteSpace: 'nowrap',
          fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
        }}>{formatTime(currentTime)} / {formatTime(totalDuration)}</span>
      </div>

      {/* === 右侧：主音量 + 节拍器 + FX 展开按钮 === */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {/* FX 展开/收起 */}
        <button
          onClick={() => setShowFx(v => !v)}
          className={showFx ? 'active' : ''}
          style={{
            padding: '4px 10px', fontSize: '0.7rem', fontWeight: 600,
            background: showFx ? 'var(--accent-hover)' : 'var(--track-bg)',
            color: showFx ? 'var(--accent-text)' : 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 4,
          }}
          title={lang === 'zh' ? '全局效果器' : 'Global FX'}
        >FX</button>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={metronomeOn} onChange={(e) => onMetronomeOnChange(e.target.checked)} />
          <Icons.Volume />
        </label>

        <input
          type="range" min="0" max="1" step="0.01"
          value={masterVolume}
          onChange={(e) => onMasterVolumeChange && onMasterVolumeChange(parseFloat(e.target.value))}
          style={{ width: '70px', cursor: 'pointer' }}
          title={t.volume || '音量'}
        />
        <span style={{
          fontSize: '0.65rem', color: 'var(--text-muted)', minWidth: 32,
          fontVariantNumeric: 'tabular-nums',
        }}>{Math.round(masterVolume * 100)}%</span>
      </div>

      {/* === FX 展开面板（可折叠） === */}
      {showFx && (
        <div style={{
          width: '100%', display: 'flex', gap: 12, alignItems: 'center',
          flexWrap: 'wrap', padding: '6px 0 0',
          borderTop: '1px dashed var(--border)', marginTop: 4,
        }}>
          <FxSlider label={t.reverb} value={reverbSend} min={0} max={1} step={0.01} onChange={onReverbSendChange} fmt={v => `${Math.round(v * 100)}%`} />
          <FxSlider label={t.delay} value={delaySend} min={0} max={1} step={0.01} onChange={onDelaySendChange} fmt={v => `${Math.round(v * 100)}%`} />
          <FxSlider label={t.delayTime} value={delayTime} min={0.05} max={1} step={0.01} onChange={onDelayTimeChange} fmt={v => `${v.toFixed(2)}s`} />
          <FxSlider label={t.delayFeedback} value={delayFeedback} min={0} max={0.9} step={0.01} onChange={onDelayFeedbackChange} fmt={v => `${Math.round(v * 100)}%`} />
          <FxSlider label={lang === 'zh' ? '低频' : 'Low'} value={eqLow} min={-12} max={12} step={0.5} onChange={onEqLowChange} fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} />
          <FxSlider label={lang === 'zh' ? '中频' : 'Mid'} value={eqMid} min={-12} max={12} step={0.5} onChange={onEqMidChange} fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} />
          <FxSlider label={lang === 'zh' ? '高频' : 'High'} value={eqHigh} min={-12} max={12} step={0.5} onChange={onEqHighChange} fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} />
          <FxSlider label={lang === 'zh' ? '压缩阈' : 'Comp'} value={compressorThreshold} min={-60} max={0} step={1} onChange={onCompressorThresholdChange} fmt={v => `${v.toFixed(0)}dB`} />
          <FxSlider label={lang === 'zh' ? '压缩比' : 'Ratio'} value={compressorRatio} min={1} max={20} step={0.5} onChange={onCompressorRatioChange} fmt={v => `${v.toFixed(1)}:1`} />
          <FxSlider label={lang === 'zh' ? '合唱' : 'Chorus'} value={chorusAmount} min={0} max={1} step={0.01} onChange={onChorusAmountChange} fmt={v => `${Math.round(v * 100)}%`} />
          <FxSlider label={lang === 'zh' ? '立体声' : 'Width'} value={stereoWidth} min={0} max={2} step={0.05} onChange={onStereoWidthChange} fmt={v => v.toFixed(2)} />
        </div>
      )}
    </div>
  );
}

// 小型 FX slider 子组件
function FxSlider({ label, value, min, max, step, onChange, fmt }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', minWidth: 32 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange && onChange(parseFloat(e.target.value))}
        style={{ width: 60 }} />
      <span style={{
        fontSize: '0.6rem', color: 'var(--text-muted)',
        minWidth: 36, textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}>{fmt(value)}</span>
    </div>
  );
}

const formatTime = (sec) => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
};

// Bar.Beat 显示：4/4 拍假设（一拍 = 60/BPM 秒，一小节 = 4 拍）
const formatBarBeat = (sec, bpm) => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const b = bpm || 120;
  const beatSec = 60 / b;
  const totalBeats = Math.floor(sec / beatSec);
  const bar = Math.floor(totalBeats / 4) + 1;
  const beat = (totalBeats % 4) + 1;
  const sub = Math.floor((sec - totalBeats * beatSec) / beatSec * 100);
  return `${bar.toString().padStart(3, '0')}.${beat}.${sub.toString().padStart(2, '0')}`;
};
