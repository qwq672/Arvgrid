import React, { useState, useRef } from 'react';
import { Icons } from './Icons';
import { useTranslation } from '../lib/i18n';

const TRACK_COLORS = ['#339af0','#ff6b6b','#ff922b','#fcc419','#51cf66','#20c997','#845ef7','#e64980','#adb5bd','#ff8787','#d8f5a2','#748ffc'];

const GROUP_NAMES = ['A', 'B', 'C', 'D'];
const GROUP_TINTS = { A: 'rgba(51,154,240,0.08)', B: 'rgba(255,107,107,0.08)', C: 'rgba(81,207,102,0.08)', D: 'rgba(250,176,5,0.08)' };

const GM_INSTRUMENTS = [
  { id: 0, zh: "大钢琴", en: "Acoustic Grand Piano" },
  { id: 1, zh: "亮音钢琴", en: "Bright Acoustic Piano" },
  { id: 2, zh: "电钢琴", en: "Electric Grand Piano" },
  { id: 3, zh: "酒吧钢琴", en: "Honky-tonk Piano" },
  { id: 4, zh: "电钢琴1", en: "Electric Piano 1" },
  { id: 5, zh: "电钢琴2", en: "Electric Piano 2" },
  { id: 6, zh: "羽管键琴", en: "Harpsichord" },
  { id: 7, zh: "击弦古钢琴", en: "Clavinet" },
  { id: 8, zh: "钢片琴", en: "Celesta" },
  { id: 9, zh: "钟琴", en: "Glockenspiel" },
  { id: 10, zh: "八音盒", en: "Music Box" },
  { id: 11, zh: "颤音琴", en: "Vibraphone" },
  { id: 12, zh: "马林巴", en: "Marimba" },
  { id: 13, zh: "木琴", en: "Xylophone" },
  { id: 14, zh: "管钟", en: "Tubular Bells" },
  { id: 15, zh: "大扬琴", en: "Dulcimer" },
  { id: 16, zh: "拉杆风琴", en: "Drawbar Organ" },
  { id: 17, zh: "敲击风琴", en: "Percussive Organ" },
  { id: 18, zh: "摇滚风琴", en: "Rock Organ" },
  { id: 19, zh: "教堂风琴", en: "Church Organ" },
  { id: 20, zh: "簧风琴", en: "Reed Organ" },
  { id: 21, zh: "手风琴", en: "Accordion" },
  { id: 22, zh: "口琴", en: "Harmonica" },
  { id: 23, zh: "探戈手风琴", en: "Tango Accordion" },
  { id: 24, zh: "尼龙弦吉他", en: "Acoustic Guitar (nylon)" },
  { id: 25, zh: "钢弦吉他", en: "Acoustic Guitar (steel)" },
  { id: 26, zh: "爵士电吉他", en: "Electric Guitar (jazz)" },
  { id: 27, zh: "清音电吉他", en: "Electric Guitar (clean)" },
  { id: 28, zh: "闷音电吉他", en: "Electric Guitar (muted)" },
  { id: 29, zh: "过载吉他", en: "Overdriven Guitar" },
  { id: 30, zh: "失真吉他", en: "Distortion Guitar" },
  { id: 31, zh: "吉他泛音", en: "Guitar Harmonics" },
  { id: 32, zh: "原声贝司", en: "Acoustic Bass" },
  { id: 33, zh: "指弹电贝司", en: "Electric Bass (finger)" },
  { id: 34, zh: "拨片电贝司", en: "Electric Bass (pick)" },
  { id: 35, zh: "无品贝司", en: "Fretless Bass" },
  { id: 36, zh: "掌击贝司1", en: "Slap Bass 1" },
  { id: 37, zh: "掌击贝司2", en: "Slap Bass 2" },
  { id: 38, zh: "合成贝司1", en: "Synth Bass 1" },
  { id: 39, zh: "合成贝司2", en: "Synth Bass 2" },
  { id: 40, zh: "小提琴", en: "Violin" },
  { id: 41, zh: "中提琴", en: "Viola" },
  { id: 42, zh: "大提琴", en: "Cello" },
  { id: 43, zh: "低音提琴", en: "Contrabass" },
  { id: 44, zh: "颤音弦乐", en: "Tremolo Strings" },
  { id: 45, zh: "拨奏弦乐", en: "Pizzicato Strings" },
  { id: 46, zh: "竖琴", en: "Orchestral Harp" },
  { id: 47, zh: "定音鼓", en: "Timpani" },
  { id: 48, zh: "弦乐合奏1", en: "String Ensemble 1" },
  { id: 49, zh: "弦乐合奏2", en: "String Ensemble 2" },
  { id: 50, zh: "合成弦乐1", en: "Synth Strings 1" },
  { id: 51, zh: "合成弦乐2", en: "Synth Strings 2" },
  { id: 52, zh: "唱诗班和声", en: "Choir Aahs" },
  { id: 53, zh: "嘟嘟声", en: "Voice Oohs" },
  { id: 54, zh: "合成人声", en: "Synth Voice" },
  { id: 55, zh: "管弦乐齐奏", en: "Orchestra Hit" },
  { id: 56, zh: "小号", en: "Trumpet" },
  { id: 57, zh: "长号", en: "Trombone" },
  { id: 58, zh: "大号", en: "Tuba" },
  { id: 59, zh: "闷音小号", en: "Muted Trumpet" },
  { id: 60, zh: "圆号", en: "French Horn" },
  { id: 61, zh: "铜管组", en: "Brass Section" },
  { id: 62, zh: "合成铜管1", en: "Synth Brass 1" },
  { id: 63, zh: "合成铜管2", en: "Synth Brass 2" },
  { id: 64, zh: "高音萨克斯", en: "Soprano Sax" },
  { id: 65, zh: "中音萨克斯", en: "Alto Sax" },
  { id: 66, zh: "次中音萨克斯", en: "Tenor Sax" },
  { id: 67, zh: "上低音萨克斯", en: "Baritone Sax" },
  { id: 68, zh: "双簧管", en: "Oboe" },
  { id: 69, zh: "英国管", en: "English Horn" },
  { id: 70, zh: "巴松", en: "Bassoon" },
  { id: 71, zh: "单簧管", en: "Clarinet" },
  { id: 72, zh: "短笛", en: "Piccolo" },
  { id: 73, zh: "长笛", en: "Flute" },
  { id: 74, zh: "竖笛", en: "Recorder" },
  { id: 75, zh: "排笛", en: "Pan Flute" },
  { id: 76, zh: "瓶笛", en: "Blown Bottle" },
  { id: 77, zh: "尺八", en: "Shakuhachi" },
  { id: 78, zh: "口哨", en: "Whistle" },
  { id: 79, zh: "陶笛", en: "Ocarina" },
  { id: 80, zh: "合成主音1 (方波)", en: "Lead 1 (square)" },
  { id: 81, zh: "合成主音2 (锯齿波)", en: "Lead 2 (sawtooth)" },
  { id: 82, zh: "合成主音3 (汽笛)", en: "Lead 3 (calliope)" },
  { id: 83, zh: "合成主音4 (纯音)", en: "Lead 4 (chiff)" },
  { id: 84, zh: "合成主音5 (电吉他)", en: "Lead 5 (charang)" },
  { id: 85, zh: "合成主音6 (人声)", en: "Lead 6 (voice)" },
  { id: 86, zh: "合成主音7 (五度)", en: "Lead 7 (fifths)" },
  { id: 87, zh: "合成主音8 (贝司加主音)", en: "Lead 8 (bass + lead)" },
  { id: 88, zh: "合成音垫1 (新世纪)", en: "Pad 1 (new age)" },
  { id: 89, zh: "合成音垫2 (温暖)", en: "Pad 2 (warm)" },
  { id: 90, zh: "合成音垫3 (复音)", en: "Pad 3 (polysynth)" },
  { id: 91, zh: "合成音垫4 (合唱)", en: "Pad 4 (choir)" },
  { id: 92, zh: "合成音垫5 (弓弦)", en: "Pad 5 (bowed)" },
  { id: 93, zh: "合成音垫6 (金属)", en: "Pad 6 (metallic)" },
  { id: 94, zh: "合成音垫7 (光环)", en: "Pad 7 (halo)" },
  { id: 95, zh: "合成音垫8 (扫频)", en: "Pad 8 (sweep)" },
  { id: 96, zh: "合成效果1 (雨)", en: "FX 1 (rain)" },
  { id: 97, zh: "合成效果2 (音轨)", en: "FX 2 (soundtrack)" },
  { id: 98, zh: "合成效果3 (水晶)", en: "FX 3 (crystal)" },
  { id: 99, zh: "合成效果4 (大气)", en: "FX 4 (atmosphere)" },
  { id: 100, zh: "合成效果5 (明亮)", en: "FX 5 (brightness)" },
  { id: 101, zh: "合成效果6 (小精灵)", en: "FX 6 (goblins)" },
  { id: 102, zh: "合成效果7 (回声)", en: "FX 7 (echoes)" },
  { id: 103, zh: "合成效果8 (科幻)", en: "FX 8 (sci-fi)" },
  { id: 104, zh: "西塔琴", en: "Sitar" },
  { id: 105, zh: "班卓琴", en: "Banjo" },
  { id: 106, zh: "三味线", en: "Shamisen" },
  { id: 107, zh: "琴", en: "Koto" },
  { id: 108, zh: "卡林巴", en: "Kalimba" },
  { id: 109, zh: "风笛", en: "Bagpipe" },
  { id: 110, zh: "提琴", en: "Fiddle" },
  { id: 111, zh: "山奈", en: "Shanai" },
  { id: 112, zh: "铃铛", en: "Tinkle Bell" },
  { id: 113, zh: "阿果果", en: "Agogo" },
  { id: 114, zh: "钢鼓", en: "Steel Drums" },
  { id: 115, zh: "木鱼", en: "Woodblock" },
  { id: 116, zh: "太鼓", en: "Taiko Drum" },
  { id: 117, zh: "旋律鼓", en: "Melodic Tom" },
  { id: 118, zh: "合成鼓", en: "Synth Drum" },
  { id: 119, zh: "镲片反转", en: "Reverse Cymbal" },
  { id: 120, zh: "吉他噪音", en: "Guitar Fret Noise" },
  { id: 121, zh: "呼吸声", en: "Breath Noise" },
  { id: 122, zh: "海浪", en: "Seashore" },
  { id: 123, zh: "鸟鸣", en: "Bird Tweet" },
  { id: 124, zh: "电话铃", en: "Telephone Ring" },
  { id: 125, zh: "直升机", en: "Helicopter" },
  { id: 126, zh: "掌声", en: "Applause" },
  { id: 127, zh: "枪声", en: "Gunshot" }
];

