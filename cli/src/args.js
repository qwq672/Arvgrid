// 参数解析

export function parseArgs(args) {
  const opts = {
    bpm: 120,
    key: 'C',
    scale: 'major',
    mood: 'neutral',
    tempo: 'medium',
    preset: null,
    sections: 4,
    bars: 4,
    output: null,
    seed: null,
    format: 'arvgrid',
  };

  // 检查 stdin（AI agent 模式）
  if (args.length === 0 && !process.stdin.isTTY) {
    // 从 stdin 读取 JSON
    const chunks = [];
    // 同步读取 stdin（简单实现）
    const fd = require('fs').readFileSync(0, 'utf-8');
    if (fd) {
      try {
        const stdin = JSON.parse(fd);
        Object.assign(opts, stdin);
      } catch (e) {
        // 不是 JSON，忽略
      }
    }
  }

  // 解析命令行参数
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--bpm': opts.bpm = parseInt(args[++i]) || 120; break;
      case '--key': opts.key = args[++i] || 'C'; break;
      case '--scale': opts.scale = args[++i] || 'major'; break;
      case '--mood': opts.mood = args[++i] || 'neutral'; break;
      case '--tempo': opts.tempo = args[++i] || 'medium'; break;
      case '--preset': opts.preset = args[++i] || null; break;
      case '--sections': opts.sections = parseInt(args[++i]) || 4; break;
      case '--bars': opts.bars = parseInt(args[++i]) || 4; break;
      case '--output': opts.output = args[++i] || null; break;
      case '--seed': opts.seed = parseInt(args[++i]) || null; break;
      case '--format': opts.format = args[++i] || 'arvgrid'; break;
    }
  }

  return opts;
}
