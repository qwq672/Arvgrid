import React, { useState, useMemo, memo, useCallback } from 'react';
import AutomationCurveEditor from './AutomationCurveEditor';
import { AUTOMATION_PARAMS, AUTOMATION_GROUPS, emptyAutomation } from '../lib/automation';

// 自动化面板：选择参数 → 编辑关键帧 → 启用 / 关闭
// props:
//   automation: { [paramKey]: { enabled, points } }
//   onChange: (key, automationObj) => void
//   onClear:   (key) => void
//   currentTime: 当前播放时间
//   totalDuration: 工程总时长
//   lang: 'zh' | 'en'
const AutomationPanel = memo(({
  automation = {},
  onChange,
  onClear,
  currentTime = 0,
  totalDuration = 16,
  lang = 'zh',
}) => {
  const [selectedKey, setSelectedKey] = useState('master.volume');

  const param = useMemo(() => AUTOMATION_PARAMS.find(p => p.key === selectedKey), [selectedKey]);
  const currentAuto = automation[selectedKey];
  const points = (currentAuto && currentAuto.points) || [];
  const enabled = !!(currentAuto && currentAuto.enabled);

  // 编辑点：本地操作 points，更新到外层
  const handlePointsChange = useCallback((nextPoints) => {
    if (!onChange) return;
    const sorted = nextPoints.slice().sort((a, b) => a.t - b.t);
    onChange(selectedKey, {
      enabled: enabled,
      points: sorted,
    });
  }, [onChange, selectedKey, enabled]);

  // 启用/关闭
  const handleToggleEnabled = useCallback(() => {
    if (!onChange) return;
    if (!currentAuto) {
      // 首次启用：用参数默认值生成一条平线
      const def = param ? param.toNormalized(param.default) : 0.5;
      onChange(selectedKey, {
        enabled: true,
        points: [
          { t: 0, v: def },
          { t: Math.max(1, totalDuration), v: def },
        ],
      });
      return;
    }
    onChange(selectedKey, { ...currentAuto, enabled: !currentAuto.enabled });
  }, [currentAuto, onChange, param, totalDuration]);

  // 重置为平线（参数默认值）
  const handleReset = useCallback(() => {
    if (!onChange || !param) return;
    const def = param.toNormalized(param.default);
    onChange(selectedKey, {
      enabled,
      points: [
        { t: 0, v: def },
        { t: Math.max(1, totalDuration), v: def },
      ],
    });
  }, [onChange, param, enabled, selectedKey, totalDuration]);

  // 清空
  const handleClear = useCallback(() => {
    if (!onClear) return;
    onClear(selectedKey);
  }, [onClear, selectedKey]);

  // 添加 1/3 / 2/3 两个点（快速编辑常见曲线）
  const handleAddMidPoints = useCallback(() => {
    if (!onChange) return;
    const def = param ? param.toNormalized(param.default) : 0.5;
    const base = currentAuto && currentAuto.points && currentAuto.points.length > 0
      ? currentAuto.points
      : [{ t: 0, v: def }, { t: Math.max(1, totalDuration), v: def }];
    const t1 = totalDuration / 3;
    const t2 = totalDuration * 2 / 3;
    const v1 = sampleSafe(base, t1);
    const v2 = sampleSafe(base, t2);
    const next = base.slice();
    next.push({ t: t1, v: v1 });
    next.push({ t: t2, v: v2 });
    next.sort((a, b) => a.t - b.t);
    onChange(selectedKey, { enabled, points: next });
  }, [currentAuto, enabled, onChange, param, selectedKey, totalDuration]);

  const duration = Math.max(4, totalDuration || 16);

  // 当前自然值（用于显示）
  const currentNatural = useMemo(() => {
    if (!param || points.length === 0) return null;
    if (!enabled) return param.default;
    const n = sampleSafe(points, currentTime);
    return param.fromNormalized(n);
  }, [param, points, enabled, currentTime]);

  return (
    <div>
      {/* 参数选择器 + 启用开关 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <select
          value={selectedKey}
          onChange={e => setSelectedKey(e.target.value)}
          style={{
            flex: 1, minWidth: 180, fontSize: '0.75rem',
            background: 'var(--bg-input, #1a1d23)', color: 'var(--text, #e5e7eb)',
            border: '1px solid var(--border, #2a2e36)', borderRadius: 4,
            padding: '4px 8px',
          }}
        >
          {AUTOMATION_GROUPS.map(group => (
            <optgroup key={group.key} label={lang === 'zh' ? group.label : group.labelEn}>
              {AUTOMATION_PARAMS.filter(p => p.group === group.key).map(p => (
                <option key={p.key} value={p.key}>
                  {lang === 'zh' ? p.label : p.labelEn}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          onClick={handleToggleEnabled}
          style={{
            padding: '4px 12px', fontSize: '0.72rem', cursor: 'pointer',
            background: enabled ? 'var(--accent, #4a9eff)' : 'var(--bg-button, #2a2e36)',
            color: enabled ? '#fff' : 'var(--text, #e5e7eb)',
            border: '1px solid var(--border, #3a3e46)',
            borderRadius: 4, fontWeight: 500,
          }}
        >
          {enabled ? (lang === 'zh' ? '已启用' : 'Enabled') : (lang === 'zh' ? '启用' : 'Enable')}
        </button>
      </div>

      {/* 曲线编辑器 */}
      <AutomationCurveEditor
        points={points}
        duration={duration}
        param={param}
        currentTime={currentTime}
        onChange={handlePointsChange}
        height={140}
      />

      {/* 当前值显示 + 操作按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #9ca3af)' }}>
          {lang === 'zh' ? '当前值' : 'Current'}: <span style={{ color: 'var(--text, #e5e7eb)', fontWeight: 600 }}>
            {currentNatural != null ? formatVal(currentNatural, param) : '--'}
          </span>
          {param && param.unit && <span style={{ marginLeft: 2 }}>{param.unit}</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button onClick={handleAddMidPoints} style={btnStyle}>
            {lang === 'zh' ? '+ 中点' : '+ Mids'}
          </button>
          <button onClick={handleReset} style={btnStyle}>
            {lang === 'zh' ? '重置' : 'Reset'}
          </button>
          <button onClick={handleClear} style={btnStyle}>
            {lang === 'zh' ? '清空' : 'Clear'}
          </button>
        </div>
      </div>

      {/* 已启用列表 */}
      <EnabledList automation={automation} onPick={setSelectedKey} lang={lang} />
    </div>
  );
});

