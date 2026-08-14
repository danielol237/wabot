#!/bin/bash
# Render build script for the Node buildpack. The runtime uses yt-dlp with the
# Node 22 JavaScript challenge solver; no browser automation dependency is used.
set -euo pipefail

YTDLP_VERSION="${YTDLP_VERSION:-2026.7.4}"
YTDLP_EJS_VERSION="${YTDLP_EJS_VERSION:-0.8.0}"

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "ERROR: ARIA requires Node 22+ for the yt-dlp JavaScript runtime; found $(node --version)." >&2
  exit 1
fi

echo "=== [build] npm ci ==="
npm ci

echo "=== [build] media tools (yt-dlp + matching EJS + ffmpeg) ==="
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq ffmpeg 2>/dev/null || true
fi

python3 -m pip install --break-system-packages --no-cache-dir -q \
  "yt-dlp==${YTDLP_VERSION}" "yt-dlp-ejs==${YTDLP_EJS_VERSION}" \
  || python3 -m pip install --no-cache-dir -q \
  "yt-dlp==${YTDLP_VERSION}" "yt-dlp-ejs==${YTDLP_EJS_VERSION}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "warn: ffmpeg not found — trying static build"
  curl -fsSL -o /tmp/ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
  tar -xJf /tmp/ffmpeg.tar.xz -C /tmp
  cp /tmp/ffmpeg-*/ffmpeg /tmp/ffmpeg-*/ffprobe /usr/local/bin/
fi

command -v yt-dlp >/dev/null
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
printf 'node: %s\n' "$(node --version)"
printf 'yt-dlp: %s\n' "$(yt-dlp --version)"
printf 'yt-dlp-ejs: %s\n' "$(python3 -c 'import yt_dlp_ejs; print("OK")')"
printf 'ffmpeg: %s\n' "$(ffmpeg -version | head -1)"
