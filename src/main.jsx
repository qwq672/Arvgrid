import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { DialogProvider } from './components/DialogSystem';
import './index.css';

// DialogProvider 挂在 ErrorBoundary 内、App 外：App 崩溃重挂也不丢弹窗状态
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
