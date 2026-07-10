// src/lib/midi.js

// 将 MIDI 音符编号转换为音高名称，例如 60 -> "C4"
export function midiToNote(midi) {
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return notes[midi % 12] + octave;
}

// 将音高名称转换为 MIDI 音符编号，例如 "C4" -> 60
export function noteToMidi(pitch) {
  const match = pitch.match(/^([A-G][#b]?)(\d+)$/);
  if (!match) return 60;
  const note = match[1];
  const octave = parseInt(match[2]);
  const map = {
    'C': 0, 'C#': 1, 'Db': 1,
    'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4,
    'F': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'Bb': 10,
    'B': 11
  };
  const semitone = map[note];
  if (semitone === undefined) return 60;
  return (octave + 1) * 12 + semitone;
}

// 将 tick 转换为秒，使用 tempo map
function tickToSec(tick, tempoMap, ticksPerBeat) {
  if (tempoMap.length === 0) return tick / ticksPerBeat / 2; // 默认 120 BPM
  let sec = 0;
  let lastTick = 0;
  let lastBpm = tempoMap[0].bpm;
  for (let i = 0; i < tempoMap.length; i++) {
    const { tick: t, bpm } = tempoMap[i];
    if (t > tick) break;
    sec += (t - lastTick) / ticksPerBeat / (lastBpm / 60);
    lastTick = t;
    lastBpm = bpm;
  }
  sec += (tick - lastTick) / ticksPerBeat / (lastBpm / 60);
  return sec;
}

// GM 乐器名称
const GM_INSTRUMENTS = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
  'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ',
  'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
  'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass',
  'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
  'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet',
  'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax',
  'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute',
  'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
  'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
  'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto',
  'Kalimba', 'Bag pipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock',
  'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet',
  'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'
];

function getInstrumentName(program) {
  return GM_INSTRUMENTS[program] || `Instrument ${program}`;
}

/**
 * 解析 MIDI 文件 (ArrayBuffer)
 * 返回: { bpm, tracks, title, copyright }
 * tracks 格式: [{ name, program, notes: [{ pitch, startSec, durationSec, velocity }] }]
 */
export async function parseMidiFile(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  let pos = 0;

  // 读取 MIDI 头
  if (data[pos] !== 0x4D || data[pos+1] !== 0x54 || data[pos+2] !== 0x68 || data[pos+3] !== 0x64)
    throw new Error("Invalid MIDI header");
  pos += 4;
  const headerLen = (data[pos]<<24) | (data[pos+1]<<16) | (data[pos+2]<<8) | data[pos+3]; pos += 4;
  const format = (data[pos]<<8) | data[pos+1]; pos += 2;
  const numTracks = (data[pos]<<8) | data[pos+1]; pos += 2;
  const division = (data[pos]<<8) | data[pos+1]; pos += 2;
  const ticksPerBeat = division & 0x7FFF;
  if (ticksPerBeat <= 0) throw new Error("Invalid division");

  // 第一遍：收集所有轨道的原始事件，构建全局 tempo map
  const tempoMap = []; // [{ tick, bpm }]
  const trackEvents = []; // 每个轨道的原始事件
  let globalTitle = "", globalCopyright = "";

  for (let t = 0; t < numTracks; t++) {
    if (data[pos] !== 0x4D || data[pos+1] !== 0x54 || data[pos+2] !== 0x72 || data[pos+3] !== 0x6B)
      throw new Error("Invalid track chunk");
    pos += 4;
    const trackLen = (data[pos]<<24) | (data[pos+1]<<16) | (data[pos+2]<<8) | data[pos+3]; pos += 4;
    const end = pos + trackLen;
    let currentTick = 0;
    const events = [];
    let trackName = "";
    let runningStatus = null;

    while (pos < end) {
      // 读取变长 delta
      let delta = 0, b;
      do {
        b = data[pos++];
        delta = (delta << 7) | (b & 0x7F);
      } while (b & 0x80);
      currentTick += delta;

      let event = data[pos++];
      if (event < 0x80) {
        if (runningStatus === null) throw new Error("Running status error");
        event = runningStatus;
        pos--;
      } else {
        runningStatus = event;
      }
      const type = event & 0xF0;
      const channel = event & 0x0F;

      if (event === 0xFF) { // Meta 事件
        const metaType = data[pos++];
        const len = data[pos++];
        if (metaType === 0x51 && len === 3) { // 设置速度
          const tt = (data[pos]<<16) | (data[pos+1]<<8) | data[pos+2];
          const bpm = 60000000 / tt;
          tempoMap.push({ tick: currentTick, bpm });
          pos += 3;
        } else if (metaType === 0x03 && len > 0) { // 轨道名称
          trackName = new TextDecoder().decode(data.slice(pos, pos + len));
          pos += len;
          if (t === 0 && !globalTitle) globalTitle = trackName;
        } else if (metaType === 0x02 && len > 0) { // 版权信息
          globalCopyright = new TextDecoder().decode(data.slice(pos, pos + len));
          pos += len;
        } else {
          pos += len;
        }
      } else if (type === 0x80) { // Note Off
        const pitch = data[pos++];
        const velocity = data[pos++];
        events.push({ type: 'noteOff', tick: currentTick, channel, pitch, velocity });
      } else if (type === 0x90) { // Note On
        const pitch = data[pos++];
        const velocity = data[pos++];
        events.push({ type: 'noteOn', tick: currentTick, channel, pitch, velocity });
      } else if (type === 0xC0) { // Program Change
        const program = data[pos++];
        events.push({ type: 'program', tick: currentTick, channel, program });
      } else if (type === 0xB0) { // Controller
        const controller = data[pos++];
        const value = data[pos++];
        events.push({ type: 'controller', tick: currentTick, channel, controller, value });
      } else {
        // 跳过其他事件 (Poly Pressure, Pitch Bend, SysEx 等)
        if (type === 0xA0 || type === 0xD0) pos += 1;
        else if (type === 0xE0) pos += 2;
        else if (event === 0xF0 || event === 0xF7) {
          let l = 0, lb;
          do {
            lb = data[pos++];
            l = (l << 7) | (lb & 0x7F);
          } while (lb & 0x80);
          pos += l;
        }
      }
    }

    trackEvents.push({ name: trackName, events });
  }

  // 对 tempo map 按 tick 排序
  tempoMap.sort((a, b) => a.tick - b.tick);

  // 确定初始 BPM
  const initialBpm = tempoMap.length > 0 ? tempoMap[0].bpm : 120;

  // 第二遍：按 channel 分组音符，应用 program change
  // 每个 MIDI track 可能包含多个 channel，每个 channel 有不同的乐器
  const channelTracks = new Map(); // key: `${trackIdx}_${channel}`, value: { name, program, notes, channel }

  for (let t = 0; t < trackEvents.length; t++) {
    const { name, events } = trackEvents[t];
    // 每个 channel 的 program 状态
    const channelPrograms = new Map(); // channel -> program
    // 每个 channel 的活跃音符
    const noteOnMap = new Map(); // key: `${channel}_${pitch}`, value: { tick, velocity }

    for (const ev of events) {
      if (ev.type === 'program') {
        channelPrograms.set(ev.channel, ev.program);
      } else if (ev.type === 'noteOn') {
        if (ev.velocity > 0) {
          noteOnMap.set(`${ev.channel}_${ev.pitch}`, { tick: ev.tick, velocity: ev.velocity });
        } else {
          // velocity = 0 视为 Note Off
          const key = `${ev.channel}_${ev.pitch}`;
          if (noteOnMap.has(key)) {
            const on = noteOnMap.get(key);
            const startSec = tickToSec(on.tick, tempoMap, ticksPerBeat);
            const durSec = tickToSec(ev.tick, tempoMap, ticksPerBeat) - startSec;
            if (durSec > 0) {
              const prog = channelPrograms.get(ev.channel) || 0;
              const trackKey = `${t}_${ev.channel}`;
              if (!channelTracks.has(trackKey)) {
                channelTracks.set(trackKey, {
                  name: name || getInstrumentName(prog),
                  program: prog,
                  notes: [],
                });
              }
              channelTracks.get(trackKey).notes.push({
                pitch: midiToNote(ev.pitch),
                startSec,
                durationSec: durSec,
                velocity: on.velocity,
              });
            }
            noteOnMap.delete(key);
          }
        }
      } else if (ev.type === 'noteOff') {
        const key = `${ev.channel}_${ev.pitch}`;
        if (noteOnMap.has(key)) {
          const on = noteOnMap.get(key);
          const startSec = tickToSec(on.tick, tempoMap, ticksPerBeat);
          const durSec = tickToSec(ev.tick, tempoMap, ticksPerBeat) - startSec;
          if (durSec > 0) {
            const prog = channelPrograms.get(ev.channel) || 0;
            const trackKey = `${t}_${ev.channel}`;
            if (!channelTracks.has(trackKey)) {
              channelTracks.set(trackKey, {
                name: name || getInstrumentName(prog),
                program: prog,
                notes: [],
              });
            }
            channelTracks.get(trackKey).notes.push({
              pitch: midiToNote(ev.pitch),
              startSec,
              durationSec: durSec,
              velocity: on.velocity,
            });
          }
          noteOnMap.delete(key);
        }
      }
    }

    // 处理未关闭的音符
    for (const [key, on] of noteOnMap.entries()) {
      const parts = key.split('_');
      const channel = parseInt(parts[0]);
      const pitch = parseInt(parts[1]);
      const startSec = tickToSec(on.tick, tempoMap, ticksPerBeat);
      const durSec = tickToSec(events[events.length - 1].tick, tempoMap, ticksPerBeat) - startSec;
      if (durSec > 0) {
        const prog = channelPrograms.get(channel) || 0;
        const trackKey = `${t}_${channel}`;
        if (!channelTracks.has(trackKey)) {
          channelTracks.set(trackKey, {
            name: name || getInstrumentName(prog),
            program: prog,
            notes: [],
          });
        }
        channelTracks.get(trackKey).notes.push({
          pitch: midiToNote(pitch),
          startSec,
          durationSec: durSec,
          velocity: on.velocity,
        });
      }
    }
  }

  // 转换为数组并排序
  const tracksData = [];
  for (const track of channelTracks.values()) {
    if (track.notes.length > 0) {
      track.notes.sort((a, b) => a.startSec - b.startSec);
      tracksData.push(track);
    }
  }

  if (tracksData.length === 0) throw new Error("No notes found in MIDI file");
  return {
    bpm: initialBpm,
    tracks: tracksData,
    title: globalTitle,
    copyright: globalCopyright
  };
}

/**
 * 生成 MIDI 文件 (Type 1)
 * tracks: [{ name, program, notes: [{ pitch, startSec, durationSec, velocity }] }]
 * meta: { title, copyright }
 */
export function generateMidiFile(tracks, bpm, meta = {}) {
  const ticksPerBeat = 480;
  const events = [];

  // 全局速度事件
  events.push({ tick: 0, type: 'tempo', tempo: 60000000 / bpm });
  if (meta.title) {
    events.push({
      tick: 0,
      type: 'meta',
      metaType: 0x03,
      data: new TextEncoder().encode(meta.title)
    });
  }
  if (meta.copyright) {
    events.push({
      tick: 0,
      type: 'meta',
      metaType: 0x02,
      data: new TextEncoder().encode(meta.copyright)
    });
  }

  // 每个轨道的事件
  tracks.forEach((track, idx) => {
    const channel = idx % 16;
    // 程序号
    events.push({ tick: 0, type: 'program', channel, program: track.program });
    if (track.name) {
      events.push({
        tick: 0,
        type: 'meta',
        metaType: 0x03,
        data: new TextEncoder().encode(track.name)
      });
    }
    // 音符
    track.notes.forEach(n => {
      const startTick = Math.round(n.startSec * (bpm / 60) * ticksPerBeat);
      const durTick = Math.round(n.durationSec * (bpm / 60) * ticksPerBeat);
      const pitch = noteToMidi(n.pitch);
      events.push({ tick: startTick, type: 'noteOn', channel, pitch, velocity: n.velocity });
      events.push({ tick: startTick + durTick, type: 'noteOff', channel, pitch, velocity: 0 });
    });
  });

  // 按 tick 排序
  events.sort((a, b) => a.tick - b.tick);
  const maxTick = events.length ? events[events.length - 1].tick : 0;
  events.push({ tick: maxTick, type: 'end' });

  // 变长编码函数
  function writeVarLen(val) {
    const buf = [];
    buf.push(val & 0x7F);
    val >>= 7;
    while (val > 0) {
      buf.push((val & 0x7F) | 0x80);
      val >>= 7;
    }
    return buf.reverse();
  }

  // 按轨道分组（简单按 channel 分组）
  const trackMap = new Map();
  for (const ev of events) {
    let tid = 0;
    if (ev.type === 'program' || ev.type === 'noteOn' || ev.type === 'noteOff') tid = ev.channel;
    else if (ev.type === 'meta') tid = 0;
    else if (ev.type === 'tempo') tid = 0;
    if (!trackMap.has(tid)) trackMap.set(tid, []);
    trackMap.get(tid).push(ev);
  }

  const trackBuffers = [];
  for (const [tid, evs] of trackMap) {
    evs.sort((a, b) => a.tick - b.tick);
    let lastTick = 0;
    const buffer = [];
    for (const ev of evs) {
      let delta = ev.tick - lastTick;
      if (delta < 0) delta = 0;
      lastTick = ev.tick;
      buffer.push(...writeVarLen(delta));

      if (ev.type === 'tempo') {
        buffer.push(0xFF, 0x51, 0x03);
        const t = ev.tempo;
        buffer.push((t >> 16) & 0xFF, (t >> 8) & 0xFF, t & 0xFF);
      } else if (ev.type === 'meta') {
        buffer.push(0xFF, ev.metaType, ev.data.length, ...ev.data);
      } else if (ev.type === 'program') {
        buffer.push(0xC0 | ev.channel, ev.program);
      } else if (ev.type === 'noteOn') {
        buffer.push(0x90 | ev.channel, ev.pitch, ev.velocity);
      } else if (ev.type === 'noteOff') {
        buffer.push(0x80 | ev.channel, ev.pitch, 0);
      }
    }
    buffer.push(0xFF, 0x2F, 0x00);  // 轨道结束
    trackBuffers.push(new Uint8Array(buffer));
  }

  // 构建 MIDI 文件头
  let totalSize = 14;
  for (const buf of trackBuffers) totalSize += 8 + buf.length;
  const file = new ArrayBuffer(totalSize);
  const view = new DataView(file);
  let pos = 0;
  view.setUint32(pos, 0x4D546864); pos += 4;
  view.setUint32(pos, 6); pos += 4;
  view.setUint16(pos, 1); pos += 2;   // Type 1
  view.setUint16(pos, trackBuffers.length); pos += 2;
  view.setUint16(pos, ticksPerBeat); pos += 2;
  for (const buf of trackBuffers) {
    view.setUint32(pos, 0x4D54726B); pos += 4;
    view.setUint32(pos, buf.length); pos += 4;
    for (let i = 0; i < buf.length; i++) view.setUint8(pos++, buf[i]);
  }
  return file;
}
