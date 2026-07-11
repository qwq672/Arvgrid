import React, { useState } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';
import MenuBar from './MenuBar';
import SettingsModal from './SettingsModal';

export default function HomePage({
  onNewProject, onImportMidi, onImportProject, onLoadRecent, recentProjects, onClearRecent,
  lang = 'zh', onLangChange, onLoadSF2, sf2Loaded, sf2Name,
  uiScale, onUiScaleChange, onClearCache, onResetSettings,
  theme = 'dark', onThemeChange,
  pendingAutosave, onRecoverAutosave, onDiscardAutosave
}) {
  const t = useTranslation(lang);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  return (
    <div style={{
      height: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'auto'
    }}>
      <MenuBar
        homeMode={true}
        onNewProject={onNewProject}
        onImportMidi={onImportMidi}
        onLoadProject={onImportProject}
        onOpenSettings={() => setSettingsOpen(true)}
        lang={lang}
        theme={theme}
        onThemeChange={onThemeChange}
      />
      
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px',
        overflow: 'auto'
      }}>
        <div style={{
          maxWidth: 700,
          width: '100%',
          background: 'var(--panel)',
          borderRadius: 16,
          padding: 32,
          textAlign: 'center',
          border: '1px solid var(--border)',
        }}>
          <img 
            src="/icon.svg" 
            alt="Arvgrid" 
            style={{ width: 100, height: 'auto', marginBottom: 12, opacity: 0.8 }} 
          />
          <h1 style={{ fontSize: '2.5rem', marginBottom: 6, color: 'var(--text)', fontWeight: 300 }}>Arvgrid</h1>
          <p style={{ marginBottom: 28, color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t.tagline}</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
            <button onClick={onNewProject} style={{ padding: '14px', fontSize: '0.95rem', background: 'var(--accent-hover)', justifyContent: 'center' }}>
              <Icons.Play /> {t.newProject}
            </button>
            <button onClick={onImportMidi} style={{ padding: '14px', fontSize: '0.95rem', justifyContent: 'center' }}>
              <Icons.Settings /> {t.importMidi}
            </button>
            <button onClick={onImportProject} style={{ padding: '14px', fontSize: '0.95rem', justifyContent: 'center' }}>
              <Icons.Fullscreen /> {t.importProject}
            </button>
          </div>

          {recentProjects.length > 0 && (
            <div>
              <h3 style={{ textAlign: 'left', marginBottom: 10, fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t.recentProjects}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentProjects.map(proj => (
                  <div key={proj.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--track-bg)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{proj.title}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{new Date(proj.timestamp).toLocaleString()}</div>
                    </div>
                    <button onClick={() => onLoadRecent(proj)} style={{ padding: '4px 12px' }}>{t.load}</button>
                  </div>
                ))}
              </div>
              <button onClick={onClearRecent} style={{ marginTop: 10 }} className="danger">{t.clearRecent}</button>
            </div>
          )}
        </div>

        {pendingAutosave && (
          <div style={{
            maxWidth: 700, width: '100%',
            background: 'var(--panel)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 20, marginTop: 16, textAlign: 'left'
          }}>
            <h3 style={{ color: 'var(--text)', marginBottom: 6, fontSize: '0.95rem' }}>{t.recoverTitle}</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: 14, fontSize: '0.8rem' }}>{t.recoverDesc}</p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={onRecoverAutosave} className="primary">{t.recover}</button>
              <button onClick={onDiscardAutosave} className="danger">{t.discard}</button>
            </div>
          </div>
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        uiScale={uiScale}
        onUiScaleChange={onUiScaleChange}
        soundSource="default"
        onSoundSourceChange={() => {}}
        autoSaveMode={{ type: 'onChange', interval: 0 }}
        onAutoSaveModeChange={() => {}}
        onClearCache={onClearCache}
        onResetSettings={onResetSettings}
        lang={lang}
        onLangChange={onLangChange}
        onLoadSF2={onLoadSF2}
        sf2Loaded={sf2Loaded}
        sf2Name={sf2Name}
      />
    </div>
  );
}