#!/bin/bash
# 下载内置 SF2 文件（FluidR3_GM，148MB）
# 仅桌面端使用，网页端用户自己加载
#
# v16：osuosl 源已 404（v12 时还活着，两天后死了）——改为
# pianobooster/fluid-soundfont 的 GitHub Release（权威镜像，CI runner
# 到 GitHub CDN 内网直连、速度快），osuosl 保留为后备源（若恢复可用）。

set -e

SF2_DIR="desktop/src-tauri/resources"
SF2_FILE="$SF2_DIR/FluidR3_GM.sf2"

# 依次尝试的源（第一个成功即用）
SF2_URLS=(
  "https://github.com/pianobooster/fluid-soundfont/releases/download/v3.1/FluidR3_GM.sf2"
  "https://ftp.osuosl.org/pub/musescore/soundfont/FluidR3_GM.sf2"
)

mkdir -p "$SF2_DIR"

if [ -f "$SF2_FILE" ]; then
  echo "SF2 already exists: $SF2_FILE ($(du -h "$SF2_FILE" | cut -f1))"
  exit 0
fi

ok=0
for url in "${SF2_URLS[@]}"; do
  echo "Downloading FluidR3_GM.sf2 from $url ..."
  # --retry 重试 + 先写 .tmp 再 mv（半截文件不会污染已存在判定）
  # --fail 让 HTTP 4xx/5xx 直接报错而非存下错误页
  if curl -L --fail --retry 5 --retry-delay 5 --connect-timeout 30 \
       --retry-all-errors -o "$SF2_FILE.tmp" "$url"; then
    mv "$SF2_FILE.tmp" "$SF2_FILE"
    echo "Downloaded: $SF2_FILE ($(du -h "$SF2_FILE" | cut -f1))"
    ok=1
    break
  fi
  echo "Source failed: $url, trying next..."
  rm -f "$SF2_FILE.tmp"
done

if [ "$ok" -ne 1 ]; then
  echo "All sources failed. Please download FluidR3_GM.sf2 manually into $SF2_FILE"
  exit 1
fi