export default function TrackPanel({
  tracks, currentTrackId, onSelectTrack, onAddTrack, onDeleteTrack,
  onVolumeChange, onPanChange, onMuteToggle, onProgramChange,
  onColorChange, onCommentChange,
  onTrackReverbChange, onGroupChange,
  playNote, lang = 'zh',
}) {
  const [instPanel, setInstPanel] = useState(null);
  const [instSearch, setInstSearch] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [commentEdit, setCommentEdit] = useState(null);
  const clipboard = useRef(null);
  const t = useTranslation(lang);

  const filtered = instPanel ? GM_INSTRUMENTS.filter(i => {
    if (!instSearch) return true;
    const q = instSearch.toLowerCase();
    return i.id.toString() === q || i.zh.includes(q) || i.en.toLowerCase().includes(q);
  }) : [];

  const handlePreview = (e, prog) => {
    e.stopPropagation();
    if (previewId === prog) { setPreviewId(null); return; }
    setPreviewId(prog);
    playNote('C4', 0.5, 90, prog);
    setTimeout(() => setPreviewId(null), 500);
  };

  const closeInstPanel = () => { setInstPanel(null); setInstSearch(''); };

  return (
    <div style={{ width: 260, flexShrink: 0, flexDirection: 'column', background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', display: 'flex' }}>
      {/* 头部 */}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t.tracks}</span>
        <button onClick={onAddTrack} style={{ padding: '2px 6px' }}><Icons.Plus /></button>
      </div>

      {/* 轨道列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tracks.map(track => {
          const isSel = track.id === currentTrackId;
          const color = track.color || '#888';
          const groupTint = track.group ? GROUP_TINTS[track.group] : undefined;
          return (
            <div key={track.id} onContextMenu={(e) => {
              e.preventDefault();
              onSelectTrack(track.id);
              setCtxMenu({ id: track.id, x: e.clientX, y: e.clientY });
            }}>
              <div onClick={() => onSelectTrack(track.id)} style={{
                background: groupTint || (isSel ? 'var(--track-hover)' : 'var(--track-bg)'),
                padding: 6, borderRadius: 6,
                borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: isSel ? 'var(--text-muted)' : 'var(--border)',
                borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: isSel ? 'var(--text-muted)' : 'var(--border)',
                borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: isSel ? 'var(--text-muted)' : 'var(--border)',
                borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: color, cursor: 'pointer',
              }}>
                {/* 名称行 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {track.group && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 16, height: 16, borderRadius: 3,
                        background: GROUP_TINTS[track.group], border: '1px solid var(--border)',
                        fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)',
                      }}>{track.group}</span>
                    )}
                    <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>{track.name || `Track ${track.id}`}</span>
                  </div>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>P{track.program}</span>
                </div>
                {/* 控制行 */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Icons.Volume />
                  <input type="range" min="0" max="100" value={track.volume || 80} onChange={e => { e.stopPropagation(); onVolumeChange(track.id, parseInt(e.target.value)); }} style={{ width: 40 }} />
                  <button onClick={e => { e.stopPropagation(); onMuteToggle(track.id); }} style={{ padding: '2px 4px', background: 'none' }}>
                    {track.mute ? <Icons.Mute /> : <Icons.Unmute />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); setInstPanel(track.id); setInstSearch(''); }} style={{ padding: '2px 4px', background: 'none' }} title={t.instrument}>
                    <Icons.Note />
                  </button>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', width: 28, textAlign: 'center' }}>R</span>
                  <input type="range" min="0" max="100" value={track.reverb || 0} onChange={e => { e.stopPropagation(); onTrackReverbChange && onTrackReverbChange(track.id, parseInt(e.target.value)); }} style={{ width: 30 }} />
                  {track.comment && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginLeft: 'auto', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.comment}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 音轨右键菜单 */}
      {ctxMenu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }}>
          <div style={{
            position: 'fixed', top: Math.min(ctxMenu.y, window.innerHeight - 200), left: Math.min(ctxMenu.x, window.innerWidth - 180),
            background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 4, zIndex: 1000,
            minWidth: 150, boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          }} onClick={e => e.stopPropagation()}>
            <button onClick={() => { setInstPanel(ctxMenu.id); setInstSearch(''); setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>
              <Icons.Note /> {lang === 'zh' ? '替换乐器' : 'Change Instrument'}
            </button>
            <button onClick={() => { setCommentEdit(ctxMenu.id); setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>
              {lang === 'zh' ? '更改注释' : 'Edit Comment'}
            </button>
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
            <button onClick={() => { const t = tracks.find(t => t.id === ctxMenu.id); if (t) clipboard.current = { track: { ...t, notes: Array.isArray(t.notes) ? t.notes.map(n => ({ ...n })) : [] }, cut: false }; setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>
              {lang === 'zh' ? '复制轨道' : 'Copy Track'}
            </button>
            <button onClick={() => { const t = tracks.find(t => t.id === ctxMenu.id); if (t) clipboard.current = { track: { ...t, notes: Array.isArray(t.notes) ? t.notes.map(n => ({ ...n })) : [] }, cut: true }; onDeleteTrack(ctxMenu.id); setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>
              {lang === 'zh' ? '剪切轨道' : 'Cut Track'}
            </button>
            {clipboard.current && (
              <button onClick={() => { if (clipboard.current) { const t = clipboard.current.track; onAddTrack(); if (clipboard.current.cut) clipboard.current = null; } setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--text)' }}>
                {lang === 'zh' ? '粘贴轨道' : 'Paste Track'}
              </button>
            )}
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', padding: '4px 8px' }}>{lang === 'zh' ? '添加到组' : 'Add to Group'}</div>
            <div style={{ display: 'flex', gap: 3, padding: '0 8px 4px' }}>
              {GROUP_NAMES.map(g => (
                <button key={g} onClick={() => { onGroupChange && onGroupChange(ctxMenu.id, g); setCtxMenu(null); }} style={{
                  padding: '2px 8px', fontSize: '0.7rem', borderRadius: 3, cursor: 'pointer',
                  background: tracks.find(t => t.id === ctxMenu.id)?.group === g ? 'var(--text-muted)' : 'var(--track-bg)',
                  border: '1px solid var(--border)', color: 'var(--text)',
                }}>{g}</button>
              ))}
              <button onClick={() => { onGroupChange && onGroupChange(ctxMenu.id, ''); setCtxMenu(null); }} style={{
                padding: '2px 6px', fontSize: '0.65rem', borderRadius: 3, cursor: 'pointer',
                background: 'var(--track-bg)', border: '1px solid var(--border)', color: 'var(--text)',
              }}>{lang === 'zh' ? '无' : 'None'}</button>
            </div>
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', padding: '4px 8px' }}>{lang === 'zh' ? '颜色' : 'Color'}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '0 8px 4px' }}>
              {TRACK_COLORS.map(c => (
                <div key={c} onClick={() => { onColorChange(ctxMenu.id, c); setCtxMenu(null); }} style={{
                  width: 18, height: 18, borderRadius: 4, background: c, cursor: 'pointer',
                  border: tracks.find(t => t.id === ctxMenu.id)?.color === c ? '2px solid #fff' : '1px solid var(--border)',
                }} />
              ))}
            </div>
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
            <button onClick={() => { if (tracks.length > 1) { onDeleteTrack(ctxMenu.id); } setCtxMenu(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 3, padding: '5px 8px', fontSize: '0.72rem', color: 'var(--danger)' }}>
              <Icons.Trash /> {lang === 'zh' ? '删除轨道' : 'Delete Track'}
            </button>
          </div>
        </div>
      )}

      {/* 注释编辑 */}
      {commentEdit && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={() => setCommentEdit(null)}>
          <div style={{ background: 'var(--panel)', padding: 16, borderRadius: 8, border: '1px solid var(--border)', minWidth: 260 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '0.85rem', marginBottom: 8 }}>{lang === 'zh' ? '编辑注释' : 'Edit Comment'}</div>
            <input type="text" defaultValue={tracks.find(t => t.id === commentEdit)?.comment || ''} autoFocus
              style={{ width: '100%', marginBottom: 10 }}
              onKeyDown={e => { if (e.key === 'Enter') { onCommentChange(commentEdit, e.target.value); setCommentEdit(null); } if (e.key === 'Escape') setCommentEdit(null); }} />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button onClick={() => setCommentEdit(null)}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
              <button className="primary" onClick={() => { const input = document.querySelector('input[autofocus]'); onCommentChange(commentEdit, input?.value || ''); setCommentEdit(null); }}>
                {lang === 'zh' ? '确定' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 乐器选择侧栏 */}
      {instPanel !== null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }} onClick={closeInstPanel} />
          <div style={{ width: 280, maxWidth: '90vw', height: '100%', background: 'var(--panel)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontSize: '0.9rem' }}>{t.instrument}</span>
              <button onClick={closeInstPanel} style={{ background: 'none', padding: 4 }}><Icons.Close /></button>
            </div>
            <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
              <input type="text" value={instSearch} onChange={e => setInstSearch(e.target.value)} placeholder={t.searchInstrument}
                style={{ width: '100%', fontSize: '0.75rem' }} />
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
              {filtered.map(inst => {
                const track = tracks.find(t => t.id === instPanel);
                const isCur = track?.program === inst.id;
                return (
                  <div key={inst.id} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 8px', background: isCur ? 'var(--track-hover)' : 'transparent',
                    borderRadius: 4, cursor: 'pointer', fontSize: '0.72rem',
                    border: isCur ? '1px solid var(--text-muted)' : '1px solid transparent',
                  }} onClick={() => { onProgramChange(instPanel, inst.id); closeInstPanel(); }}>
                    <span style={{ flex: 1 }}><strong>{inst.id}</strong>: {inst.zh} / {inst.en}</span>
                    <button onClick={e => handlePreview(e, inst.id)} style={{ padding: '2px 6px', fontSize: '0.65rem', background: previewId === inst.id ? 'var(--accent-hover)' : undefined }}>
                      {t.preview}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}