import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getTranslation } from '../lib/i18n';

// v261117-2：自绘弹窗系统，全面替代原生 alert / confirm（原 10 处调用）。
//
// 为什么弃用原生：
//   1. 样式与主题完全脱节——暗色主题下白块 + 标题栏写死浏览器名
//   2. 原生弹窗阻塞主线程：弹出期间 RAF、播放头、Transport 全部冻结
//   3. 移动端 WebView 里原生 confirm 常被压缩成角落两行小字，触控命中率差
//   4. 无法定制按钮——"保存并导入 / 直接导入 / 取消"三选择做不出来
//
// API（useDialog() 返回）：
//   confirm(opts) → Promise<value>
//     默认两按钮：确定 → true；取消 / ESC / 点遮罩 → false
//     buttons: [{label, value, primary, danger}] 自定义按钮：点谁返回谁的
//     value；ESC / 点遮罩返回 null（调用方按"未选择"处理）
//   alert(opts)  → Promise<undefined>，任意关闭方式都 resolve
//   toast(msg, {type:'success'|'error'|'info', duration}) → 立即返回不阻塞
//
// 可用性：打开即聚焦主按钮（Enter 直接确认）、ESC 取消、Tab 焦点圈闭、
// 弹窗期锁背景滚动、aria-modal、prefers-reduced-motion 关动画、
// 手机上按钮竖排满宽（配合 body.touch-mode 的 44px 命中区）。
//
// 注意：本文件是纯 UI 原语，不依赖任何业务状态；挂载在 main.jsx 根部
// （ErrorBoundary 内、App 外），App 崩溃重挂也不会丢失正在显示的弹窗。

const DialogContext = createContext(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog 需要 <DialogProvider> 包裹（见 main.jsx）');
  return ctx;
}

function currentLang() {
  try { return localStorage.getItem('arvgrid_lang') || 'zh'; } catch { return 'zh'; }
}

export function DialogProvider({ children }) {
  // 弹窗栈：一次只渲染栈顶；新的盖住旧的（本应用实际不会叠加）
  const [stack, setStack] = useState([]);
  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(0);

  const open = useCallback((opts) => new Promise((resolve) => {
    const t = getTranslation(currentLang());
    const d = { kind: 'confirm', ...opts };
    if (!Array.isArray(d.buttons) || d.buttons.length === 0) {
      d.buttons = d.kind === 'alert'
        ? [{ label: d.okText ?? t.buttonOK, value: undefined, primary: true }]
        : [
            { label: d.okText ?? t.buttonOK, value: true, primary: true, danger: !!d.danger },
            { label: d.cancelText ?? t.buttonCancel, value: false },
          ];
    } else {
      // 自定义按钮没标 primary 时默认第一个是主按钮
      if (!d.buttons.some(b => b.primary)) {
        d.buttons = d.buttons.map((b, i) => (i === 0 ? { ...b, primary: true } : b));
      }
    }
    // ESC / 点遮罩的关闭值：alert → undefined；默认确认框 → false；自定义按钮 → null
    d.escapeValue = d.kind === 'alert'
      ? undefined
      : (Array.isArray(opts.buttons) ? null : false);
    d.resolve = resolve;
    setStack(prev => [...prev, d]);
  }), []);

  const closeTop = useCallback((value) => {
    setStack(prev => {
      if (!prev.length) return prev;
      const top = prev[prev.length - 1];
      // Promise#resolve 幂等：StrictMode 下 updater 重放也安全
      top.resolve(value);
      return prev.slice(0, -1);
    });
  }, []);

  const toast = useCallback((message, opts = {}) => {
    const id = ++toastSeq.current;
    const item = { id, message: String(message ?? ''), type: opts.type || 'info' };
    setToasts(prev => [...prev.slice(-2), item]); // 同屏最多 3 条
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), opts.duration ?? 2600);
  }, []);

  const api = useMemo(
    () => ({
      confirm: (o) => open({ kind: 'confirm', ...o }),
      alert: (o) => open({ kind: 'alert', ...o }),
      toast,
    }),
    [open, toast]
  );

  const current = stack.length ? stack[stack.length - 1] : null;

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <DialogCard key={stack.length} dialog={current} onClose={closeTop} />}
      {toasts.length > 0 && <ToastStack toasts={toasts} />}
    </DialogContext.Provider>
  );
}

function DialogCard({ dialog, onClose }) {
  const cardRef = useRef(null);
  const primaryRef = useRef(null);

  // 打开即聚焦主按钮：Enter 直接确认；也是屏幕阅读器的朗读起点。
  // 同时锁住背景滚动。
  useEffect(() => {
    primaryRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  // 键盘：ESC 关闭；Tab 在按钮间圈闭焦点（capture 抢在全局快捷键前）。
  // Enter 不拦：焦点在按钮上时浏览器原生行为即点击该按钮。
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose(dialog.escapeValue);
      } else if (e.key === 'Tab') {
        const focusables = Array.from(cardRef.current?.querySelectorAll('button') || []);
        if (!focusables.length) return;
        e.preventDefault();
        const idx = focusables.indexOf(document.activeElement);
        const next = e.shiftKey
          ? focusables[(idx - 1 + focusables.length) % focusables.length]
          : focusables[(idx + 1) % focusables.length];
        next.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dialog, onClose]);

  return createPortal(
    <div
      className="arvgrid-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 11000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(dialog.escapeValue); }}
    >
      <div
        ref={cardRef}
        className="arvgrid-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label={typeof dialog.title === 'string' ? dialog.title : 'dialog'}
        style={{ width: 'min(420px, 92vw)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px', boxShadow: '0 16px 48px rgba(0,0,0,0.45)' }}
      >
        {dialog.title ? (
          <div style={{ fontSize: '1.02rem', fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{dialog.title}</div>
        ) : null}
        {dialog.message ? (
          <div style={{ fontSize: '0.92rem', lineHeight: 1.6, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>{dialog.message}</div>
        ) : null}
        <div className="arvgrid-dialog-actions" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22, flexWrap: 'wrap' }}>
          {dialog.buttons.map((b, i) => (
            <button
              key={i}
              ref={b.primary ? primaryRef : null}
              type="button"
              className={`arvgrid-dialog-btn ${b.danger ? 'danger' : b.primary ? 'primary' : 'neutral'}`}
              onClick={() => onClose(b.value)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

const TOAST_COLORS = {
  success: 'var(--accent)',
  error: 'var(--danger)',
  info: 'var(--accent)',
};

function ToastStack({ toasts }) {
  return createPortal(
    <div
      style={{ position: 'fixed', left: '50%', bottom: 'max(24px, env(safe-area-inset-bottom))', transform: 'translateX(-50%)', zIndex: 11500, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }}
    >
      {toasts.map(x => (
        <div
          key={x.id}
          className="arvgrid-toast"
          style={{ background: 'var(--panel)', borderLeft: `3px solid ${TOAST_COLORS[x.type] || TOAST_COLORS.info}`, color: 'var(--text)', borderRadius: 10, padding: '12px 20px', fontSize: '0.88rem', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxWidth: 'min(480px, 88vw)' }}
        >
          {x.message}
        </div>
      ))}
    </div>,
    document.body
  );
}
