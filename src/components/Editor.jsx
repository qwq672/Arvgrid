import React, { memo, useState, useEffect, useCallback, useMemo } from 'react';
import MenuBar from './MenuBar';
import TrackPanel from './TrackPanel';
import PianoRoll from './PianoRoll';
import Transport from './Transport';
import SettingsModal from './SettingsModal';
import MidiInfoModal from './MidiInfoModal';
import ExportAudioDialog from './ExportAudioDialog';
import { Icons } from './Icons';

const Editor = memo(({
  project, audioEngine, autoSaveMode, setAutoSaveMode,
  onExitToHome, onOpenSettings, onOpenMidiInfo, onExportMidi, onExportAudio,
  onSaveProject, onLoadProject, onNewProject, onEmbedMidi,
  onToggleMode, onFullscreen, mode,
  settingsOpen, setSettingsOpen, midiInfoOpen, setMidiInfoOpen,
  soundSource, setSoundSource, meta, setMeta,
  uiScale, onUiScaleChange, onClearCache, onResetSettings,
  lang, onLangChange, theme, onThemeChange, onLoadSF2, sf2Loaded, sf2Name,
}) => {
  const {
    tracks, currentTrackId, bpm, setBpm,
    addTrack, deleteTrack, updateTrack, quantizeTrack, clearTrack,
    duplicateTrack, updateTrackGroup,
    undo, redo, setCurrentTrackId,
  } = project;

  const { playNote, reverbSend, setReverbSend, delaySend, setDelaySend, delayTime, setDelayTime, delayFeedback, setDelayFeedback } = audioEngine;
  const currentTrack = tracks.find(t => t.id === currentTrackId);
  const [editMode, setEditMode] = useState('pointer');
  const [quantizeValue, setQuantizeValue] = useState('1/4');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [exportAudioOpen, setExportAudioOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);

  // 窄屏（< 768px）自动折叠 TrackPanel，避免挤压 PianoRoll
  // 初次进入 Editor 时检测一次；不监听 resize 是为了避免频繁切换打断编辑
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setPanelCollapsed(true);
    }
  }, []);

  // 缓存 ghostTracks，避免每次渲染都创建新数组
  const ghostTracks = useMemo(() => 
    tracks.filter(t => t.id !== currentTrackId).map(t => ({ track: t, color: t.color || '#888' })),
    [tracks, currentTrackId]
  );

  // 缓存所有回调函数，避免子组件不必要的重渲染
  const handleNotesChange = useCallback((newNotes) => {
    updateTrack(currentTrackId, { notes: newNotes });
  }, [currentTrackId, updateTrack]);

  const handlePlayNote = useCallback((pitch, duration, velocity) => {
    if (currentTrack) {
      const tv = Math.max(0, Math.min(1, (currentTrack.volume ?? 80) / 100));
      playNote(pitch, duration, velocity, currentTrack.program, currentTrack.isDrum, tv);
    }
  }, [currentTrack, playNote]);

  const handleOnPlay = useCallback(() => audioEngine.startPlayback(tracks, bpm), [audioEngine, tracks, bpm]);
  const handleOnPause = useCallback(() => audioEngine.pausePlayback(), [audioEngine]);
  const handleOnResume = useCallback(() => audioEngine.resumePlayback(tracks, bpm), [audioEngine, tracks, bpm]);
  const handleOnStop = useCallback(() => audioEngine.stopPlayback(), [audioEngine]);
  const handleOnSeek = useCallback((time) => audioEngine.seekTo(time), [audioEngine]);
  const handleOnQuantize = useCallback(() => quantizeTrack(currentTrackId), [quantizeTrack, currentTrackId]);
  const handleOnClearTrack = useCallback(() => clearTrack(currentTrackId), [clearTrack, currentTrackId]);
  const handleOnOpenAbout = useCallback(() => setAboutOpen(true), []);
  const handleOnOpenExportAudio = useCallback(() => setExportAudioOpen(true), []);
  const handleOnExportAudio = useCallback((options) => {
    onExportAudio(options, (progress) => setExportProgress(progress), () => {
      setIsExporting(false);
      setExportProgress(null);
      setExportAudioOpen(false);
    });
    setIsExporting(true);
  }, [onExportAudio]);
  const handleOnDuplicateTrack = useCallback((id) => duplicateTrack(id), [duplicateTrack]);
  const handleOnGroupChange = useCallback((id, group) => updateTrackGroup(id, group), [updateTrackGroup]);
  const handleOnTrackReverbChange = useCallback((id, rev) => updateTrack(id, { reverb: rev }), [updateTrack]);

  const handleImportMidi = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    input.onchange = (e) => {
      if (e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const { parseMidiFile } = await import('../lib/midi');
          const midiData = await parseMidiFile(ev.target.result);
          project.importMidiData(midiData);
        };
        reader.readAsArrayBuffer(e.target.files[0]);
      }
    };
    input.click();
  }, [project]);

  // 全局键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (ctrl && !shift && e.key === 'n') { e.preventDefault(); onNewProject(); }
      else if (ctrl && !shift && e.key === 'o') { e.preventDefault(); handleImportMidi(); }
      else if (ctrl && !shift && e.key === 's') { e.preventDefault(); onSaveProject(); }
      else if (ctrl && shift && e.key === 's') { e.preventDefault(); onExportMidi(); }
      else if (ctrl && !shift && e.key === 'z') { e.preventDefault(); undo(); }
      else if (ctrl && shift && e.key === 'z') { e.preventDefault(); redo(); }
      else if (ctrl && !shift && e.key === 'e') { e.preventDefault(); onExportMidi(); }
      else if (ctrl && shift && e.key === 'i') { e.preventDefault(); handleImportMidi(); }
      else if (e.key === ' ') { e.preventDefault(); if (audioEngine.isPlaying) { audioEngine.pausePlayback(); } else { audioEngine.startPlayback(tracks, bpm); } }
      else if (e.key === 'Escape') { e.preventDefault(); audioEngine.stopPlayback(); }
      else if (e.key === '1') { e.preventDefault(); setEditMode('pointer'); }
      else if (e.key === '2') { e.preventDefault(); setEditMode('select'); }
      else if (e.key === '3') { e.preventDefault(); setEditMode('draw'); }
      else if (e.key === '4') { e.preventDefault(); setEditMode('erase'); }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onNewProject, handleImportMidi, onSaveProject, onExportMidi, undo, redo, audioEngine.isPlaying, audioEngine, tracks, bpm]);

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <MenuBar
        onNewProject={onNewProject}
        onEmbedMidi={onEmbedMidi}
        onImportMidi={handleImportMidi}
        onExportMidi={onExportMidi}
        onExportAudio={handleOnOpenExportAudio}
        onSaveProject={onSaveProject}
        onLoadProject={onLoadProject}
        onOpenSettings={onOpenSettings}
        onOpenMidiInfo={onOpenMidiInfo}
        onToggleMode={onToggleMode}
        onFullscreen={onFullscreen}
        onExitToHome={onExitToHome}
        mode={mode}
        onUndo={undo}
        onRedo={redo}
        onQuantize={handleOnQuantize}
        onClearTrack={handleOnClearTrack}
        lang={lang}
        theme={theme}
        onThemeChange={onThemeChange}
        analyserNodeRef={audioEngine.analyserNodeRef}
        editMode={editMode}
        onEditModeChange={setEditMode}
        quantizeValue={quantizeValue}
        onQuantizeValueChange={setQuantizeValue}
        onOpenAbout={handleOnOpenAbout}
        performanceInfo={audioEngine.performanceInfo}
      />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: 6, gap: 6, minHeight: 0 }}>
        <button
          onClick={() => setPanelCollapsed(v => !v)}
          title={panelCollapsed ? (lang === 'zh' ? '展开轨道面板' : 'Expand Track Panel') : (lang === 'zh' ? '折叠轨道面板' : 'Collapse Track Panel')}
          style={{
            padding: '4px 6px',
            fontSize: '0.7rem',
            borderRadius: '4px 0 0 4px',
            alignSelf: 'flex-start',
            flexShrink: 0,
            marginTop: 4,
          }}
        >
          {panelCollapsed ? <Icons.Right /> : <Icons.Left />}
        </button>
        <div className={panelCollapsed ? 'track-panel-collapsed' : ''} style={{ display: panelCollapsed ? 'none' : 'contents' }}>
          <TrackPanel
            tracks={tracks}
            currentTrackId={currentTrackId}
            onSelectTrack={setCurrentTrackId}
            onAddTrack={addTrack}
            onDeleteTrack={deleteTrack}
            onDuplicateTrack={handleOnDuplicateTrack}
            onVolumeChange={(id, vol) => updateTrack(id, { volume: vol })}
            onPanChange={(id, pan) => updateTrack(id, { pan })}
            onMuteToggle={(id) => { const t = tracks.find(tr => tr.id === id); updateTrack(id, { mute: !t.mute }); }}
            onProgramChange={(id, prog) => updateTrack(id, { program: prog })}
            onColorChange={(id, color) => updateTrack(id, { color })}
            onCommentChange={(id, comment) => updateTrack(id, { comment })}
            onGroupChange={handleOnGroupChange}
            onTrackReverbChange={handleOnTrackReverbChange}
            playNote={playNote}
            lang={lang}
          />
        </div>
        {currentTrack && (
          <PianoRoll
            track={currentTrack}
            tracks={tracks}
            currentTrackId={currentTrackId}
            ghostTracks={ghostTracks}
            trackColor={currentTrack?.color || '#888'}
            onNotesChange={handleNotesChange}
            playNote={handlePlayNote}
            isPlaying={audioEngine.isPlaying}
            getPlaybackTime={audioEngine.getPlaybackTime}
            lang={lang}
            editMode={editMode}
            quantizeValue={quantizeValue}
          />
        )}
      </div>
      <Transport
        bpm={bpm}
        onBpmChange={setBpm}
        isPlaying={audioEngine.isPlaying}
        isPaused={audioEngine.isPaused}
        onPlay={handleOnPlay}
        onPause={handleOnPause}
        onResume={handleOnResume}
        onStop={handleOnStop}
        currentTime={audioEngine.currentTime}
        totalDuration={audioEngine.totalDuration}
        onSeek={handleOnSeek}
        getPlaybackTime={audioEngine.getPlaybackTime}
        reverbSend={reverbSend}
        onReverbSendChange={setReverbSend}
        delaySend={delaySend}
        onDelaySendChange={setDelaySend}
        delayTime={delayTime}
        onDelayTimeChange={setDelayTime}
        delayFeedback={delayFeedback}
        onDelayFeedbackChange={setDelayFeedback}
        metronomeOn={audioEngine.metronomeOn}
        onMetronomeOnChange={audioEngine.setMetronomeOn}
        masterVolume={audioEngine.masterVolume}
        onMasterVolumeChange={audioEngine.setMasterVolume}
        lang={lang}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        uiScale={uiScale}
        onUiScaleChange={onUiScaleChange}
        soundSource={soundSource}
        onSoundSourceChange={setSoundSource}
        autoSaveMode={autoSaveMode}
        onAutoSaveModeChange={setAutoSaveMode}
        onClearCache={onClearCache}
        onResetSettings={onResetSettings}
        lang={lang}
        onLangChange={onLangChange}
        onLoadSF2={onLoadSF2}
        sf2Loaded={sf2Loaded}
        sf2Name={sf2Name}
        bufferSize={audioEngine.bufferSize}
        onBufferSizeChange={audioEngine.setBufferSize}
      />
      <MidiInfoModal
        open={midiInfoOpen}
        onClose={() => setMidiInfoOpen(false)}
        meta={meta}
        onMetaChange={setMeta}
        lang={lang}
      />

      <ExportAudioDialog
        open={exportAudioOpen}
        onClose={() => { if (!isExporting) { setExportAudioOpen(false); setExportProgress(null); } }}
        onExport={handleOnExportAudio}
        lang={lang}
        isExporting={isExporting}
        progress={exportProgress}
      />

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
                v260801
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
    </div>
  );
});

export default Editor;