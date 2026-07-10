import React, { useState, useRef } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

export default function SettingsPanel({
  open, onClose,
  uiScale, onUiScaleChange,
  soundSource, onSoundSourceChange,
  autoSaveMode, onAutoSaveModeChange,
  onClearCache, onResetSettings,
  lang, onLangChange,
  onLoadSF2, sf2Loaded, sf2Name,
  bufferSize, onBufferSizeChange,
}) {
  const fileInputRef = useRef(null);
  const [search, setSearch] = useState('');
  const t = useTranslation(lang);

  if (!open) return null;

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

  const bufsize = (typeof bufferSize === 'number') ? bufferSize : 
    (bufferSize === 'short' ? 0.08 : bufferSize === 'medium' ? 0.15 : 0.3);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{
        width: 320, maxWidth: '90vw', height: '100%', background: 'var(--panel)',
        borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.5)', overflow: 'hidden',
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

          {matchSearch(t.bufferSize) && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                {t.bufferSize}: {(bufsize * 1000).toFixed(0)}ms (lookahead)
              </label>
              <input type="range" min="40" max="500" step="10" value={bufsize * 1000}
                onChange={e => {
                  const ms = parseInt(e.target.value) / 1000;
                  if (onBufferSizeChange) onBufferSizeChange(ms);
                }} style={{ width: '100%' }} />
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