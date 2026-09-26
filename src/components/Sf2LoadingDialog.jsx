import React from 'react';
import { useTranslation } from '../lib/i18n';

/**
 * SF2 加载进度对话框
 * 显示解析、传输到 worklet 的进度，以及错误信息
 *
 * progress: null | {
 *   stage: 'parsing' | 'transferring' | 'done' | 'error',
 *   percent: number,
 *   message?: string,
 *   parseMs?: number,
 * }
 */
export default function Sf2LoadingDialog({ progress, lang = 'zh' }) {
  const t = useTranslation(lang);
  if (!progress) return null;
  const isError = progress.stage === 'error';
  const isDone = progress.stage === 'done';
  const isWarning = progress.stage === 'wasm-fallback';

  const stageText = (() => {
    if (isError) return t.sf2LoadingFailed;
    if (isDone) {
      const backendLabel = progress.backend === 'wasm'
        ? (lang === 'zh' ? 'WASM' : 'WASM')
        : (lang === 'zh' ? 'JS' : 'JS');
      return `${t.sf2LoadingDone} (${backendLabel})`;
    }
    if (progress.stage === 'parsing') return t.sf2LoadingParsing;
    if (progress.stage === 'transferring') return t.sf2LoadingTransferring;
    if (progress.stage === 'wasm-loading') return t.wasmLoading;
    if (progress.stage === 'wasm-fetching') return lang === 'zh' ? '正在下载 WASM 模块…' : 'Downloading WASM module...';
    if (progress.stage === 'wasm-compiling') return t.wasmCompiling;
    if (progress.stage === 'wasm-ready') return t.wasmReady;
    if (progress.stage === 'wasm-fallback') return t.wasmFallback;
    return t.exportProcessing;
  })();

  const percent = isError ? 100 : (progress.percent ?? 0);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)', pointerEvents: isError ? 'auto' : 'none',
    }}>
      <div style={{
        background: 'var(--panel)', border: `1px solid ${isError ? 'var(--danger)' : 'var(--border)'}`,
        borderRadius: 12, padding: 24, minWidth: 320, maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          {!isError && !isDone && (
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
              animation: 'arvgrid-spin 0.8s linear infinite',
            }} />
          )}
          {isDone && <span style={{ color: 'var(--green)', fontSize: '1.2rem' }}>✓</span>}
          {isError && <span style={{ color: 'var(--danger)', fontSize: '1.2rem' }}>✗</span>}
          <span style={{ fontSize: '0.9rem', color: 'var(--text)' }}>{stageText}</span>
        </div>

        {!isError && (
          <div style={{
            width: '100%', height: 6, background: 'var(--border)',
            borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              width: `${percent}%`, height: '100%',
              background: isDone ? 'var(--green)' : 'var(--accent)',
              borderRadius: 3, transition: 'width 0.2s ease',
            }} />
          </div>
        )}

        <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {isError
            ? (progress.message || (lang === 'zh' ? '未知错误' : 'Unknown error'))
            : `${percent}%`}
          {progress.parseMs && !isError && (
            <span style={{ marginLeft: 8 }}>
              {t.sf2ParseTime} {progress.parseMs}ms
            </span>
          )}
        </div>
      </div>
      <style>{`
        @keyframes arvgrid-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
