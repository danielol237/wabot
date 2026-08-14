# ARIA — WhatsApp AI Bot (Baileys Edition)

Built in **JavaScript / Node.js**. Uses `@whiskeysockets/baileys` — no Chrome, no Puppeteer, no browser needed. Connects directly to WhatsApp's servers.

## Quick Setup

```bash
npm install
cp .env.example .env
# add your GROQ_API_KEY (or Cerebras/Gemini) in .env
npm run dev
```

Pair WhatsApp from the owner dashboard. Open `/dashboard`, sign in with `DASHBOARD_PASSWORD`, then choose **Pair WhatsApp**. The protected `/qr` screen shows either the QR or the phone-number pairing code; pairing is still available without exposing the credential to public visitors.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes (or Cerebras/Gemini) | AI provider for chat + transcriptions |
| `CEREBRAS_API_KEY` | No | 1M tokens/day free — highest free ceiling |
| `GEMINI_API_KEY` | No | 1,500 req/day, 1M context |
| `OPENROUTER_API_KEY` | No | Fallback AI |
| `TAVILY_API_KEY` | No | Web search |
| `OWNER_NUMBER` | No | Your phone number (no +). Sets you as bot owner. |
| `DASHBOARD_PASSWORD` | No | Password for web dashboard |
| `ELEVENLABS_API_KEY` | No | Text-to-speech voice responses |
| `BOT_NAME` | No | Bot name trigger (default: aria) |
| `BOT_PREFIX` | No | Command prefix (default: !) |
| `BASE_URL` | Required for Google sign-in | Public origin with no trailing slash, for example `https://wabot-ytal.onrender.com` |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `PORTAL_SESSION_SECRET` | Recommended | Long random signing secret for learner sessions |
| `MEDIA_PROXY_SECRET` | Required for browser playback/download links | Long random secret for expiring media capabilities |
| `SESSION_ENCRYPT_KEY` | Required for Git-backed session backup | Dedicated random key of at least 32 characters |
| `ANIME_WHATSAPP_MAX_MB` | No | WhatsApp delivery ceiling; default 150 MB |
| `MEDIA_ALLOWED_HOSTS` | No | Comma-separated HTTPS provider host allowlist |
| `YTDLP_VERSION` | No | Pinned yt-dlp version; default `2026.7.4` |
| `YTDLP_EJS_VERSION` | No | Pinned yt-dlp JavaScript solver package; default `0.8.0` |
| `ANIME_PUBLIC_DOWNLOADS_PER_HOUR` | No | Anonymous browser download quota; default 10 per client IP |
| `ANIME_PUBLIC_ACTIVE_LIMIT` | No | Maximum active public jobs per client; default 3 |
| `ANIME_PUBLIC_QUEUE_LIMIT` | No | Global public queue ceiling; default 100 |
| `ARIA_HUMANIZER_TYPOS` | No | Opt-in presentation experiment; default `false` |
| `ARIA_HUMANIZER_DELAY` | No | Opt-in short response delay experiment; default `false` |
| `ARIA_RANDOM_MOOD` | No | Opt-in random mood variation; default `false` |
| `PHONE_NUMBER` | No | If set, enables pairing-code mode instead of QR |

## Features

### 🤖 AI Chat
Talk naturally — mention "aria" or just send a message. Falls back through Cerebras → Gemini → Groq → OpenRouter if one fails. ARIA’s personality is direct and expressive, but she stays honest about being an AI companion and does not use manipulation or abusive low blows as a substitute for personality.

### 🎤 Voice Conversation
Send a voice note → ARIA transcribes it (Groq Whisper) → AI thinks → replies with audio (ElevenLabs/FreeTTS). Full spoken conversation.

### 🦎 Pokémon System
- `!starters` — choose your first Pokémon
- `!hunt` — find wild Pokémon
- `!battle @user` — battle another trainer
- `!catch` — throw a Pokéball
- `!trade` — trade Pokémon
- `!evolve` — evolve your Pokémon
- `!daily` — claim daily rewards
- `!raid` — raid battles
- `!gmax` — Gigantamax
- `!mega` — Mega Evolution
- Plus: IV/EV system, abilities, held items, breeding, Elite Four

#### 🌿 Auto-Spawns (Owner Only)
`!pspawn` — control global wild spawn rate:
- `!pspawn` — show status
- `!pspawn set 20` — set daily spawns (0-100)
- `!pspawn reset` — reset to default
- `!pspawn disable/enable` — pause/resume

