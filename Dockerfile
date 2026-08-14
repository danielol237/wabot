# ARIA WhatsApp Bot — portable container image for PaaS hosts.
# The image uses Node 22 because yt-dlp's JavaScript challenge solver requires a
# current Node runtime when Deno is not installed.
FROM node:22-slim

ARG YTDLP_VERSION=2026.7.4
ARG YTDLP_EJS_VERSION=0.8.0

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
    && pip3 install --break-system-packages --no-cache-dir \
      "yt-dlp==${YTDLP_VERSION}" \
      "yt-dlp-ejs==${YTDLP_EJS_VERSION}" \
    && command -v yt-dlp >/dev/null \
    && command -v ffmpeg >/dev/null \
    && command -v ffprobe >/dev/null \
    && node --version \
    && yt-dlp --version \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV PORT=3001
EXPOSE 3001
CMD ["node", "src/index.js"]
