# Arvgrid CLI

AI agent 友好的 MIDI 编曲工具，输出 arvgrid v3 工程格式。

## 安装

```bash
cd cli
npm install
```

## 用法

```bash
# 预设风格
node bin/arvgrid.js --preset piano-ballad > song.json

# 自定义参数
node bin/arvgrid.js --bpm 128 --key Am --mood dark > song.json

# AI agent stdin 模式
echo '{"bpm":120,"key":"C"}' | node bin/arvgrid.js > song.json
```

## 预设

| 名称 | BPM | 调性 | 情绪 | 轨道 |
|------|-----|------|------|------|
| piano-ballad | 72 | Am | sad | 钢琴+弦乐 |
| electronic | 128 | Cm | epic | 合成器+鼓 |
| rock | 120 | E | epic | 吉他+贝斯+鼓 |
| jazz | 100 | Dm | chill | 钢琴+贝斯+鼓 |
| ambient | 60 | C | chill | 铺底+钟 |

## 输出格式

arvgrid v3 JSON，可直接在 arvgrid 网页端/桌面端"导入工程"使用。

## AI Agent 集成

```python
import subprocess, json

# 生成一首歌
result = subprocess.run(
    ['node', 'bin/arvgrid.js', '--preset', 'piano-ballad'],
    capture_output=True, text=True
)
project = json.loads(result.stdout)

# 修改
project['meta']['title'] = 'My Song'
project['bpm'] = 90

# 重新生成
with open('song.json', 'w') as f:
    json.dump(project, f)
```
