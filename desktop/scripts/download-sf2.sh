#!/bin/bash
# 下载内置 SF2 文件（FluidR3_GM，25MB）
# 仅桌面端使用，网页端用户自己加载

set -e

SF2_DIR="desktop/src-tauri/resources"
SF2_FILE="$SF2_DIR/FluidR3_GM.sf2"
SF2_URL="https://ftp.osuosl.org/pub/musescore/soundfont/FluidR3_GM.sf2"

mkdir -p "$SF2_DIR"

if [ -f "$SF2_FILE" ]; then
  echo "SF2 already exists: $SF2_FILE ($(du -h $SF2_FILE | cut -f1))"
  exit 0
fi

echo "Downloading FluidR3_GM.sf2 from $SF2_URL ..."
# v16：--retry 重试 + 先写 .tmp 再 mv（半截文件不会污染缓存判定）+
#      --fail 让 HTTP 4xx/5xx 直接报错而非存下错误页
curl -L --fail --retry 5 --retry-delay 5 --connect-timeout 30 \
  --retry-all-errors -o "$SF2_FILE.tmp" "$SF2_URL" \
&& mv "$SF2_FILE.tmp" "$SF2_FILE"

if [ $? -eq 0 ]; then
  echo "Downloaded: $SF2_FILE ($(du -h $SF2_FILE | cut -f1))"
else
  rm -f "$SF2_FILE.tmp"
  echo "Download failed. Please download manually from $SF2_URL"
  exit 1
fi
