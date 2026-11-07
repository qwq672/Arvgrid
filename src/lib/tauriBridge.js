// Tauri 桌面端原生音频桥接
// 检测到运行在 Tauri 内时，调用 Rust 端的 audio-core（rustysynth + cpal）
// 比网页端 WASM 路径快 3-5×，复音数 256，延迟 <10ms
//
// 注意：@tauri-apps/api 是 peer dependency，网页端 build 时可能未安装
// 用 /* @vite-ignore */ 标记让 Vite 跳过静态解析，运行时按需 dynamic import

const _isTauri = typeof window !== 'undefined'
  && (window.__TAURI_INTERNALS__ || window.__TAURI__ || (window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('Tauri')));

let _invoke = null;
async function getInvoke() {
  if (!_isTauri) return null;
  if (_invoke) return _invoke;
  try {
    // 用变量名让 Rollup 静态分析失败，从而跳过解析
    // 这样网页端 build 不需要 @tauri-apps/api 依赖
    const moduleName = '@tauri-apps/api/core';
    const mod = await import(/* @vite-ignore */ moduleName);
    _invoke = mod.invoke;
    return _invoke;
  } catch (e) {
    console.warn('[tauri-bridge] @tauri-apps/api not available, falling back to web audio:', e.message);
    return null;
  }
}

export const isTauriDesktop = _isTauri;

// 动态加载 @tauri-apps/plugin-fs 的几个方法
// 用变量名让 Vite 跳过静态解析（网页端 build 不需要这个依赖）
async function importTauriFs() {
  // v16 修复：tempDir 并非 plugin-fs 的导出（Tauri v2 的路径 API 在
  // @tauri-apps/api/path）。旧代码从 plugin-fs 解构 tempDir 得到 undefined，
  // await tempDir() 抛 TypeError → SF2 加载整链失败 → 桌面端永远静音。
  let tempDir = null;
  try {
    const pathModName = '@tauri-apps/api/path';
    const pathMod = await import(/* @vite-ignore */ pathModName);
    tempDir = pathMod.tempDir || null;
  } catch (e) { /* api/path 不可用则保持 null，调用方降级 */ }
  try {
    const modName = '@tauri-apps/plugin-fs';
    const mod = await import(/* @vite-ignore */ modName);
    return {
      writeFile: mod.writeFile,
      remove: mod.remove,
      tempDir,
    };
  } catch (e) {
    return { writeFile: null, remove: null, tempDir };
  }
}

// v16：上次加载成功的临时 SF2 路径——下次加载时清理（此时旧 AudioCore
// 已被替换、mmap 已关闭，删除安全；2GB SF2 反复换音源不再堆积磁盘）
let _lastSf2TempPath = null;

/**
 * 桌面端原生音频引擎
 * 调用 Rust 端 Tauri commands，返回 Promise
 * 不创建 AudioWorklet / AudioContext，所有音频走 cpal
 */
