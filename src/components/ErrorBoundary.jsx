import React from 'react';

/**
 * 全局错误边界——v14 新增
 *
 * 背景：v12 起 SettingsModal 出现 hooks 顺序 bug（React #310），打开设置面板
 * 整棵 React 树直接卸载 → 用户看到纯黑屏幕，无任何提示。
 * 该类 bug 的共性是"渲染期异常 = 全站死亡"，所以：
 *   1. 治本：修复 hooks 顺序（SettingsModal.jsx）
 *   2. 治标：任何未来渲染崩溃都被此处拦截，降级为友好错误卡片，
 *      提供"重试界面 / 刷新页面"两档恢复，不再黑屏。
 *
 * 注意：ErrorBoundary 只拦"渲染期"异常；事件回调里的异常由浏览器
 * window.onerror 兜底（不打断 UI）。BFCache 恢复（pageshow persisted）
 * 时若状态已脏，自动整树重挂一次。
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null, retryTick: 0 };
    this.retryRef = React.createRef();
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    // 上报控制台（保留完整堆栈，方便用户反馈时截图）
    console.error('[Arvgrid] 界面渲染出错（已被错误边界拦截）:', error, errorInfo?.componentStack);
    this.setState({ errorInfo });
  }

  // 重试：整树重挂（key 变化丢弃全部脏状态，干净恢复）
  handleRetry = () => {
    this.setState({ error: null, errorInfo: null, retryTick: this.state.retryTick + 1 });
  };

  render() {
    if (!this.state.error) {
      return <React.Fragment key={this.state.retryTick}>{this.props.children}</React.Fragment>;
    }
    const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('arvgrid_lang')) || 'zh';
    const zh = lang === 'zh';
    const msg = String(this.state.error?.message || this.state.error || '').slice(0, 300);
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg, #111)', color: 'var(--text, #eee)',
        fontFamily: 'system-ui, sans-serif', padding: 24,
      }}>
        <div style={{
          maxWidth: 480, width: '100%', textAlign: 'center',
          border: '1px solid var(--border, #333)', borderRadius: 12,
          background: 'var(--panel, #1a1a1a)', padding: '28px 22px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>
            {zh ? '界面出了点问题' : 'Something went wrong'}
          </h2>
          <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--text-muted, #999)' }}>
            {zh
              ? '渲染时遇到异常，界面已安全停止以保护你的工程数据（未保存内容仍在内存尝试可达）。'
              : 'A render error occurred. Your unsaved project data is preserved where possible.'}
          </p>
          <div style={{
            margin: '0 0 16px', padding: '8px 10px', textAlign: 'left',
            fontSize: '0.68rem', fontFamily: 'ui-monospace, monospace',
            background: 'var(--bg, #111)', border: '1px solid var(--border, #333)',
            borderRadius: 6, color: 'var(--text-muted, #aaa)',
            maxHeight: 120, overflow: 'auto', wordBreak: 'break-all',
          }}>{msg}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={this.handleRetry} style={{
              padding: '8px 18px', fontSize: '0.8rem', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--border, #444)', background: 'var(--accent, #4ade80)',
              color: '#111', fontWeight: 600,
            }}>{zh ? '重试界面' : 'Retry'}</button>
            <button onClick={() => location.reload()} style={{
              padding: '8px 18px', fontSize: '0.8rem', borderRadius: 6, cursor: 'pointer',
              border: '1px solid var(--border, #444)', background: 'transparent',
              color: 'var(--text, #eee)',
            }}>{zh ? '刷新页面' : 'Reload page'}</button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
