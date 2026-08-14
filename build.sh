#!/usr/bin/env bash
# Render build script for the Node buildpack.
# Keep media dependencies inside the deployed project so the runtime does not
# depend on a buildpack-specific Python PATH.
set -euo pipefail

YTDLP_VERSION="${YTDLP_VERSION:-2026.7.4}"
YTDLP_EJS_VERSION="${YTDLP_EJS_VERSION:-0.8.0}"
MEDIA_ROOT="${ARIA_MEDIA_RUNTIME_DIR:-$PWD/.render/media}"
MEDIA_BIN="$MEDIA_ROOT/bin"
MEDIA_PYTHON="$MEDIA_ROOT/python"
mkdir -p "$MEDIA_BIN" "$MEDIA_PYTHON"

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "ERROR: ARIA requires Node 22+ for the yt-dlp JavaScript runtime; found $(node --version)." >&2
  exit 1
fi

echo "=== [build] npm ci ==="
npm ci

echo "=== [build] media tools (project-local yt-dlp + matching EJS + ffmpeg) ==="
if ! command -v ffmpeg >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg >/dev/null 2>&1 || true
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "warn: ffmpeg not found — trying project-local static build"
  curl -fsSL -o /tmp/ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
  rm -rf /tmp/aria-ffmpeg
  mkdir -p /tmp/aria-ffmpeg
  tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/aria-ffmpeg --strip-components=1
  cp /tmp/aria-ffmpeg/ffmpeg "$MEDIA_BIN/ffmpeg"
  cp /tmp/aria-ffmpeg/ffprobe "$MEDIA_BIN/ffprobe"
  chmod +x "$MEDIA_BIN/ffmpeg" "$MEDIA_BIN/ffprobe"
fi

python3 -m pip install --target "$MEDIA_PYTHON" --break-system-packages --no-cache-dir -q \
  "yt-dlp==${YTDLP_VERSION}" "yt-dlp-ejs==${YTDLP_EJS_VERSION}" \
  || python3 -m pip install --target "$MEDIA_PYTHON" --no-cache-dir -q \
  "yt-dlp==${YTDLP_VERSION}" "yt-dlp-ejs==${YTDLP_EJS_VERSION}"

cat > "$MEDIA_BIN/yt-dlp" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONPATH="$ROOT/python${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m yt_dlp "$@"
WRAPPER
chmod +x "$MEDIA_BIN/yt-dlp"

export PATH="$MEDIA_BIN:$PATH"
export PYTHONPATH="$MEDIA_PYTHON${PYTHONPATH:+:$PYTHONPATH}"
command -v yt-dlp >/dev/null
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
printf 'node: %s\n' "$(node --version)"
printf 'yt-dlp: %s\n' "$(yt-dlp --version)"
printf 'yt-dlp-ejs: %s\n' "$(python3 -c 'import yt_dlp_ejs; print("OK")')"
printf 'ffmpeg: %s\n' "$(ffmpeg -version | head -1)"
