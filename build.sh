#!/bin/bash
# Render build script — installs everything ARIA needs at build time on Render's
# Node buildpack (which only runs `npm install` by default).
#
# Render runs this instead of the default. It:
#   1. installs npm deps
#   2. installs Puppeteer's Chrome (needed for browsing)
#   3. installs yt-dlp + yt-dlp-ejs + ffmpeg (needed for !play / !yt / !tiktok / !ig
#      — without yt-dlp-ejs, YouTube's "n challenge" makes format extraction fail
#      with "No video formats found", so downloads always error out)
set -e

echo "=== [build] npm install ==="
npm install

echo "=== [build] puppeteer chrome ==="
npx puppeteer browsers install chrome || echo "warn: puppeteer chrome install failed (non-fatal)"

echo "=== [build] media tools (yt-dlp + yt-dlp-ejs + ffmpeg) ==="
# ffmpeg via apt if we can (best on Render). Fall back to the static build.
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq ffmpeg yt-dlp 2>/dev/null || true
fi
if ! command -v yt-dlp >/dev/null 2>&1; then
  pip3 install --break-system-packages -q yt-dlp 2>/dev/null || pip3 install -q yt-dlp 2>/dev/null || true
fi
# The critical one — YouTube's "n challenge" solver. Without it, !play/!yt fail.
if ! python3 -c "import yt_dlp_ejs" >/dev/null 2>&1; then
  pip3 install --break-system-packages -q yt-dlp-ejs 2>/dev/null || pip3 install -q yt-dlp-ejs 2>/dev/null || true
fi
# Ensure ffmpeg exists (yt-dlp needs it to merge/convert).
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "warn: ffmpeg not found — trying static build"
  curl -fsSL -o /tmp/ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" 2>/dev/null \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp 2>/dev/null \
    && cp /tmp/ffmpeg-*/ffmpeg /tmp/ffmpeg-*/ffprobe /usr/local/bin/ 2>/dev/null || true
fi

echo "=== [build] done ==="
echo "yt-dlp: $(yt-dlp --version 2>/dev/null || echo MISSING)"
echo "yt-dlp-ejs: $(python3 -c 'import yt_dlp_ejs; print("OK")' 2>/dev/null || echo MISSING)"
echo "ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 || echo MISSING)"
