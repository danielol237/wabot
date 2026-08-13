# ARIA WhatsApp Bot — portable container image for PaaS hosts
# (Bot-Hosting, Clustr, BotForge, Monkey Network via Docker, VPS with Docker)
#
# Builds a lean image. Run with:
#   docker build -t aria .
#   docker run -p 3001:3001 --env-file .env aria
#
# Set these at runtime via the host's env-vars panel (NOT baked into the image):
#   BOT_PREFIX, OWNER_NUMBER, DASHBOARD_PASSWORD,
#   one of CEREBRAS_API_KEY / GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY

# Use Node 20 LTS slim — small footprint (matters on 256–512MB free tiers).
FROM node:20-slim

# Runtime tools ARIA needs (media/anime). ffmpeg/ffprobe merge and validate media;
# yt-dlp resolves and downloads HLS/MP4 sources; python3 supports voice/sandbox helpers.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
    && pip3 install --break-system-packages --no-cache-dir yt-dlp \
    && command -v yt-dlp >/dev/null \
    && command -v ffprobe >/dev/null \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching). Include scripts so sharp/etc. build.
COPY package*.json ./
RUN npm install --omit=dev

# Copy source (exclude node_modules, sessions, temp via .dockerignore).
COPY . .

# ARIA respects PORT (defaults to 3001) and binds via index.js.
ENV PORT=3001
EXPOSE 3001

# Health: / is ARIA's public site; also serves QR at /qr. Start via npm start.
CMD ["node", "src/index.js"]