// 已启用自动化列表
const EnabledList = memo(({ automation, onPick, lang }) => {
  const enabledKeys = Object.keys(automation).filter(k => automation[k] && automation[k].enabled);
  if (enabledKeys.length === 0) {
    return (
      <div style={{ marginTop: 10, fontSize: '0.7rem', color: 'var(--text-muted, #6b7280)', textAlign: 'center', padding: '6px 0', borderTop: '1px dashed var(--border, #2a2e36)' }}>
        {lang === 'zh' ? '尚未启用任何自动化' : 'No automation enabled'}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px dashed var(--border, #2a2e36)' }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #6b7280)', marginBottom: 4 }}>
        {lang === 'zh' ? '已启用列表' : 'Enabled'} ({enabledKeys.length})
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {enabledKeys.map(k => {
          const p = AUTOMATION_PARAMS.find(p => p.key === k);
          const label = p ? (lang === 'zh' ? p.label : p.labelEn) : k;
          return (
            <button
              key={k}
              onClick={() => onPick(k)}
              style={{
                fontSize: '0.65rem', padding: '2px 8px',
                background: 'var(--bg-button, #2a2e36)', color: 'var(--text, #e5e7eb)',
                border: '1px solid var(--border, #3a3e46)', borderRadius: 12, cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
});

const btnStyle = {
  padding: '3px 10px', fontSize: '0.68rem', cursor: 'pointer',
  background: 'var(--bg-button, #2a2e36)', color: 'var(--text, #e5e7eb)',
  border: '1px solid var(--border, #3a3e46)', borderRadius: 4,
};

function sampleSafe(points, t) {
  if (!points || points.length === 0) return 0.5;
  if (points.length === 1) return points[0].v;
  const sorted = points.slice().sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].v;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].t && t <= sorted[i + 1].t) {
      const r = (t - sorted[i].t) / Math.max(0.0001, sorted[i + 1].t - sorted[i].t);
      return sorted[i].v + (sorted[i + 1].v - sorted[i].v) * r;
    }
  }
  return sorted[sorted.length - 1].v;
}

function formatVal(naturalVal, param) {
  if (!param) return naturalVal.toFixed(2);
  if (param.step && param.step >= 1) return `${Math.round(naturalVal)}`;
  return naturalVal.toFixed(2);
}

export default AutomationPanel;
