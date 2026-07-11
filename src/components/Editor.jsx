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
      playNote(pitch, duration, velocity, currentTrack.program, currentTrack.isDrum);
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
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
        {mode === 'touch' && (
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
            {panelCollapsed ? '▶' : '◀'}
          </button>
        )}
        <div className={mode === 'touch' && panelCollapsed ? 'track-panel-collapsed' : ''}>
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
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, maxWidth: 380, width: '90vw', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <img src="/icon.svg" alt="Arvgrid" style={{ width: 64, height: 64, marginBottom: 12, opacity: 0.8 }} />
            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 400 }}>Arvgrid</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '4px 0 12px' }}>
              {lang === 'zh' ? '免费开源的 MIDI 编辑器' : 'Free & Open Source MIDI Editor'}
            </p>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              <div>Version 1.0.0</div>
              <div style={{ marginTop: 8 }}>
                {lang === 'zh' ? '基于 Web Audio API 构建' : 'Built with Web Audio API'}
              </div>
              <div>React + Vite</div>
              <div style={{ marginTop: 8, fontSize: '0.65rem' }}>
                {lang === 'zh' ? '支持 MIDI 导入/导出，SF2 音色库' : 'Supports MIDI import/export, SF2 soundfonts'}
              </div>
              <div style={{ marginTop: 12 }}>
                <a href="https://github.com" target="_blank" rel="noopener" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.7rem' }}>
                  GitHub
                </a>
              </div>
            </div>
            <button onClick={() => setAboutOpen(false)} className="primary" style={{ marginTop: 16 }}>{lang === 'zh' ? '关闭' : 'Close'}</button>
          </div>
        </div>
      )}
    </div>
  );
});

export default Editor;