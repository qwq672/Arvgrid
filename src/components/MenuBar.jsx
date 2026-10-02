import React, { useState, useRef, useEffect, memo } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

const MenuBar = memo(function MenuBar({
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
  hasEffectsWarning = false,
}) {
  const [activeMenu, setActiveMenu] = useState(null);
  const [warningOpen, setWarningOpen] = useState(false);
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

    // 复用 dataArray 避免每帧 GC（性能优化）
    let dataArray = null;
    let lastDrawTs = 0;
    let isActive = false;  // 是否有活跃音频

    // 画静态线（不播放时）
    const drawIdle = () => {
      if (ctx && canvas && canvas.width > 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.strokeStyle = '#3a3a42';
        ctx.lineWidth = 1;
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      }
    };

    const draw = (ts) => {
      oscRafRef.current = requestAnimationFrame(draw);
      // 节流到 ~15fps（66ms），减少主线程开销
      if (ts - lastDrawTs < 66) return;
      lastDrawTs = ts;
      const analyser = analyserNodeRef?.current;
      if (!analyser || !ctx || !canvas) {
        if (!isActive) drawIdle();
        return;
      }
      const bufferLength = analyser.fftSize;
      if (!dataArray || dataArray.length !== bufferLength) dataArray = new Uint8Array(bufferLength);
      try { analyser.getByteTimeDomainData(dataArray); } catch (e) { return; }

      // 检测是否有活跃音频（RMS > 阈值）
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / bufferLength);
      if (rms < 0.001) {
        // 静音状态：画静态线，不继续渲染波形
        if (isActive) {
          isActive = false;
          drawIdle();
        }
        return;
      }
      isActive = true;

      // 计算峰值（RMS 已在上面算过）
      let peak = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] - 128) / 128;
        const av = v < 0 ? -v : v;
        if (av > peak) peak = av;
      }
      // rms 已在前面计算

      // 根据音量决定颜色：静音=绿色线条，中等=青色，大音量=黄色，爆音=红色
      let color;
      if (peak > 0.95) {
        color = '#e04040';
      } else if (rms > 0.15) {
        color = '#c0a030';
      } else if (rms > 0.03) {
        color = '#40b0b0';
      } else {
        color = '#4a8a6a';
      }

      // 不使用 shadowBlur（canvas 中最重的操作之一），改用稍粗线条保证可见度
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
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

      {/* 效果器警告：EQ/混响等设置非默认时显示感叹号，点击弹出详情 */}
      {hasEffectsWarning && (
        <>
          <div
            onClick={() => setWarningOpen(v => !v)}
            title={lang === 'zh'
              ? '检测到效果器设置，部分设置无法导出到 MIDI 文件。点击查看详情'
              : lang === 'ja'
              ? 'エフェクト設定が検出されました。一部の設定は MIDI ファイルにエクスポートできません。クリックで詳細'
              : lang === 'ko'
              ? '이펙트 설정이 감지되었습니다. 일부 설정은 MIDI 파일로 내보낼 수 없습니다. 클릭하여 상세 보기'
              : 'Effect settings detected. Some settings cannot be exported to MIDI. Click for details'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#e0c040',
              color: '#000',
              fontSize: '0.8rem',
              fontWeight: 700,
              flexShrink: 0,
              marginLeft: 4,
              cursor: 'pointer',
            }}
          >
            !
          </div>
          {warningOpen && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onClick={() => setWarningOpen(false)}>
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'fixed',
                  top: 40,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 16,
                  minWidth: 320,
                  maxWidth: '90vw',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  zIndex: 10000,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9rem' }}>
                  {lang === 'zh' ? '无法导出到 MIDI 的设置' : lang === 'ja' ? 'MIDI にエクスポートできない設定' : lang === 'ko' ? 'MIDI로 내보낼 수 없는 설정' : 'Settings that cannot be exported to MIDI'}
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.75rem', lineHeight: 1.8, color: 'var(--text-muted)' }}>
                  <li>{lang === 'zh' ? 'EQ 均衡器设置（低/中/高）' : lang === 'ja' ? 'EQ イコライザー設定' : lang === 'ko' ? 'EQ 이퀄라이저 설정' : 'EQ equalizer settings (Low/Mid/High)'}</li>
                  <li>{lang === 'zh' ? '混响效果（Reverb）' : lang === 'ja' ? 'リバーブ効果' : lang === 'ko' ? '리버브 효과' : 'Reverb effect'}</li>
                  <li>{lang === 'zh' ? '延迟效果（Delay）' : lang === 'ja' ? 'ディレイ効果' : lang === 'ko' ? '딜레이 효과' : 'Delay effect'}</li>
                  <li>{lang === 'zh' ? '空间效果（Spatial）' : lang === 'ja' ? '空間効果' : lang === 'ko' ? '공간 효과' : 'Spatial effect'}</li>
                  <li>{lang === 'zh' ? '单音轨效果器设置' : lang === 'ja' ? 'トラック個別エフェクト設定' : lang === 'ko' ? '트랙 개별 이펙터 설정' : 'Per-track effect settings'}</li>
                </ul>
                <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  {lang === 'zh' ? 'MIDI 格式仅保存音符数据，音频效果仅在播放/导出音频时生效。' : lang === 'ja' ? 'MIDI 形式は音符データのみを保存します。オーディオ効果は再生/オーディオ書き出し時にのみ有効です。' : lang === 'ko' ? 'MIDI 형식은音符 데이터만 저장합니다. 오디오 효과는 재생/오디오 내보내기 시에만 적용됩니다.' : 'MIDI format only stores note data. Audio effects apply only during playback/audio export.'}
                </div>
                <button onClick={() => setWarningOpen(false)} style={{ marginTop: 10, width: '100%' }}>
                  {lang === 'zh' ? '知道了' : lang === 'ja' ? '了解' : lang === 'ko' ? '확인' : 'Got it'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

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

      {/* 示波器 - 窄屏隐藏，给菜单让位 */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 300, height: '100%', display: 'flex', alignItems: 'center', marginLeft: 'auto', padding: '2px 0', overflow: 'hidden' }} className="osc-container">
        <canvas ref={oscCanvasRef} style={{ width: '100%', height: '100%', borderRadius: 3, background: '#0a0a0e', border: '1px solid var(--border)' }} />
      </div>
    </div>
  );
});

export default MenuBar;