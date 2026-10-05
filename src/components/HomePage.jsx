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
  const [aboutOpen, setAboutOpen] = useState(false);
  
  return (
    <div style={{
      height: '100dvh', // 现代浏览器：动态视口高度（移动端工具栏弹出/收起不遮挡）
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
        onOpenAbout={() => setAboutOpen(true)}
        lang={lang}
        theme={theme}
        onThemeChange={onThemeChange}
      />

      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'clamp(8px, 3vw, 20px)',
        overflow: 'auto'
      }}>
        <div style={{
          maxWidth: 700,
          width: '100%',
          background: 'var(--panel)',
          borderRadius: 16,
          padding: 'clamp(16px, 4vw, 32px)',
          textAlign: 'center',
          border: '1px solid var(--border)',
        }}>
          <div style={{ marginBottom: 12, color: 'var(--text)' }}>
            <Icons.Logo size={100} />
          </div>
          <h1 style={{ fontSize: 'clamp(1.8rem, 6vw, 2.5rem)', marginBottom: 6, color: 'var(--text)', fontWeight: 300 }}>Arvgrid</h1>
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

      {/* 关于对话框 */}
      {aboutOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }} onClick={() => setAboutOpen(false)}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, padding: 0, maxWidth: 380, width: '90vw', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
            {/* 头部：Logo + 标题 */}
            <div style={{ textAlign: 'center', padding: '28px 24px 20px' }}>
              <div style={{ display: 'inline-block', color: 'var(--text)', marginBottom: 8 }}>
                <Icons.Logo size={48} />
              </div>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, letterSpacing: 0.5 }}>Arvgrid</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '4px 0 0' }}>
                {lang === 'zh' ? '免费开源的 MIDI 编辑器' : 'Free & Open Source MIDI Editor'}
              </p>
            </div>
            {/* 版本徽章 */}
            <div style={{ textAlign: 'center', paddingBottom: 16 }}>
              <span style={{ display: 'inline-block', color: 'var(--accent)', fontSize: '0.72rem', fontWeight: 600, padding: '3px 12px', borderRadius: 20, border: '1px solid var(--accent)' }}>
                v261005
              </span>
              <span style={{ marginLeft: 8, fontSize: '0.68rem', color: 'var(--text-muted)' }}>MIT License</span>
            </div>
            {/* 链接列表 */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '14px 24px' }}>
              <a href="https://github.com/qwq672/arvgrid" target="_blank" rel="noopener" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', color: 'var(--text)', textDecoration: 'none', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>GitHub</span>
                <span style={{ color: 'var(--accent)' }}>qwq672/arvgrid</span>
              </a>
              <a href="https://awa.lat" target="_blank" rel="noopener" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', color: 'var(--text)', textDecoration: 'none', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{lang === 'zh' ? '主页' : 'Homepage'}</span>
                <span style={{ color: 'var(--accent)' }}>awa.lat</span>
              </a>
              <a href="mailto:b167963232@163.com" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', color: 'var(--text)', textDecoration: 'none', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Email</span>
                <span style={{ color: 'var(--accent)' }}>b167963232@163.com</span>
              </a>
            </div>
            {/* 技术栈 */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '14px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                React + Vite + Web Audio API<br />
                SF2 · AudioWorklet · MIDI
              </div>
            </div>
            {/* 关闭按钮 */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '14px 24px', textAlign: 'center' }}>
              <button onClick={() => setAboutOpen(false)} className="primary" style={{ minWidth: 120 }}>{lang === 'zh' ? '关闭' : 'Close'}</button>
            </div>
          </div>
        </div>
      )}

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
        bufferSize="medium"
        onBufferSizeChange={() => {}}
        // 主页传默认效果器值，避免 undefined 导致渲染错误
        eqLow={0} onEqLowChange={() => {}}
        eqMid={0} onEqMidChange={() => {}}
        eqHigh={0} onEqHighChange={() => {}}
        compressorThreshold={-12} onCompressorThresholdChange={() => {}}
        compressorRatio={20} onCompressorRatioChange={() => {}}
        chorusAmount={0} onChorusAmountChange={() => {}}
        stereoWidth={1} onStereoWidthChange={() => {}}
        reverbSend={0.08} onReverbSendChange={() => {}}
        delaySend={0.1} onDelaySendChange={() => {}}
        delayTime={0.3} onDelayTimeChange={() => {}}
        delayFeedback={0.2} onDelayFeedbackChange={() => {}}
        audioCtxRef={null}
      />
    </div>
  );
}