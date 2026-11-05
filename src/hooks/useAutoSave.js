import { useEffect, useRef, useCallback } from 'react';
import { saveAutosave, addRecentProject } from './useProject';

// 自动保存优化：
// - 大工程跳过自动保存（localStorage 5MB 限制 + JSON.stringify 阻塞主线程）
// - 用 "note count + bpm + meta.title" 作为 fingerprint 比较是否变化
//   避免每次都 JSON.stringify 整个 50 万音符工程
// - 大工程的保存建议用户手动用 Ctrl+S（导出为 JSON 文件）

// 工程超过此音符数则跳过 localStorage 自动保存（避免阻塞主线程）
// 用户仍可用 Ctrl+S 手动导出 JSON 文件
const AUTOSAVE_NOTE_LIMIT = 20000;

export function useAutoSave(getProjectData, autoSaveMode) {
  const lastSavedFingerprintRef = useRef('');
  const timerRef = useRef(null);

  const triggerAutoSave = useCallback(() => {
    const data = getProjectData();
    if (!data) return;

    // 计算 fingerprint：用音符总数 + bpm + 标题，不序列化整个数据
    let noteCount = 0;
    if (data.tracks) {
      for (const t of data.tracks) {
        if (t.notes) noteCount += t.notes.length;
      }
    }
    const fingerprint = `${noteCount}|${data.bpm}|${data.meta?.title || ''}|${data.currentTrackId}`;

    // 大工程跳过 localStorage 自动保存
    if (noteCount > AUTOSAVE_NOTE_LIMIT) {
      if (lastSavedFingerprintRef.current !== fingerprint) {
        lastSavedFingerprintRef.current = fingerprint;
        // 不写 localStorage，但仍记录最近工程列表
        addRecentProject({ id: 'autosave', title: data.meta?.title || '未命名工程', timestamp: Date.now() });
      }
      return;
    }

    // 小工程：正常自动保存到 localStorage
    // 但仍用 fingerprint 比较，避免每次都 JSON.stringify
    if (lastSavedFingerprintRef.current === fingerprint) {
      return;  // 没变化，跳过
    }
    lastSavedFingerprintRef.current = fingerprint;
    const dataToSave = { ...data, savedAt: Date.now() };
    saveAutosave(dataToSave);
    addRecentProject({ id: 'autosave', title: data.meta?.title || '未命名工程', timestamp: Date.now() });
  }, [getProjectData]);

  useEffect(() => {
    if (autoSaveMode.type === 'interval' && autoSaveMode.interval > 0) {
      timerRef.current = setInterval(triggerAutoSave, autoSaveMode.interval * 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [autoSaveMode, triggerAutoSave]);

  return { triggerAutoSave };
}
