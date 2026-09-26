import React, { useState, useEffect, useCallback } from 'react';
import { useProject, loadAutosave, clearAutosave, getRecentProjects } from './hooks/useProject';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useAutoSave } from './hooks/useAutoSave';
import HomePage from './components/HomePage';
import Editor from './components/Editor';
import Sf2LoadingDialog from './components/Sf2LoadingDialog';
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
  // 自动检测触屏设备：首次加载时根据 pointer / maxTouchPoints 决定默认 mode
  // 已保存的偏好优先（不存在则自动检测）
  const [mode, setMode] = useState(() => {
    const saved = localStorage.getItem('arvgrid_mode');
    if (saved === 'touch' || saved === 'desktop') return saved;
    const hasTouch = (typeof navigator !== 'undefined' &&
      (navigator.maxTouchPoints > 0 ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)));
    return hasTouch ? 'touch' : 'desktop';
  });
  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem('arvgrid_ui_scale');
    return saved ? parseInt(saved) : 100;
  });
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem('arvgrid_lang');
    return saved || 'zh';
  });
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('arvgrid_theme') || 'dark';
  });
  const [sf2Loaded, setSf2Loaded] = useState(false);
  const [sf2Name, setSf2Name] = useState('');
  const [sf2LoadingProgress, setSf2LoadingProgress] = useState(null); // { stage, percent, message }

  const project = useProject();
  const audioEngine = useAudioEngine();
  const t = useTranslation(lang);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('arvgrid_theme', theme);
  }, [theme]);

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
    localStorage.removeItem('arvgrid_mode');
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
    setSf2LoadingProgress({ stage: 'parsing', percent: 0 });
    const result = await audioEngine.loadSF2(arrayBuffer, (p) => {
      setSf2LoadingProgress(p);
    });
    if (result.success) {
      setSf2Loaded(true);
      setSf2Name(result.name);
    } else {
      // 加载失败：保留 progress 让用户看到错误
      setSf2LoadingProgress({ stage: 'error', message: result.error || 'Unknown error' });
    }
    setTimeout(() => setSf2LoadingProgress(null), result.success ? 1500 : 6000);
    return result.success;
  };

  if (showHome) {
    return (
      <>
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
          theme={theme}
          onThemeChange={setTheme}
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
        <Sf2LoadingDialog progress={sf2LoadingProgress} lang={lang} />
      </>
    );
  }

  return (
    <>
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
        onToggleMode={() => {
          const next = mode === 'desktop' ? 'touch' : 'desktop';
          setMode(next);
          localStorage.setItem('arvgrid_mode', next);
        }}
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
        theme={theme}
        onThemeChange={setTheme}
        onLoadSF2={handleLoadSF2}
        sf2Loaded={sf2Loaded}
        sf2Name={sf2Name}
      />
      <Sf2LoadingDialog progress={sf2LoadingProgress} lang={lang} />
    </>
  );
}