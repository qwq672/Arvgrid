import React, { useState, useRef } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';
import { isWasmSupported } from '../lib/wasmBackend';

export default function SettingsPanel({
  open, onClose,
  uiScale, onUiScaleChange,
  soundSource, onSoundSourceChange,
  autoSaveMode, onAutoSaveModeChange,
  onClearCache, onResetSettings,
  lang, onLangChange,
  onLoadSF2, sf2Loaded, sf2Name,
  bufferSize, onBufferSizeChange,
  // 全局效果器
  eqLow, onEqLowChange, eqMid, onEqMidChange, eqHigh, onEqHighChange,
  compressorThreshold, onCompressorThresholdChange, compressorRatio, onCompressorRatioChange,
  chorusAmount, onChorusAmountChange, stereoWidth, onStereoWidthChange,
  reverbSend, onReverbSendChange, delaySend, onDelaySendChange,
  delayTime, onDelayTimeChange, delayFeedback, onDelayFeedbackChange,
  audioCtxRef,  // 音频上下文引用（用于输出设备选择）
}) {
  const fileInputRef = useRef(null);
  const [search, setSearch] = useState('');
  const [exportSampleRate, setExportSampleRate] = useState(() => {
    return parseInt(localStorage.getItem('arvgrid_export_sample_rate')) || 44100;
  });
  const [exportBitDepth, setExportBitDepth] = useState(() => {
    return parseInt(localStorage.getItem('arvgrid_export_bit_depth')) || 16;
  });
  // 实验性 WASM 后端开关
  const [wasmEnabled, setWasmEnabled] = useState(() => {
    return localStorage.getItem('arvgrid_wasm_backend') === '1';
  });
  const wasmSupported = isWasmSupported();
  const t = useTranslation(lang);

  if (!open) return null;

  const handleWasmToggle = (enabled) => {
    setWasmEnabled(enabled);
    localStorage.setItem('arvgrid_wasm_backend', enabled ? '1' : '0');
    if (enabled) {
      // 提示用户需要重新加载 SF2 才能生效
      alert(lang === 'zh'
        ? '已启用实验性 WASM 后端。下次加载 SF2 时将尝试使用 WASM 解析（如果 WASM 文件已部署）。加载失败会自动回退到 JS。'
        : 'Experimental WASM backend enabled. Next SF2 load will try WASM parsing (if WASM file is deployed). Falls back to JS on failure.');
    }
  };

  const handleSF2Select = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const success = await onLoadSF2(arrayBuffer);
      if (success) {
        onSoundSourceChange('sf2');
      }
    } catch (err) {
      console.error('SF2 load failed:', err);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const matchSearch = (text) => {
    if (!search) return true;
    return text.toLowerCase().includes(search.toLowerCase());
  };

  // 与 useAudioEngine 的 BUFFER_PRESETS 保持一致
  const bufsize = (typeof bufferSize === 'number') ? bufferSize :
    (bufferSize === 'short' ? 0.10 : bufferSize === 'medium' ? 0.25 : bufferSize === 'ultra' ? 1.0 : 0.5);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{
        position: 'relative',
        width: 'min(480px, 90vw)', maxHeight: '85vh', background: 'var(--panel)',
        borderRadius: 12, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden',
      }}>
        {/* 头部 */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ flex: 1, margin: 0, fontSize: '0.95rem' }}>{t.settings}</h3>
          <button onClick={onClose} style={{ background: 'none', padding: 4 }}><Icons.Close /></button>
        </div>

        {/* 搜索 */}
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative' }}>
            <input type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              placeholder={lang === 'zh' ? '搜索设置...' : 'Search settings...'}
              style={{ width: '100%', padding: '5px 8px 5px 28px', fontSize: '0.75rem', border: 'none', background: 'var(--bg)', borderRadius: 5, position: 'relative', zIndex: 1 }}
            />
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}><Icons.Search /></span>
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {matchSearch(t.language) && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{t.language}</label>
              <select value={lang} onChange={e => onLangChange(e.target.value)} style={{ width: '100%' }}>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </div>
          )}

          {matchSearch(t.uiScale) && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{t.uiScale} ({uiScale}%)</label>
              <input type="range" min="70" max="150" step="5" value={uiScale}
                onChange={e => onUiScaleChange(parseInt(e.target.value))} style={{ width: '100%' }} />
            </div>
          )}

          {matchSearch(t.soundSource) && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>{t.soundSource}</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0', fontSize: '0.75rem' }}>
                <input type="radio" name="s" checked={soundSource === 'default'} onChange={() => onSoundSourceChange('default')} />{t.defaultOscillator}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0', fontSize: '0.75rem' }}>
                <input type="radio" name="s" checked={soundSource === 'network'} onChange={() => onSoundSourceChange('network')} />{t.networkSoundfont}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0', fontSize: '0.75rem' }}>
                <input type="radio" name="s" checked={soundSource === 'sf2'} onChange={() => { if (sf2Loaded) onSoundSourceChange('sf2'); }} />
                {t.sf2Soundfont}
                {sf2Loaded && sf2Name ? <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>({sf2Name})</span> : null}
              </label>
              <button onClick={() => fileInputRef.current?.click()} style={{ marginTop: 6, width: '100%', fontSize: '0.75rem' }}>{t.loadSF2}</button>
              <input ref={fileInputRef} type="file" accept=".sf2,.sf3" onChange={handleSF2Select} style={{ display: 'none' }} />
            </div>
          )}

          {/* 实验性：WASM 后端 */}
          {matchSearch(lang === 'zh' ? '实验性' : 'Experimental') && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                {lang === 'zh' ? '实验性功能' : 'Experimental'} <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>(Beta)</span>
              </label>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, cursor: wasmSupported ? 'pointer' : 'not-allowed',
                padding: '8px 10px', fontSize: '0.72rem', borderRadius: 6,
                border: wasmEnabled ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: wasmEnabled ? 'var(--track-hover)' : 'var(--track-bg)',
                opacity: wasmSupported ? 1 : 0.5,
              }}>
                <input type="checkbox" checked={wasmEnabled} disabled={!wasmSupported}
                  onChange={e => handleWasmToggle(e.target.checked)}
                  style={{ marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    {lang === 'zh' ? 'WASM SF2 解析器' : 'WASM SF2 Parser'}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {wasmSupported
                      ? (lang === 'zh'
                        ? '使用 WebAssembly 加速 SF2 文件解析（实验性，WASM 文件未部署时会自动回退到 JS）'
                        : 'Use WebAssembly to accelerate SF2 parsing (experimental, falls back to JS if WASM file not deployed)')
                      : (lang === 'zh' ? '当前浏览器不支持 WebAssembly' : 'WebAssembly not supported in this browser')}
                  </div>
                </div>
              </label>
            </div>
          )}

          {matchSearch(t.bufferSize) && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                {t.bufferSize}: {(bufsize * 1000).toFixed(0)}ms (lookahead)
              </label>
              <input type="range" min="40" max="1000" step="10" value={bufsize * 1000}
                onChange={e => {
                  const ms = parseInt(e.target.value) / 1000;
                  if (onBufferSizeChange) onBufferSizeChange(ms);
                }} style={{ width: '100%' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '4px 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={bufferSize === 'ultra'}
                  onChange={e => { if (onBufferSizeChange) onBufferSizeChange(e.target.checked ? 'ultra' : 'medium'); }} />
                {lang === 'zh' ? '高内存模式（预建所有音色缓冲区，占用更多内存但播放更流畅）' : 'High Memory Mode (pre-build all buffers, uses more RAM for smoother playback)'}
              </label>
            </div>
          )}

          {/* 全局效果器面板 */}
          {matchSearch(lang === 'zh' ? '效果器' : 'Effects') && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 8, fontWeight: 600 }}>
                {lang === 'zh' ? '全局效果器' : lang === 'ja' ? 'グローバルエフェクト' : lang === 'ko' ? '글로벌 이펙터' : 'Global Effects'}
              </label>

              {/* EQ */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>{lang === 'zh' ? '均衡器 (EQ)' : 'Equalizer (EQ)'}</div>
                {[
                  { label: lang === 'zh' ? '低音' : 'Low', val: eqLow, set: onEqLowChange, min: -12, max: 12, fmt: v => `${v.toFixed(1)} dB` },
                  { label: lang === 'zh' ? '中音' : 'Mid', val: eqMid, set: onEqMidChange, min: -12, max: 12, fmt: v => `${v.toFixed(1)} dB` },
                  { label: lang === 'zh' ? '高音' : 'High', val: eqHigh, set: onEqHighChange, min: -12, max: 12, fmt: v => `${v.toFixed(1)} dB` },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 40, fontSize: '0.7rem' }}>{item.label}</span>
                    <input type="range" min={item.min} max={item.max} step="0.5" value={item.val} onChange={e => item.set && item.set(parseFloat(e.target.value))} style={{ flex: 1 }} />
                    <span style={{ width: 50, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>{item.fmt(item.val)}</span>
                  </div>
                ))}
              </div>

              {/* 压缩器 */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>{lang === 'zh' ? '压缩器 (Compressor)' : 'Compressor'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 50, fontSize: '0.7rem' }}>{lang === 'zh' ? '阈值' : 'Thresh'}</span>
                  <input type="range" min="-60" max="0" step="1" value={compressorThreshold} onChange={e => onCompressorThresholdChange && onCompressorThresholdChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ width: 40, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>{compressorThreshold} dB</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 50, fontSize: '0.7rem' }}>{lang === 'zh' ? '比率' : 'Ratio'}</span>
                  <input type="range" min="1" max="20" step="1" value={compressorRatio} onChange={e => onCompressorRatioChange && onCompressorRatioChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ width: 40, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>{compressorRatio}:1</span>
                </div>
              </div>

              {/* 混响 */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>{lang === 'zh' ? '混响 (Reverb)' : 'Reverb'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 50, fontSize: '0.7rem' }}>{lang === 'zh' ? '发送量' : 'Send'}</span>
                  <input type="range" min="0" max="1" step="0.01" value={reverbSend} onChange={e => onReverbSendChange && onReverbSendChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ width: 40, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>{Math.round(reverbSend * 100)}%</span>
                </div>
              </div>

              {/* 延迟 */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>{lang === 'zh' ? '延迟 (Delay)' : 'Delay'}</div>
                {[
                  { label: lang === 'zh' ? '发送' : 'Send', val: delaySend, set: onDelaySendChange, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v*100)}%` },
                  { label: lang === 'zh' ? '时间' : 'Time', val: delayTime, set: onDelayTimeChange, min: 0.05, max: 1, step: 0.01, fmt: v => `${v.toFixed(2)}s` },
                  { label: lang === 'zh' ? '反馈' : 'FB', val: delayFeedback, set: onDelayFeedbackChange, min: 0, max: 0.9, step: 0.01, fmt: v => `${Math.round(v*100)}%` },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 50, fontSize: '0.7rem' }}>{item.label}</span>
                    <input type="range" min={item.min} max={item.max} step={item.step} value={item.val} onChange={e => item.set && item.set(parseFloat(e.target.value))} style={{ flex: 1 }} />
                    <span style={{ width: 50, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>{item.fmt(item.val)}</span>
                  </div>
                ))}
              </div>

              {/* 合唱 + 声场 */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>{lang === 'zh' ? '合唱与声场' : 'Chorus & Stereo'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 50, fontSize: '0.7rem' }}>{lang === 'zh' ? '合唱' : 'Chorus'}</span>
                  <input type="range" min="0" max="1" step="0.01" value={chorusAmount} onChange={e => onChorusAmountChange && onChorusAmountChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ width: 40, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>{Math.round(chorusAmount * 100)}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 50, fontSize: '0.7rem' }}>{lang === 'zh' ? '声场' : 'Width'}</span>
                  <input type="range" min="0" max="2" step="0.05" value={stereoWidth} onChange={e => onStereoWidthChange && onStereoWidthChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ width: 40, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>{stereoWidth.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {matchSearch(lang === 'zh' ? '音频输出' : 'Audio Output') && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                {lang === 'zh' ? '音频输出设置' : 'Audio Output Settings'}
              </label>
              {/* 输出设备选择 */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: '0.72rem', minWidth: 60 }}>{lang === 'zh' ? '输出设备' : 'Device'}</span>
                <select id="audio-output-device" style={{ flex: 1, fontSize: '0.72rem' }} onChange={async (e) => {
                  const deviceId = e.target.value;
                  if (deviceId && audioCtxRef) {
                    try {
                      const device = await navigator.mediaDevices.selectAudioOutput({ deviceId });
                      if (device && audioCtxRef.current) {
                        audioCtxRef.current.setSinkId(deviceId);
                      }
                    } catch (err) {
                      console.warn('Failed to set audio output device:', err);
                    }
                  }
                }}>
                  <option value="">{lang === 'zh' ? '默认设备' : 'Default'}</option>
                </select>
                <button onClick={async () => {
                  try {
                    const device = await navigator.mediaDevices.selectAudioOutput();
                    const sel = document.getElementById('audio-output-device');
                    if (sel) {
                      const opt = document.createElement('option');
                      opt.value = device.deviceId;
                      opt.text = device.label || 'Device';
                      sel.appendChild(opt);
                      sel.value = device.deviceId;
                      if (audioCtxRef && audioCtxRef.current) {
                        audioCtxRef.current.setSinkId(device.deviceId);
                      }
                    }
                  } catch (err) {
                    console.warn('Device selection failed:', err);
                  }
                }} style={{ padding: '4px 8px', fontSize: '0.7rem' }}>
                  {lang === 'zh' ? '选择...' : 'Choose...'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: '0.72rem', minWidth: 60 }}>{lang === 'zh' ? '采样率' : 'Sample Rate'}</span>
                <select
                  value={exportSampleRate}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    setExportSampleRate(v);
                    localStorage.setItem('arvgrid_export_sample_rate', v);
                  }}
                  style={{ flex: 1, fontSize: '0.72rem' }}
                >
                  <option value={22050}>22050 Hz</option>
                  <option value={44100}>44100 Hz</option>
                  <option value={48000}>48000 Hz</option>
                  <option value={96000}>96000 Hz</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', minWidth: 60 }}>{lang === 'zh' ? '位深' : 'Bit Depth'}</span>
                <select
                  value={exportBitDepth}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    setExportBitDepth(v);
                    localStorage.setItem('arvgrid_export_bit_depth', v);
                  }}
                  style={{ flex: 1, fontSize: '0.72rem' }}
                >
                  <option value={8}>8-bit</option>
                  <option value={16}>16-bit</option>
                  <option value={24}>24-bit</option>
                  <option value={32}>32-bit float</option>
                </select>
              </div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {lang === 'zh' ? '影响音频导出质量（WAV 格式生效）' : 'Affects audio export quality (WAV format)'}
              </div>
            </div>
          )}

          {matchSearch(t.autoSave) && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{t.autoSave}</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0', fontSize: '0.75rem' }}>
                <input type="radio" name="autosave" checked={autoSaveMode.type === 'onChange'} onChange={() => onAutoSaveModeChange({ type: 'onChange', interval: 0 })} />{t.autoSaveOnChange}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0', fontSize: '0.75rem' }}>
                <input type="radio" name="autosave" checked={autoSaveMode.type === 'interval'} onChange={() => onAutoSaveModeChange({ type: 'interval', interval: 60 })} />{t.autoSaveInterval}
              </label>
              {autoSaveMode.type === 'interval' && (
                <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.7rem' }}>{t.intervalSeconds}</span>
                  <input type="number" min="1" max="86400" value={autoSaveMode.interval}
                    onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) onAutoSaveModeChange({ ...autoSaveMode, interval: v }); }}
                    style={{ width: 70 }} />
                </div>
              )}
            </div>
          )}

          {matchSearch(lang === 'zh' ? '维护' : 'Maintenance') && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>{lang === 'zh' ? '维护' : 'Maintenance'}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={onClearCache} style={{ width: '100%' }}>{t.clearCache}</button>
                <button onClick={onResetSettings} className="danger" style={{ width: '100%' }}>{t.resetSettings}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}