// Test script for SF2 parsing
import { readFileSync } from 'fs';
import { parseSF2 } from './src/lib/sf2Parser.js';

const sf2Path = process.argv[2];
if (!sf2Path) {
  console.log('Usage: node test-sf2.mjs <path-to-sf2>');
  process.exit(1);
}

const buffer = readFileSync(sf2Path).buffer;
const result = parseSF2(buffer);

console.log('\n=== Final Result ===');
console.log(`Name: ${result.name}`);
console.log(`Presets: ${result.presets.length}`);
result.presets.forEach((p, i) => {
  const populated = p.sampleIndex.filter(s => s !== null).length;
  console.log(`  [${i}] "${p.name}" (bank=${p.bank}, program=${p.program}) -> ${populated}/128 notes`);
  
  // Check for potential issues
  if (populated > 0 && populated < 128) {
    const samples = new Set();
    let maxRange = 0;
    let minRange = 127;
    for (let m = 0; m < 128; m++) {
      if (p.sampleIndex[m]) {
        samples.add(p.sampleIndex[m].rootKey);
        minRange = Math.min(minRange, m);
        maxRange = Math.max(maxRange, m);
      }
    }
    console.log(`    Range: [${minRange}, ${maxRange}], unique rootKeys: ${samples.size}`);
    if (samples.size > 5) {
      // Show first 10 unique root keys
      const uniqueRootKeys = [...new Set(p.sampleIndex.filter(s => s).map(s => s.rootKey))].slice(0, 10);
      console.log(`    Root keys: ${uniqueRootKeys.join(', ')}`);
      
      // Check if different root keys are in different ranges (drum kit pattern)
      let lastRootKey = null;
      let transitions = [];
      for (let m = 0; m < 128; m++) {
        const s = p.sampleIndex[m];
        if (s && s.rootKey !== lastRootKey) {
          transitions.push({midi: m, rootKey: s.rootKey});
          lastRootKey = s.rootKey;
        }
      }
      if (transitions.length > 5) {
        console.log(`    WARNING: ${transitions.length} rootKey transitions - this looks like a drum kit or multi-instrument preset!`);
        console.log(`    First 15 transitions: ${transitions.slice(0, 15).map(t => `M${t.midi}=RK${t.rootKey}`).join(', ')}`);
      }
    }
  }
});