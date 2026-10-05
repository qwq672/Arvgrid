#!/usr/bin/env node

// Arvgrid CLI - AI agent friendly MIDI composer
// 输出 arvgrid 工程格式（JSON v3），可被 arvgrid 网页端/桌面端直接导入
//
// 用法：
//   node arvgrid.js --preset piano-ballad > song.json
//   node arvgrid.js --bpm 128 --key Am --mood dark > song.json
//   echo '{"bpm":120}' | node arvgrid.js > song.json

import { generateProject } from '../src/generator.js';
import { parseArgs } from '../src/args.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Arvgrid CLI - AI agent friendly MIDI composer

用法:
  node arvgrid.js [options] > output.json

选项:
  --bpm <n>         BPM (默认 120)
  --key <key>       调性 (C, Am, F#m, 默认 C)
  --scale <name>    音阶 (major, minor, pentatonic, 默认 major)
  --mood <name>     情绪 (happy, sad, epic, chill, dark, 默认 neutral)
  --tempo <name>    速度 (slow, medium, fast, 默认 medium)
  --preset <name>   预设 (piano-ballad, electronic, rock, jazz, ambient)
  --sections <n>     段落数 (默认 4)
  --bars <n>         每段小节数 (默认 4)
  --output <file>   输出文件 (默认 stdout)
  --seed <n>        随机种子

预设:
  piano-ballad      钢琴抒情 (慢, Am, 钢琴+弦乐)
  electronic        电子 (快, Cm, 合成器+鼓)
  rock              摇滚 (中, E, 吉他+鼓)
  jazz              爵士 (中, Dm, 钢琴+贝斯+鼓)
  ambient           氛围 (慢, C, 铺底)

示例:
  node arvgrid.js --preset piano-ballad > song.json
  node arvgrid.js --bpm 140 --key Am --mood dark > song.json
`);
  process.exit(0);
}

try {
  const opts = parseArgs(args);
  const project = generateProject(opts);
  
  if (opts.output) {
    const fs = await import('fs');
    fs.writeFileSync(opts.output, JSON.stringify(project, null, 2));
    console.error(`Project saved to ${opts.output}`);
  } else {
    process.stdout.write(JSON.stringify(project));
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
