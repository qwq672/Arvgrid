import React, { useState, useRef, useEffect } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

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
  const displayTimeRef = useRef(0);
  const rafRef = useRef(null);
  const t = useTranslation(lang);

  // 使用 requestAnimationFrame 更新显示时间
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
      return;
    }

    const updateDisplay = () => {
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
      rafRef.current = requestAnimationFrame(updateDisplay);
    };

    rafRef.current = requestAnimationFrame(updateDisplay);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isPlaying, isPaused, getPlaybackTime, currentTime, totalDuration]);

  const formatTime = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSeekMouseDown = (e) => {
    setIsDragging(true);
    const rect = progressBarRef.current.getBoundingClientRect();
    // 兼容 mouse 和 touch 事件
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
    // 同时监听 mouse 和 touch 事件，确保触屏设备可拖动进度条
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
    <div className="controls-bar" style={{ padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--panel)', flexWrap: 'wrap', overflow: 'hidden', minHeight: 48 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {!isPlaying ? (
          <button onClick={onPlay} className="transport-play"><Icons.Play /></button>
        ) : isPaused ? (
          <button onClick={onResume} className="transport-play"><Icons.Play /></button>
        ) : (
          <button onClick={onPause}><Icons.Pause /></button>
        )}
        <button onClick={onStop} disabled={!isPlaying} className="transport-stop"><Icons.Stop /></button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input type="checkbox" checked={metronomeOn} onChange={(e) => onMetronomeOnChange(e.target.checked)} />
          {t.metronome || '节拍器'}
        </label>
        <span>BPM</span>
        <input type="number" value={bpm} onChange={(e) => onBpmChange(parseInt(e.target.value))} style={{ width: '70px' }} />
      </div>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
        <Icons.Volume />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={masterVolume}
          onChange={(e) => onMasterVolumeChange && onMasterVolumeChange(parseFloat(e.target.value))}
          style={{ width: '60px', cursor: 'pointer' }}
          title={t.volume || '音量'}
        />
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', minWidth: 28 }}>{Math.round(masterVolume * 100)}%</span>
      </div>
      <div style={{ flex: 1, minWidth: 120, display: 'flex', gap: 6, alignItems: 'center' }}>
        <div
          ref={progressBarRef}
          className="progress-bar"
          style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, cursor: 'pointer', position: 'relative' }}
          onMouseDown={handleSeekMouseDown}
          onTouchStart={handleSeekMouseDown}
        >
          <div ref={progressFillRef} className="progress-fill" style={{ width: '100%', transformOrigin: 'left center', transform: `scaleX(${totalDuration ? currentTime / totalDuration : 0})`, height: '100%', background: 'var(--accent-hover)', borderRadius: 3, pointerEvents: 'none', willChange: 'transform' }} />
        </div>
        <span ref={timeDisplayRef} style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{formatTime(currentTime)} / {formatTime(totalDuration)}</span>
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem' }}>{t.reverb}</span>
        <input type="range" min="0" max="1" step="0.01" value={reverbSend} onChange={(e) => onReverbSendChange(parseFloat(e.target.value))} style={{ width: '50px' }} />
        <span style={{ fontSize: '0.7rem' }}>{t.delay}</span>
        <input type="range" min="0" max="1" step="0.01" value={delaySend} onChange={(e) => onDelaySendChange(parseFloat(e.target.value))} style={{ width: '50px' }} />
        <span style={{ fontSize: '0.7rem' }}>{t.delayTime}</span>
        <input type="range" min="0.05" max="1" step="0.01" value={delayTime} onChange={(e) => onDelayTimeChange(parseFloat(e.target.value))} style={{ width: '50px' }} />
        <span style={{ fontSize: '0.7rem' }}>{t.delayFeedback}</span>
        <input type="range" min="0" max="0.9" step="0.01" value={delayFeedback} onChange={(e) => onDelayFeedbackChange(parseFloat(e.target.value))} style={{ width: '50px' }} />
      </div>
    </div>
  );
}
