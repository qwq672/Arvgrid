import React, { useState, useRef, useEffect } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

export default function MenuBar({
  onNewProject, onImportMidi, onEmbedMidi, onExportMidi, onExportAudio, onSaveProject, onLoadProject,
  onOpenMidiInfo, onUndo, onRedo, onQuantize, onClearTrack,
  onOpenSettings, onToggleMode, onFullscreen, mode, onExitToHome,
  lang = 'zh',
  theme = 'dark',
  onThemeChange = null,
  homeMode = false,
  analyserNodeRef = null,
  editMode = 'pointer',
  onEditModeChange = null,
  quantizeValue = '1/4',
  onQuantizeValueChange = null,
  onOpenAbout = null,
  performanceInfo = { level: 'low', mem: 0 },
}) {
  const [activeMenu, setActiveMenu] = useState(null);
  const menuRef = useRef(null);
  const t = useTranslation(lang);
  const oscCanvasRef = useRef(null);
  const oscRafRef = useRef(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!activeMenu) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setActiveMenu(null);
      }
    };
    // 延迟添加监听，避免当前点击事件触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('touchstart', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [activeMenu]);

  const handleMenuClick = (menuName) => {
    setActiveMenu(prev => prev === menuName ? null : menuName);
  };

  const disabledStyle = { opacity: 0.4, pointerEvents: 'none' };

  const handleItemClick = (callback, disabled) => {
    if (disabled) return;
    setActiveMenu(null);
    if (typeof callback === 'function') {
      callback();
    }
  };

  // 示波器动画 - 优化版：始终显示线条，根据音量变色
  useEffect(() => {
    const canvas = oscCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let observer = null;

    const resize = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
      }
    };
    resize();
    try { observer = new ResizeObserver(resize); observer.observe(canvas); } catch (e) {}

    const draw = () => {
      oscRafRef.current = requestAnimationFrame(draw);
      const analyser = analyserNodeRef?.current;
      if (!analyser || !ctx || !canvas) {
        // 无分析器时画一条静态线
        if (ctx && canvas && canvas.width > 0) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.beginPath();
          ctx.strokeStyle = '#4a8a6a';
          ctx.lineWidth = 2;
          ctx.shadowColor = '#4a8a6a';
          ctx.shadowBlur = 6;
          ctx.moveTo(0, canvas.height / 2);
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        return;
      }
      const bufferLength = analyser.fftSize;
      const dataArray = new Uint8Array(bufferLength);
      try { analyser.getByteTimeDomainData(dataArray); } catch (e) { return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 计算 RMS 音量
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      const rms = Math.sqrt(sum / bufferLength);

      // 根据音量决定颜色：静音=绿色线条，中等=青色，大音量=黄色，爆音=红色
      let color;
      if (peak > 0.95) {
        color = '#e04040'; // 爆音红色
      } else if (rms > 0.15) {
        color = '#c0a030'; // 大音量黄色
      } else if (rms > 0.03) {
        color = '#40b0b0'; // 中等青色
      } else {
        color = '#4a8a6a'; // 安静绿色
      }

      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    draw();
    return () => { if (oscRafRef.current) cancelAnimationFrame(oscRafRef.current); if (observer) observer.disconnect(); };
  }, [analyserNodeRef]);

  const editModes = [
    { id: 'pointer', label: lang === 'zh' ? '指针' : 'Pointer', icon: <Icons.Pointer />, title: lang === 'zh' ? '指针模式' : 'Pointer: view only' },
    { id: 'select', label: lang === 'zh' ? '选择' : 'Select', icon: <Icons.Select />, title: lang === 'zh' ? '选择模式' : 'Select: marquee select' },
    { id: 'draw', label: lang === 'zh' ? '添加' : 'Draw', icon: <Icons.Draw />, title: lang === 'zh' ? '添加模式' : 'Draw: add notes' },
    { id: 'erase', label: lang === 'zh' ? '删除' : 'Erase', icon: <Icons.Erase />, title: lang === 'zh' ? '删除模式' : 'Erase: delete notes' },
  ];

  const quantizeOpts = [{ v: '1', label: '1' },{ v: '1/2', label: '1/2' },{ v: '1/4', label: '1/4' },{ v: '1/8', label: '1/8' },{ v: '1/16', label: '1/16' }];

  return (
    <div className="menu-bar" ref={menuRef}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8, flexShrink: 0 }}>
        <img src="/icon.svg" alt="Arvgrid" style={{ width: 18, height: 18, filter: theme === 'light' ? 'invert(1)' : 'none' }} />
        <span style={{ fontWeight: 300, color: 'var(--text)', fontSize: '0.85rem' }}>Arvgrid</span>
      </div>

      {/* 性能指示器 - 始终显示 */}
      {(() => {
        const dotColor = performanceInfo.level === 'critical' ? '#e04040' : performanceInfo.level === 'warn' ? '#e0c040' : performanceInfo.level === 'normal' ? '#40b0b0' : '#40c040';
        const label = performanceInfo.level === 'critical' ? (lang === 'zh' ? '严重' : 'CRIT') : performanceInfo.level === 'warn' ? (lang === 'zh' ? '警告' : 'WARN') : performanceInfo.level === 'normal' ? (lang === 'zh' ? '正常' : 'OK') : (lang === 'zh' ? '空闲' : 'IDLE');
        return (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: '0.7rem',
            marginLeft: 8,
            background: 'var(--bg)',
            color: 'var(--text-muted)',
          }}>
            <span style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: dotColor,
              flexShrink: 0,
            }} />
            <span>{label}</span>
            {performanceInfo.mem != null && <span>{Math.round(performanceInfo.mem)}MB</span>}
          </div>
        );
      })()}

      {/* 文件菜单 */}
      <div className={`menu-item ${activeMenu === 'file' ? 'active' : ''}`} onClick={() => handleMenuClick('file')}>
        {t.file}
        {activeMenu === 'file' && <div className="menu-dropdown">
          <a onClick={() => handleItemClick(onNewProject)}><Icons.Plus /> {t.newProject} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginLeft: 'auto' }}>Ctrl+N</span></a>
          <a onClick={() => handleItemClick(onImportMidi)}><Icons.Folder /> {t.importMidi} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginLeft: 'auto' }}>Ctrl+O</span></a>
          <a style={homeMode ? disabledStyle : {}} onClick={() => handleItemClick(onEmbedMidi, homeMode)}><Icons.Folder /> {lang === 'zh' ? '嵌入MIDI到工程' : 'Embed MIDI into Project'}</a>
          <a style={homeMode ? disabledStyle : {}} onClick={() => handleItemClick(onExportMidi, homeMode)}><Icons.Save /> {t.exportMidi} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginLeft: 'auto' }}>Ctrl+Shift+S</span></a>
          <a style={homeMode ? disabledStyle : {}} onClick={() => handleItemClick(onExportAudio, homeMode)}><Icons.Save /> {t.exportAudio || (lang === 'zh' ? '导出音频' : 'Export Audio')}</a>
          <a style={homeMode ? disabledStyle : {}} onClick={() => handleItemClick(onSaveProject, homeMode)}><Icons.Save /> {t.saveProject} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginLeft: 'auto' }}>Ctrl+S</span></a>
          <a onClick={() => handleItemClick(onLoadProject)}><Icons.Folder /> {t.loadProject}</a>
          <a style={homeMode ? disabledStyle : {}} onClick={() => handleItemClick(onExitToHome, homeMode)}><Icons.Home /> {t.backToHome}</a>
        </div>}
      </div>

      {/* 编辑菜单 */}
      <div className={`menu-item ${activeMenu === 'edit' ? 'active' : ''}`} onClick={() => !homeMode && handleMenuClick('edit')} style={homeMode ? { opacity: 0.4, pointerEvents: 'none' } : {}}>
        {t.edit}
        {activeMenu === 'edit' && <div className="menu-dropdown">
          <a onClick={() => handleItemClick(onUndo)}><Icons.Undo /> {t.undo} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginLeft: 'auto' }}>Ctrl+Z</span></a>
          <a onClick={() => handleItemClick(onRedo)}><Icons.Redo /> {t.redo} <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginLeft: 'auto' }}>Ctrl+Shift+Z</span></a>
          <a onClick={() => handleItemClick(onQuantize)}>{t.quantizeTrack}</a>
          <a onClick={() => handleItemClick(onClearTrack)}><Icons.Trash /> {t.clearTrack}</a>
          <a onClick={() => handleItemClick(onOpenMidiInfo)}>{t.midiInfo}</a>
        </div>}
      </div>

      {/* 设置菜单 */}
      <div className={`menu-item ${activeMenu === 'settings' ? 'active' : ''}`} onClick={() => handleMenuClick('settings')}>
        {t.settings}
        {activeMenu === 'settings' && <div className="menu-dropdown">
          <a onClick={() => handleItemClick(onOpenSettings)}><Icons.Settings /> {t.optionsPanel}</a>
          <a style={homeMode ? disabledStyle : {}} onClick={() => handleItemClick(onToggleMode, homeMode)}>{mode === 'desktop' ? t.touchMode : t.desktopMode}</a>
          <a style={homeMode ? disabledStyle : {}} onClick={() => handleItemClick(onFullscreen, homeMode)}><Icons.Fullscreen /> {t.fullscreen}</a>
          <a onClick={() => { setActiveMenu(null); onThemeChange && onThemeChange(theme === 'dark' ? 'light' : 'dark'); }}>
            {theme === 'dark' ? <Icons.Sun /> : <Icons.Moon />} {lang === 'zh' ? (theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式') : (theme === 'dark' ? 'Switch to Light' : 'Switch to Dark')}
          </a>
        </div>}
      </div>

      {/* 帮助菜单 */}
      <div className={`menu-item ${activeMenu === 'help' ? 'active' : ''}`} onClick={() => handleMenuClick('help')}>
        {lang === 'zh' ? '帮助' : 'Help'}
        {activeMenu === 'help' && <div className="menu-dropdown">
          <a onClick={() => handleItemClick(onOpenAbout)}><Icons.Help /> {lang === 'zh' ? '关于' : 'About'}</a>
        </div>}
      </div>

      {mode === 'touch' && <span className="mode-badge">{t.touchMode}</span>}

      {/* 编辑模式 */}
      {!homeMode && onEditModeChange && (
        <div className="edit-toolbar">
          {editModes.map(em => (
            <button key={em.id} className={editMode === em.id ? 'active' : ''} onClick={() => onEditModeChange(em.id)} title={em.title}>
              {em.icon} {em.label}
            </button>
          ))}
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0 4px', flexShrink: 0 }}>{lang === 'zh' ? '量化' : 'Quant'}</span>
          <select value={quantizeValue} onChange={e => onQuantizeValueChange?.(e.target.value)} style={{ fontSize: '0.65rem', padding: '2px 4px', width: 52 }}>
            {quantizeOpts.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
      )}

      {/* 示波器 */}
      <div style={{ flex: 1, minWidth: 60, maxWidth: 300, height: '100%', display: 'flex', alignItems: 'center', marginLeft: 'auto', padding: '2px 0' }}>
        <canvas ref={oscCanvasRef} style={{ width: '100%', height: '100%', borderRadius: 3, background: '#0a0a0e', border: '1px solid var(--border)' }} />
      </div>
    </div>
  );
}