# ARIA — Hosting / Deploy Guide

This is the single reference for putting ARIA on a free/cheap always-on host.
She is a Node.js WhatsApp bot (`baileys`) with an embedded HTTP server + JSON
file storage. She must run **24/7 with a persistent WebSocket** — so any host
that "sleeps on idle" (Render, Bonto, Replit) is a non-starter.

## Deploy files included in the repo
| File | Purpose | When to use |
|------|---------|-------------|
| `Dockerfile` | Container image | Docker-capable hosts (BotForge, VPS, Clustr-Docker) |
| `Procfile` | Process definition | Buildpack-style panels (Bot-Hosting) |
| `start.sh` | Start wrapper + heap cap | Panels needing a manual start command |
| `deploy.sh` | One-click Ubuntu VPS setup | Any real VPS (Oracle, Hetzner, DigitalOcean) |
| `.env.example` | Required env vars | Everywhere |

## Required environment variables
Set these in the host's env-vars panel (never commit real values):
```
BOT_PREFIX=!
OWNER_NUMBER=<your whatsapp number, full format no +>
DASHBOARD_PASSWORD=<choose a strong one>
# one AI provider key (fallback chain: Cerebras > Gemini > Groq > OpenRouter)
CEREBRAS_API_KEY=   # or GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY
```

## Render deployment contract

For the existing Render service, set the build command to `bash build.sh`, the start command to `bash start.sh`, and the health check path to `/healthz`. The committed `render.yaml` records this contract for Blueprint-based deployments. The build script installs project-local `yt-dlp`, the matching JavaScript solver package, and `ffmpeg`/`ffprobe`, then fails the build if the runtime cannot be invoked. After deployment, check `/healthz?refresh=1`; `/healthz/live` is the lightweight process liveness check.

If `/healthz` returns `503`, the response identifies whether `yt-dlp`, `ffmpeg`, or `ffprobe` is unavailable. Do not treat a catalog page or an official-watch link as proof that download delivery is operational; download readiness requires the media runtime and a validated authorized source.

## Start command per host
- **Render**: build command `bash build.sh`; start command `bash start.sh`; health check `/healthz`.
- **Bot-Hosting** (buildpack): reads `Procfile` → `web: npm start`; or set start cmd to `bash start.sh`
- **Monkey Network / Quaxly / Clustr** (panel console): start command = `bash start.sh` (or `npm start`)
- **Docker host**: `docker build -t aria . && docker run -p 3001:3001 --env-file .env aria`

## After first boot
1. Watch the console — ARIA prints a **QR code** (or pairing code if `PHONE_NUMBER` set).
2. Open WhatsApp → **Linked Devices** → Link a device → scan the QR.
3. She's live. Her web UI/dashboard serves on the host's assigned URL/port.

## Persistence / sessions
- Her auth state lives in `sessions/`. Upload it to keep her logged in across restarts.
- Data lives in `data/` (JSON). On ephemeral containers, add a persistent volume
  for `data/` and `sessions/`, or she loses memory + login on redeploy.

## Known limits on free tiers
- **RAM**: ARIA idles ~150MB, spikes to ~500MB on media. `start.sh` caps Node at
  256MB so she degrades instead of OOM-killing the box on 256MB plans. Prefer
  hosts with ≥512MB (Monkey 2GB, Clustr/Quaxly/BotForge 512MB).
- **Docker/sandbox**: the code sandbox (`!code`) needs Docker. Some free panels
  lack it — `!code` will report "blocked" (safe default, not a crash).
- **Disk**: `node_modules` ~144MB. 512MB–2GB plans are fine; keep an eye on it.