export const tauriAudio = {
  async loadSF2(arrayBuffer, onProgress) {
    const invoke = await getInvoke();
    if (!invoke) return false;
    try {
      // 关键性能优化：1GB+ SF2 不能用 Array.from() 转字节（OOM）
      // 改用：写到临时文件 → 传 path 给 Rust → mmap 加载
      // 2GB SF2 走 path 后 RSS 增量约 0（mmap 走 page cache）
      if (onProgress) onProgress({ stage: 'writing-tempfile', percent: 30 });

      const { writeFile, remove, tempDir } = await importTauriFs();
      if (!writeFile || !tempDir) {
        // plugin-fs 不可用，fallback 到老路径（仅适合小 SF2）
        console.warn('[tauri-bridge] plugin-fs not available, falling back to byte transfer (slow for >100MB)');
        const bytes = new Uint8Array(arrayBuffer);
        const result = await invoke('load_sf2', { sf2Bytes: Array.from(bytes) });
        console.log('[tauri-bridge] SF2 loaded (bytes):', result);
        return true;
      }

      const dir = await tempDir();
      const tmpPath = `${dir}/arvgrid_sf2_${Date.now()}.sf2`;

      // v16：清理上一次的临时文件（旧 mmap 已随 AudioCore 替换而关闭）
      if (_lastSf2TempPath && _lastSf2TempPath !== tmpPath && remove) {
        try { await remove(_lastSf2TempPath); } catch (e) { /* Windows 下句柄未释放等情况忽略 */ }
      }

      await writeFile(tmpPath, new Uint8Array(arrayBuffer));
      if (onProgress) onProgress({ stage: 'mmap-loading', percent: 60 });

      const result = await invoke('load_sf2_path', { path: tmpPath });
      console.log('[tauri-bridge] SF2 loaded (path):', result);
      _lastSf2TempPath = tmpPath; // 记录，供下次清理
      if (onProgress) onProgress({ stage: 'done', percent: 100 });
      return true;
    } catch (e) {
      console.error('[tauri-bridge] loadSF2 failed:', e);
      return false;
    }
  },

  async noteOn(channel, key, velocity) {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('note_on', { channel, key, velocity });
    } catch (e) {
      console.error('[tauri-bridge] note_on failed:', e);
    }
  },

  async noteOff(channel, key) {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('note_off', { channel, key });
    } catch (e) {
      console.error('[tauri-bridge] note_off failed:', e);
    }
  },

  async noteOffAll() {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('note_off_all');
    } catch (e) {
      console.error('[tauri-bridge] note_off_all failed:', e);
    }
  },

  /**
   * 批量调度事件（IPC 效率 5×）
   * events: [{ triggerSample, isNoteOn, channel, key, velocity }]
   */
  async noteOnBatch(events) {
    const invoke = await getInvoke();
    if (!invoke) return;
    if (!events || events.length === 0) return;
    try {
      // 转成 Rust 端 ScheduledEventDto 格式（snake_case）
      const dto = events.map(e => ({
        trigger_sample: Math.floor(e.triggerSample),
        is_note_on: !!e.isNoteOn,
        channel: e.channel || 0,
        key: e.key,
        velocity: e.velocity,
      }));
      await invoke('note_on_batch', { events: dto });
    } catch (e) {
      console.error('[tauri-bridge] note_on_batch failed:', e);
    }
  },

  async setMasterVolume(volume) {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('set_master_volume', { volume });
    } catch (e) {
      console.error('[tauri-bridge] set_master_volume failed:', e);
    }
  },

  // v12：通道音色切换（bank select + program change）
  // 旧版桌面端从未发过 program change——所有旋律轨都是钢琴音色
  async setProgram(channel, bank, program) {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('set_program', { channel, bank, program });
    } catch (e) {
      console.warn('[tauri-bridge] set_program failed:', e?.message || e);
    }
  },

  // v12：通道音量（CC#7，0-127）——调音台推子
  async setChannelVolume(channel, volume) {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('set_channel_volume', { channel, volume });
    } catch (e) {
      console.warn('[tauri-bridge] set_channel_volume failed:', e?.message || e);
    }
  },

  async audioInfo() {
    const invoke = await getInvoke();
    if (!invoke) return null;
    try {
      const info = await invoke('audio_info');
      return info;
    } catch (e) {
      console.error('[tauri-bridge] audio_info failed:', e);
      return null;
    }
  },

  async listOutputDevices() {
    const invoke = await getInvoke();
    if (!invoke) return [];
    try {
      return await invoke('list_output_devices');
    } catch (e) {
      console.error('[tauri-bridge] list_output_devices failed:', e);
      return [];
    }
  },

  async switchOutputDevice(deviceName) {
    const invoke = await getInvoke();
    if (!invoke) return false;
    try {
      await invoke('switch_output_device', { deviceName });
      return true;
    } catch (e) {
      console.error('[tauri-bridge] switch_output_device failed:', e);
      return false;
    }
  },

  async getSampleCounter() {
    const invoke = await getInvoke();
    if (!invoke) return 0;
    try {
      return await invoke('get_sample_counter');
    } catch (e) {
      return 0;
    }
  },

  // v12：重置采样计数器 + 清空调度队列（每次播放/恢复前必须调用，
  // 否则旧计数把新调度的前 N 秒事件瞬间全部触发——桌面端音符堆爆的根源）
  async resetSampleCounter() {
    const invoke = await getInvoke();
    if (!invoke) return;
    try {
      await invoke('reset_sample_counter');
    } catch (e) {
      console.warn('[tauri-bridge] reset_sample_counter failed:', e?.message || e);
    }
  },
};