Spawns happen automatically across all chats. Rarity tiers: Common → Uncommon → Rare → Super Rare → Legendary → Mythical. Time-of-day type bonuses. Shiny chance.

### 🎮 Games
`!joke`, `!truth`, `!dare`, `!roast`, `!ship`, `!ttt`, `!dice`, `!card`, `!flip`, `!balance`, `!inventory`, `!leaderboard`

### 🛠️ Development Tools (Owner Only)
These execute code or write files on the server, so they're restricted to `OWNER_NUMBER`:
`!run js/py/sh <code>` — execute code
`!build <app description>` — AI builds full apps
`!edit <file> <instruction>` — edit project files
`!agent <task>` — multi-step AI agent
`!job create <task>` — background AI job
`!evolve` / `!selfcheck` — self-improvement engine

Other dev commands open to everyone: `!remember`, `!preferences`, `!learn`, `!facts`, and `!memories`. Use `!memory on|off|export|forget <id>|clear` to control ARIA’s semantic memory. Memory capture is transparent, and clearing it removes the stored semantic memories and learned companion profile.

### 🌐 Web surfaces
The public root opens the catalog at `/anime`. Browse/search remain login-free; watch and download links are short-lived signed capabilities. The learner portal is at `/portal/login`, and the owner dashboard is at `/dashboard`.

When the bot is running, open `https://your-public-origin/dashboard` in your browser.

The dashboard requires `DASHBOARD_PASSWORD` in `.env`. The QR pairing screen is intentionally protected by the same owner session; it is not removed.

**Dashboard pages:**
- `/dashboard` — live stats (uptime, messages, spawns, errors)
- `/dashboard/spawns` — set spawn rate, pause/resume, see timing
- `/dashboard/trainers` — view all Pokémon trainers
- `/dashboard/logs` — error log viewer
- `/dashboard/admin` — manage admins, broadcast, config status
- `/qr` — protected WhatsApp QR or pairing-code screen
- `/portal/login` — learner email/password and Google sign-in
- `/anime` — public catalog, watch, and download pages

### 🔧 Other Commands
`!search`, `!weather`, `!translate`, `!news`, `!lyrics`, `!sticker`, `!carbon`, `!wallpaper`, `!anime`, `!episodes`, `!trending`, `!remind`, `!poll`, `!say` (TTS), `!kick`, `!promote`, `!tagall`, `!warn`, `!clear`, `!remember`

### 🎬 Anime Downloads — runtime requirements
Anime downloads (`!animedl`, the web browser) depend on two things that are
**not npm packages**, so they must exist on the host:

- **Node 22**, **`yt-dlp`**, **`yt-dlp-ejs`**, **`ffmpeg`**, and **`ffprobe`** — used to solve current JavaScript challenges, download, merge, validate, and deliver the final video. The production Dockerfile pins and verifies them; Render deployments must use that Dockerfile or run `build.sh` with the same Node 22 baseline. If one is missing, ARIA logs a clear error
  at startup and the download step reports `DOWNLOAD_FAILED` instead of silently
  breaking. Providers like OmniSave return direct MP4 URLs and Gogo/AnimePahe
  return HLS `.m3u8` — both go through yt-dlp.
- **`VERCEL_TOKEN`** (optional) — only needed if you want `!build` to auto-deploy
  a live preview to Vercel. Set it in the host env to enable; omit it and builds
  still work, they just skip the deploy step.

## Running on Phone (Termux)

```bash
pkg install nodejs git -y
git clone https://github.com/danielol237/wabot
cd wabot
npm install
cp .env.example .env
# edit .env with nano
npm run dev
```

Use `termux-wake-lock` to prevent Android from killing the process.

## One-Click VPS Deploy

On any fresh Ubuntu/Debian VPS, run as root:
```bash
curl -sSL https://raw.githubusercontent.com/danielol237/wabot/main/deploy.sh | bash
```
Installs Node 22 LTS, clones the repo, installs deps, sets up PM2, and prints the QR/dashboard URL. Then edit `/opt/wabot/.env` and `pm2 restart aria`.

## Running on Server

```bash
git clone https://github.com/danielol237/wabot
cd wabot
npm install
cp .env.example .env
# configure .env
npm start
```

For production, use PM2:
```bash
npm install -g pm2
pm2 start src/index.js --name aria
pm2 save
pm2 startup
```

## Scheduled & Recurring Messages
`!schedule`/`!remind` messages are persisted to `data/schedules.json` and re-armed automatically on restart, so they survive redeploys. For persistent production operation, use Render/Docker/PM2 or another always-on host; the default sandbox is not a production scheduler.
