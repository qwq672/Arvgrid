import React, { useState } from 'react';
import { useTranslation } from '../lib/i18n';

export default function ExportAudioDialog({ open, onClose, onExport, lang = 'zh', isExporting = false, progress = null }) {
  const [format, setFormat] = useState('wav');
  const [bitrate, setBitrate] = useState(192);
  const [quality, setQuality] = useState('balanced');
  const t = useTranslation(lang);

  if (!open) return null;

  const formats = [
    { id: 'wav', label: 'WAV', desc: lang === 'zh' ? '无损，文件较大' : 'Lossless, large file' },
    { id: 'mp3', label: 'MP3', desc: lang === 'zh' ? '有损压缩，文件小' : 'Lossy, small file' },
    { id: 'flac', label: 'FLAC', desc: lang === 'zh' ? '无损压缩，文件较小' : 'Lossless, smaller file' },
    { id: 'aac', label: 'AAC', desc: lang === 'zh' ? '有损压缩，高质量' : 'Lossy, high quality' },
  ];

  const qualities = [
    { id: 'higher', label: lang === 'zh' ? '更高' : 'Higher', desc: lang === 'zh' ? '48kHz · 更多细节 · 渲染较慢' : '48kHz · More detail · Slower' },
    { id: 'balanced', label: lang === 'zh' ? '平衡' : 'Balanced', desc: lang === 'zh' ? '44.1kHz · 速度与质量兼顾' : '44.1kHz · Balanced' },
    { id: 'faster', label: lang === 'zh' ? '更快' : 'Faster', desc: lang === 'zh' ? '44.1kHz · 最快导出' : '44.1kHz · Fastest' },
  ];

  // 质量预设对应的 MP3 默认比特率
  const qualityBitrate = { higher: 320, balanced: 192, faster: 128 };

  const bitrates = [
    { value: 128, label: '128 kbps' },
    { value: 192, label: '192 kbps' },
    { value: 256, label: '256 kbps' },
    { value: 320, label: '320 kbps' },
  ];

  const handleQualityChange = (qId) => {
    setQuality(qId);
    setBitrate(qualityBitrate[qId]);
  };

  const handleExport = () => {
    onExport({ format, quality, bitrate: format === 'mp3' ? bitrate : undefined });
  };

  const progressPercent = progress ? (progress.stage === 'finalizing' || progress.stage === 'complete' ? 100 : Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, maxWidth: 420, width: '90vw' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 400 }}>
          {t.exportAudio || (lang === 'zh' ? '导出音频' : 'Export Audio')}
        </h2>

        {/* 质量选择 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            {lang === 'zh' ? '质量' : 'Quality'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {qualities.map(q => (
              <button
                key={q.id}
                onClick={() => !isExporting && handleQualityChange(q.id)}
                disabled={isExporting}
                style={{
                  flex: 1,
                  padding: '10px 6px',
                  borderRadius: 8,
                  border: quality === q.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: quality === q.id ? 'var(--accent-bg)' : 'var(--bg)',
                  color: 'var(--text)',
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  opacity: isExporting ? 0.6 : 1,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{q.label}</div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>{q.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 格式选择 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            {lang === 'zh' ? '选择格式' : 'Select Format'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {formats.map(f => (
              <button
                key={f.id}
                onClick={() => !isExporting && setFormat(f.id)}
                disabled={isExporting}
                style={{
                  flex: 1,
                  padding: '10px 8px',
                  borderRadius: 8,
                  border: format === f.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: format === f.id ? 'var(--accent-bg)' : 'var(--bg)',
                  color: 'var(--text)',
                  cursor: isExporting ? 'not-allowed' : 'pointer',
                  opacity: isExporting ? 0.6 : 1,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{f.label}</div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>{f.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* MP3 比特率选择 */}
        {format === 'mp3' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              {lang === 'zh' ? '比特率' : 'Bitrate'}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {bitrates.map(br => (
                <button
                  key={br.value}
                  onClick={() => !isExporting && setBitrate(br.value)}
                  disabled={isExporting}
                  style={{
                    flex: 1,
                    padding: '6px',
                    borderRadius: 6,
                    border: bitrate === br.value ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: bitrate === br.value ? 'var(--accent-bg)' : 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '0.7rem',
                    cursor: isExporting ? 'not-allowed' : 'pointer',
                    opacity: isExporting ? 0.6 : 1,
                  }}
                >
                  {br.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 进度条 */}
        {isExporting && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>
              {progress?.stage === 'rendering' ? (lang === 'zh' ? '正在渲染音频...' : 'Rendering audio...') :
               progress?.stage === 'finalizing' ? (lang === 'zh' ? '正在合成音频（请稍候）...' : 'Synthesizing audio (please wait)...') :
               progress?.stage === 'encoding' ? (lang === 'zh' ? '正在编码...' : 'Encoding...') :
               progress?.stage === 'complete' ? (lang === 'zh' ? '完成！' : 'Complete!') :
               (lang === 'zh' ? '处理中...' : 'Processing...')}
              {progress?.stage !== 'finalizing' && progress?.stage !== 'complete' ? ` ${progressPercent}%` : ''}
            </div>
            <div style={{ width: '100%', height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${progressPercent}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.2s' }} />
            </div>
          </div>
        )}

        {/* 按钮 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={isExporting}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.5 : 1,
              fontSize: '0.8rem',
            }}
          >
            {lang === 'zh' ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="primary"
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              fontSize: '0.8rem',
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.5 : 1,
            }}
          >
            {lang === 'zh' ? '导出' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}