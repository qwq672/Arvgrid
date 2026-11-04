import React, { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import MenuBar from './MenuBar';
import TrackPanel from './TrackPanel';
import PianoRoll from './PianoRoll';
import MixerView from './MixerView';
import TrackInspector from './TrackInspector';
import Transport from './Transport';
import SettingsModal from './SettingsModal';
import MidiInfoModal from './MidiInfoModal';
import ExportAudioDialog from './ExportAudioDialog';
import AutomationPanel from './AutomationPanel';
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
    automation, updateAutomation, clearAutomationParam,
  } = project;

  const { playNote, reverbSend, setReverbSend, delaySend, setDelaySend, delayTime, setDelayTime, delayFeedback, setDelayFeedback, eqLow, setEqLow, eqMid, setEqMid, eqHigh, setEqHigh, eqBands, setEqBand, humanizeVelocity, setHumanizeVelocity, noteOverlap, setNoteOverlap, compressorThreshold, setCompressorThreshold, compressorRatio, setCompressorRatio, chorusAmount, setChorusAmount, stereoWidth, setStereoWidth } = audioEngine;
  const currentTrack = tracks.find(t => t.id === currentTrackId);
  const [editMode, setEditMode] = useState('pointer');
  const [quantizeValue, setQuantizeValue] = useState('1/4');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [exportAudioOpen, setExportAudioOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  // 视图模式：'piano' = 钢琴卷帘 / 'mixer' = 调音台
  const [viewMode, setViewMode] = useState('piano');

  // 窄屏（< 768px）自动折叠 TrackPanel，避免挤压 PianoRoll
  // 初次进入 Editor 时检测一次；不监听 resize 是为了避免频繁切换打断编辑
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setPanelCollapsed(true);
    }
  }, []);

  // 把 project.automation 同步到 audioEngine（用于播放时按时间应用）
  useEffect(() => {
    if (audioEngine && audioEngine.loadAutomationMap) {
      audioEngine.loadAutomationMap(automation || {});
    }
  }, [automation, audioEngine]);

  // 自动化面板需要"当前播放时间"来绘制播放头
  // 性能优化：不要用 useState 每帧 setState（会触发整棵 Editor 子树 reconciliation）
  // 改为传 getPlaybackTime 回调给 AutomationPanel，由它内部 rAF 直接更新 SVG
  // 只在 settingsOpen 切换时 set 一次初始值（避免曲线编辑器首帧错位）
  const [autoCurrentTime, setAutoCurrentTime] = useState(0);
  useEffect(() => {
    if (settingsOpen && audioEngine.getPlaybackTime) {
      setAutoCurrentTime(audioEngine.getPlaybackTime() || 0);
    }
  }, [settingsOpen, audioEngine]);

  // 计算总时长，给自动化编辑器用
  // 复用 audioEngine.totalDuration（已经在 startPlayback 里算过），
  // 没有 tracks 变化就不重新扫；只在 tracks 变化时重算（避免每帧 O(N)）
  const autoDuration = useMemo(() => {
    // 优先用 audioEngine 的 totalDuration（已排序时算过）
    const fromEngine = audioEngine?.totalDuration;
    if (fromEngine && fromEngine > 0) return Math.max(8, fromEngine + 2);
    // 后备：扫一遍 tracks（仅 tracks 变化时执行）
    let max = 0;
    for (const t of tracks) {
      if (!t.notes) continue;
      for (const n of t.notes) {
        const end = (n.startSec || 0) + (n.durationSec || 0);
        if (end > max) max = end;
      }
    }
    return Math.max(8, max + 2);
  }, [tracks, audioEngine?.totalDuration]);

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
      // DAW 风格快捷键：M 静音 / S 独奏 / Del 删除轨道
      else if (e.key === 'm' || e.key === 'M') {
        if (currentTrackId) {
          const t = tracks.find(tr => tr.id === currentTrackId);
          if (t) updateTrack(currentTrackId, { mute: !t.mute });
        }
      }
      else if (e.key === 's' || e.key === 'S') {
        if (!ctrl && !shift && currentTrackId) {
          const t = tracks.find(tr => tr.id === currentTrackId);
          if (t) updateTrack(currentTrackId, { solo: !t.solo });
        }
      }
      else if (e.key === 'F2') {
        e.preventDefault();
        // 触发轨道重命名（通过 TrackPanel 的右键菜单打开）
        // 这里发个自定义事件让 TrackPanel 监听
        window.dispatchEvent(new CustomEvent('arvgrid-rename-track', { detail: { id: currentTrackId } }));
      }
      // 视图切换：P 钢琴卷帘 / X 调音台
      else if (e.key === 'p' || e.key === 'P') {
        if (!ctrl && !shift) { e.preventDefault(); setViewMode('piano'); }
      }
      else if (e.key === 'x' || e.key === 'X') {
        if (!ctrl && !shift) { e.preventDefault(); setViewMode('mixer'); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onNewProject, handleImportMidi, onSaveProject, onExportMidi, undo, redo, audioEngine.isPlaying, audioEngine, tracks, bpm, currentTrackId, updateTrack]);

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
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        // 感叹号指示器：传具体改动的效果列表
        effectsWarnings={() => {
          const warnings = [];
          if (eqLow !== 0 || eqMid !== 0 || eqHigh !== 0 || (eqBands && eqBands.some(b => b.gain !== 0))) {
            warnings.push(lang === 'zh' ? '全局均衡器 (EQ)' : lang === 'ja' ? 'グローバル EQ' : lang === 'ko' ? '글로벌 EQ' : 'Global EQ');
          }
          if (reverbSend !== 0.08) {
            warnings.push(lang === 'zh' ? '全局混响 (Reverb)' : lang === 'ja' ? 'グローバル リバーブ' : lang === 'ko' ? '글로벌 리버브' : 'Global Reverb');
          }
          if (delaySend !== 0.1 || delayTime !== 0.3 || delayFeedback !== 0.2) {
            warnings.push(lang === 'zh' ? '全局延迟 (Delay)' : lang === 'ja' ? 'グローバル ディレイ' : lang === 'ko' ? '글로벌 딜레이' : 'Global Delay');
          }
          if (compressorThreshold !== -12 || compressorRatio !== 20) {
            warnings.push(lang === 'zh' ? '压缩器 (Compressor)' : lang === 'ja' ? 'コンプレッサー' : lang === 'ko' ? '컴프레서' : 'Compressor');
          }
          if (chorusAmount !== 0) {
            warnings.push(lang === 'zh' ? '合唱 (Chorus)' : lang === 'ja' ? 'コーラス' : lang === 'ko' ? '코러스' : 'Chorus');
          }
          if (stereoWidth !== 1.0) {
            warnings.push(lang === 'zh' ? '立体声宽度 (Stereo Width)' : lang === 'ja' ? 'ステレオ幅' : lang === 'ko' ? '스테레오 폭' : 'Stereo Width');
          }
          if (humanizeVelocity !== 0) {
            warnings.push(lang === 'zh' ? '动态力度 (Humanize)' : 'Humanize Velocity');
          }
          if (noteOverlap !== 0) {
            warnings.push(lang === 'zh' ? '丝滑音符 (Note Overlap)' : 'Note Overlap');
          }
          // 检查单音轨效果器
          for (const t of tracks) {
            if (t.effects) {
              const hasFx = t.effects.eqLow !== 0 || t.effects.eqMid !== 0 || t.effects.eqHigh !== 0 ||
                t.effects.reverbSend !== 0 || t.effects.delaySend !== 0 || t.effects.spatial !== 0;
              if (hasFx) {
                warnings.push(lang === 'zh' ? '单音轨效果器' : lang === 'ja' ? 'トラック個別エフェクト' : lang === 'ko' ? '트랙 개별 이펙터' : 'Per-track Effects');
                break;
              }
            }
          }
          return warnings;
        }}
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
            onSoloToggle={(id) => { const t = tracks.find(tr => tr.id === id); updateTrack(id, { solo: !t.solo }); }}
            onProgramChange={(id, prog) => updateTrack(id, { program: prog })}
            onColorChange={(id, color) => updateTrack(id, { color })}
            onCommentChange={(id, comment) => updateTrack(id, { comment })}
            onRename={(id, name) => updateTrack(id, { name })}
            onGroupChange={handleOnGroupChange}
            onTrackReverbChange={handleOnTrackReverbChange}
            onEffectsChange={(id, effects) => updateTrack(id, { effects })}
            playNote={playNote}
            lang={lang}
          />
        </div>
        {viewMode === 'mixer' ? (
          <MixerView
            tracks={tracks}
            currentTrackId={currentTrackId}
            onSelectTrack={setCurrentTrackId}
            onVolumeChange={(id, vol) => updateTrack(id, { volume: vol })}
            onPanChange={(id, pan) => updateTrack(id, { pan })}
            onMuteToggle={(id) => { const t = tracks.find(tr => tr.id === id); updateTrack(id, { mute: !t.mute }); }}
            onSoloToggle={(id) => { const t = tracks.find(tr => tr.id === id); updateTrack(id, { solo: !t.solo }); }}
            onAddTrack={addTrack}
            onDeleteTrack={deleteTrack}
            onDuplicateTrack={handleOnDuplicateTrack}
            masterVolume={audioEngine.masterVolume}
            onMasterVolumeChange={audioEngine.setMasterVolume}
            lang={lang}
            analyserNodeRef={audioEngine.analyserNodeRef}
          />
        ) : currentTrack && (
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

        {/* 右侧 Inspector：选中轨道属性 + 单轨 FX */}
        {!panelCollapsed && (
          <TrackInspector
            track={currentTrack}
            onRename={(id, name) => updateTrack(id, { name })}
            onColorChange={(id, color) => updateTrack(id, { color })}
            onCommentChange={(id, comment) => updateTrack(id, { comment })}
            onVolumeChange={(id, vol) => updateTrack(id, { volume: vol })}
            onPanChange={(id, pan) => updateTrack(id, { pan })}
            onMuteToggle={(id) => { const t = tracks.find(tr => tr.id === id); updateTrack(id, { mute: !t.mute }); }}
            onSoloToggle={(id) => { const t = tracks.find(tr => tr.id === id); updateTrack(id, { solo: !t.solo }); }}
            onProgramChange={(id, prog) => updateTrack(id, { program: prog })}
            onEffectsChange={(id, effects) => updateTrack(id, { effects })}
            onOpenInstrumentPicker={(id) => {
              // 复用 TrackPanel 的 instPanel 机制：派发事件
              window.dispatchEvent(new CustomEvent('arvgrid-open-instrument-picker', { detail: { id } }));
            }}
            lang={lang}
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
        eqLow={eqLow}
        onEqLowChange={setEqLow}
        eqMid={eqMid}
        onEqMidChange={setEqMid}
        eqHigh={eqHigh}
        onEqHighChange={setEqHigh}
        compressorThreshold={compressorThreshold}
        onCompressorThresholdChange={setCompressorThreshold}
        compressorRatio={compressorRatio}
        onCompressorRatioChange={setCompressorRatio}
        chorusAmount={chorusAmount}
        onChorusAmountChange={setChorusAmount}
        stereoWidth={stereoWidth}
        onStereoWidthChange={setStereoWidth}
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
        // 全局效果器
        eqLow={eqLow} onEqLowChange={setEqLow}
        eqMid={eqMid} onEqMidChange={setEqMid}
        eqHigh={eqHigh} onEqHighChange={setEqHigh}
        compressorThreshold={compressorThreshold} onCompressorThresholdChange={setCompressorThreshold}
        compressorRatio={compressorRatio} onCompressorRatioChange={setCompressorRatio}
        chorusAmount={chorusAmount} onChorusAmountChange={setChorusAmount}
        stereoWidth={stereoWidth} onStereoWidthChange={setStereoWidth}
        reverbSend={reverbSend} onReverbSendChange={setReverbSend}
        delaySend={delaySend} onDelaySendChange={setDelaySend}
        delayTime={delayTime} onDelayTimeChange={setDelayTime}
        delayFeedback={delayFeedback} onDelayFeedbackChange={setDelayFeedback}
        // 动态 EQ + 人性化 + 丝滑
        eqBands={eqBands} onEqBandChange={setEqBand}
        humanizeVelocity={humanizeVelocity} onHumanizeVelocityChange={setHumanizeVelocity}
        noteOverlap={noteOverlap} onNoteOverlapChange={setNoteOverlap}
        audioCtxRef={audioEngine.audioCtxRef}
        // 自动化（时间曲线）
        automation={automation}
        onAutomationChange={updateAutomation}
        onAutomationClear={clearAutomationParam}
        autoCurrentTime={autoCurrentTime}
        autoDuration={autoDuration}
        getPlaybackTime={audioEngine.getPlaybackTime}
        isPlaying={audioEngine.isPlaying}
        // 桌面端原生音频设备
        listOutputDevices={audioEngine.listOutputDevices}
        switchOutputDevice={audioEngine.switchOutputDevice}
        isNativeAudio={audioEngine.isNativeAudio}
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
    </div>
  );
});

export default Editor;