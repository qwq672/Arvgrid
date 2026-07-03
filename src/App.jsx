import React, { useState, useEffect, useCallback } from 'react';
import { useProject, loadAutosave, clearAutosave, getRecentProjects } from './hooks/useProject';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useAutoSave } from './hooks/useAutoSave';
import HomePage from './components/HomePage';
import Editor from './components/Editor';
import { parseMidiFile, generateMidiFile } from './lib/midi';
import { exportAudio } from './lib/audioExport';
import { useTranslation } from './lib/i18n';

export default function App() {
  const [showHome, setShowHome] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingAutosave, setPendingAutosave] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [midiInfoOpen, setMidiInfoOpen] = useState(false);
  const [mode, setMode] = useState('desktop');
  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem('arvgrid_ui_scale');
    return saved ? parseInt(saved) : 100;
  });
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem('arvgrid_lang');
    return saved || 'zh';
  });
  const [sf2Loaded, setSf2Loaded] = useState(false);
  const [sf2Name, setSf2Name] = useState('');

  const project = useProject();
  const audioEngine = useAudioEngine();
  const t = useTranslation(lang);

  // 自动保存设置
  const [autoSaveMode, setAutoSaveMode] = useState(() => {
    const saved = localStorage.getItem('arvgrid_autosave_mode');
    return saved ? JSON.parse(saved) : { type: 'onChange', interval: 0 };
  });

  const { triggerAutoSave } = useAutoSave(project.getCurrentProjectData, autoSaveMode);

  // 只在有实际内容时才自动保存
  useEffect(() => {
    const hasContent = project.tracks.some(t => t.notes && t.notes.length > 0);
    if (hasContent) {
      setHasUnsavedChanges(true);
      triggerAutoSave();
    }
  }, [project.tracks, project.bpm, project.meta, project.currentTrackId]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = lang === 'zh' ? '你有未保存的工程，确定要离开吗？更改将丢失。' : 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, lang]);

  // 浏览器标题
  useEffect(() => {
    const hasContent = project.tracks.some(t => t.notes && t.notes.length > 0);
    if (hasContent) {
      document.title = (project.meta.title || 'Untitled') + ' - Arvgrid';
    } else {
      document.title = 'Arvgrid';
    }
  }, [project.meta.title, project.tracks]);

  useEffect(() => {
    const autosaveData = loadAutosave();
    // 只有当自动保存的数据有实际内容时才提示恢复
    if (autosaveData && autosaveData.tracks?.length > 0) {
      // 检查是否有实际的音符数据
      const hasNotes = autosaveData.tracks.some(t => t.notes && t.notes.length > 0);
      if (hasNotes) {
        setPendingAutosave(autosaveData);
      } else {
        // 没有实际内容，清除自动保存
        clearAutosave();
      }
    }
    setRecentProjects(getRecentProjects());
  }, []);

  const handleRecoverAutosave = () => {
    if (pendingAutosave) {
      project.importMidiData(pendingAutosave);
      setHasUnsavedChanges(false);
      clearAutosave();
      setPendingAutosave(null);
      setShowHome(false);
    }
  };

  const handleDiscardAutosave = () => {
    clearAutosave();
    setPendingAutosave(null);
    setShowHome(false);
    project.newProject();
  };

  const handleNewProject = () => {
    if (hasUnsavedChanges && !confirm(t.confirmNew)) return;
    audioEngine.stopPlayback();
    setHasUnsavedChanges(false);
    setShowHome(false);
    project.newProject();
  };

  const handleImportMidi = async (file) => {
    try {
      // 如果当前工程有轨道内容，先确认
      const hasContent = project.tracks.some(t => t.notes && t.notes.length > 0);
      if (hasContent) {
        if (!confirm(lang === 'zh' ? 'MIDI将被导入到新工程\n是否保存当前工程？' : 'MIDI will be imported into a new project.\nSave current project?')) {
          // 不保存，直接继续
        } else {
          project.exportProject();
        }
        setHasUnsavedChanges(false);
      }
      const arrayBuffer = await file.arrayBuffer();
      const midiData = await parseMidiFile(arrayBuffer);
      project.importMidiData(midiData);
      setHasUnsavedChanges(false);
      setShowHome(false);
    } catch (err) {
      alert(t.importFailed + err.message);
    }
  };

  const handleEmbedMidi = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    input.onchange = async (e) => {
      if (!e.target.files[0]) return;
      try {
        const arrayBuffer = await e.target.files[0].arrayBuffer();
        const midiData = await parseMidiFile(arrayBuffer);
        project.mergeMidiData(midiData);
        setHasUnsavedChanges(true);
      } catch (err) {
        alert(t.importFailed + err.message);
      }
    };
    input.click();
  };

  const handleImportProject = (jsonData) => {
    project.importProject(jsonData);
    setHasUnsavedChanges(false);
    setShowHome(false);
  };

  const handleLoadRecent = (projectData) => {
    project.importMidiData(projectData);
    setHasUnsavedChanges(false);
    setShowHome(false);
  };

  const handleExportMidi = () => {
    const fileData = generateMidiFile(project.tracks, project.bpm, project.meta);
    const blob = new Blob([fileData], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.mid';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAudio = async (options, onProgress, onComplete) => {
    try {
      // 获取 SF2 数据（如果已加载）
      const sf2Data = audioEngine.sf2Loaded ? audioEngine._getSf2Data?.() : null;
      const blob = await exportAudio(project.tracks, project.bpm, sf2Data, options, onProgress);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = options.format === 'mp3' ? 'mp3' : options.format === 'flac' ? 'flac' : 'wav';
      const title = project.meta?.title || 'export';
      a.download = `${title}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert((lang === 'zh' ? '导出失败: ' : 'Export failed: ') + err.message);
    }
    onComplete();
  };

  const handleSaveProject = () => {
    project.exportProject();
    setHasUnsavedChanges(false);
  };

  const handleLoadProjectFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      if (e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (ev) => handleImportProject(ev.target.result);
        reader.readAsText(e.target.files[0]);
      }
    };
    input.click();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  };

  const handleClearCache = () => {
    if (confirm(t.confirmClear)) {
      localStorage.removeItem('arvgrid_autosave');
      localStorage.removeItem('arvgrid_recent_projects');
      setRecentProjects([]);
      alert(t.cacheCleared);
    }
  };

  const handleResetSettings = () => {
    localStorage.removeItem('arvgrid_ui_scale');
    localStorage.removeItem('arvgrid_sound_source');
    localStorage.removeItem('arvgrid_autosave_mode');
    localStorage.removeItem('arvgrid_lang');
    setAutoSaveMode({ type: 'onChange', interval: 0 });
    setUiScale(100);
    setLang('zh');
    audioEngine.setSoundSource('default');
    alert(t.settingsReset);
  };

  const handleLangChange = (newLang) => {
    setLang(newLang);
    localStorage.setItem('arvgrid_lang', newLang);
  };

  const handleLoadSF2 = async (arrayBuffer) => {
    const result = await audioEngine.loadSF2(arrayBuffer);
    if (result.success) {
      setSf2Loaded(true);
      setSf2Name(result.name);
    }
    return result.success;
  };

  if (showHome) {
    return (
      <HomePage
        onNewProject={handleNewProject}
        onImportMidi={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.mid,.midi';
          input.onchange = (e) => e.target.files[0] && handleImportMidi(e.target.files[0]);
          input.click();
        }}
        onImportProject={handleLoadProjectFile}
        recentProjects={recentProjects}
        onLoadRecent={handleLoadRecent}
        lang={lang}
        onLangChange={handleLangChange}
        onLoadSF2={handleLoadSF2}
        sf2Loaded={sf2Loaded}
        sf2Name={sf2Name}
        uiScale={uiScale}
        onUiScaleChange={(val) => {
          setUiScale(val);
          localStorage.setItem('arvgrid_ui_scale', val);
          document.body.style.zoom = val / 100;
        }}
        onClearCache={handleClearCache}
        onResetSettings={handleResetSettings}
        pendingAutosave={pendingAutosave}
        onRecoverAutosave={handleRecoverAutosave}
        onDiscardAutosave={handleDiscardAutosave}
      />
    );
  }

  return (
    <Editor
        project={project}
        audioEngine={audioEngine}
        autoSaveMode={autoSaveMode}
        setAutoSaveMode={setAutoSaveMode}
        onExitToHome={() => {
          if (hasUnsavedChanges && !confirm(t.confirmBack)) return;
          setShowHome(true);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenMidiInfo={() => setMidiInfoOpen(true)}
        onExportMidi={handleExportMidi}
        onExportAudio={handleExportAudio}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProjectFile}
        onNewProject={handleNewProject}
        onEmbedMidi={handleEmbedMidi}
        onToggleMode={() => setMode(mode === 'desktop' ? 'touch' : 'desktop')}
        onFullscreen={toggleFullscreen}
        mode={mode}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        midiInfoOpen={midiInfoOpen}
        setMidiInfoOpen={setMidiInfoOpen}
        soundSource={audioEngine.soundSource}
        setSoundSource={audioEngine.setSoundSource}
        meta={project.meta}
        setMeta={project.setMeta}
        uiScale={uiScale}
        onUiScaleChange={(val) => {
          setUiScale(val);
          localStorage.setItem('arvgrid_ui_scale', val);
          document.body.style.zoom = val / 100;
        }}
        onClearCache={handleClearCache}
        onResetSettings={handleResetSettings}
        lang={lang}
        onLangChange={handleLangChange}
        onLoadSF2={handleLoadSF2}
        sf2Loaded={sf2Loaded}
        sf2Name={sf2Name}
      />
  );
}