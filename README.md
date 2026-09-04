# ARIA — WhatsApp AI Bot (Baileys Edition)

Built in **JavaScript / Node.js**. Uses `@whiskeysockets/baileys` — no Chrome, no Puppeteer, no browser needed. Connects directly to WhatsApp's servers.

## Quick Setup

```bash
npm install
cp .env.example .env
# add your GROQ_API_KEY (or Cerebras/Gemini) in .env
npm run dev
```

Pair WhatsApp from the owner dashboard. Open `/dashboard`, sign in with `DASHBOARD_PASSWORD`, then choose **Pair WhatsApp**. Enter the complete international number, select **Request WhatsApp code**, and enter the displayed one-time code in WhatsApp under **Linked devices → Link a device → Link with phone number instead**. The protected `/qr` screen remains available as a QR or legacy pairing-code fallback; pairing codes are kept in memory and are never written to logs or disk.

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
| `BOT_PREFIX` | No | Optional legacy command prefix; leave empty for natural-language-first mode |
| `BASE_URL` | Required for Google sign-in | Public origin with no trailing slash, for example `https://wabot-ytal.onrender.com` |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `PORTAL_SESSION_SECRET` | Recommended | Long random signing secret for learner sessions |
| `MEDIA_PROXY_SECRET` | Required for browser playback/download links | Long random secret for expiring media capabilities |
| `SESSION_GIT_REPO` | Required for Git-backed session backup | Private repository for encrypted WhatsApp session files, for example `danielol237/aria-whatsapp-session` |
| `SESSION_GITHUB_TOKEN` | Required for Git-backed session backup | Fine-grained GitHub token limited to **Contents: Read and write** on the private session repository only |
| `SESSION_ENCRYPT_KEY` | Required for Git-backed session backup | Dedicated random key of at least 32 characters; never reuse a GitHub token or commit it |
| `SESSION_SYNC_INTERVAL` | No | Session backup interval in seconds; default 60 and minimum 30 |
| `GITHUB_WEBHOOK_SECRET` | No | Optional HMAC secret for signed GitHub Sentinel deliveries |
| `RENDER_WEBHOOK_SECRET` | No | Optional Standard Webhooks signing secret for Render Sentinel deliveries |
| `ANIME_WHATSAPP_MAX_MB` | No | WhatsApp delivery ceiling; default 150 MB |
| `MEDIA_ALLOWED_HOSTS` | No | Comma-separated HTTPS provider host allowlist |
| `YTDLP_VERSION` | No | Pinned yt-dlp version; default `2026.7.4` |
| `YTDLP_EJS_VERSION` | No | Pinned yt-dlp JavaScript solver package; default `0.8.0` |
| `ANIME_PUBLIC_DOWNLOADS_PER_HOUR` | No | Anonymous browser download quota; default 10 per client IP |
| `ANIME_PUBLIC_ACTIVE_LIMIT` | No | Maximum active public jobs per client; default 3 |
| `ANIME_PUBLIC_QUEUE_LIMIT` | No | Global public queue ceiling; default 100 |
| `ARIA_HUMANIZER_TYPOS` | No | Opt-in presentation experiment; default `false` |
| `ARIA_RANDOM_MOOD` | No | Opt-in random mood variation; default `false` |
| `PHONE_NUMBER` | No | Optional unattended startup pairing number; dashboard phone-number pairing does not require this variable |

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
Ask ARIA for a joke, truth, dare, roast, ship calculation, tic-tac-toe, dice roll, coin flip, card draw, balance, inventory, or leaderboard. Legacy prefix forms remain compatible.

### 🛠️ Development Tools (Owner Only)
These execute code or write files on the server, so they remain restricted to `OWNER_NUMBER`. Ask ARIA naturally: “run this code”, “build me an app”, “edit this file”, “figure this out”, “delegate this mission”, “check your health”, or “improve this project”. Legacy prefix forms are still accepted during migration, but natural requests use the same authorization checks.

ARIA is conversational by default: ask naturally for help, research, builds, edits, missions, anime, reminders, links, or memory recall. Legacy prefix commands remain accepted for compatibility, but they are no longer required. Ask “what do you remember about me?” to inspect relevant companion memory; ARIA curates her own memory internally, with storage safeguards and retention limits handled by the application rather than user-facing toggle commands.

### 🌐 Web surfaces
The public root opens the catalog at `/anime`. Browse/search remain login-free; watch and download links are short-lived signed capabilities. The learner portal is at `/portal/login`, and the owner dashboard is at `/dashboard`.

### 🧭 ARIA Atlas — Project Brain
Atlas gives ARIA durable project workspaces instead of isolated one-off tasks. Say “ARIA, this is a project: launch the anime site by December,” “add this to Wabot,” “what is blocking us?”, “what is next?”, “record a decision,” “what evidence do we have?”, or “give me the project brief.” ARIA stores the project contract, tasks, milestones, evidence, decisions, mission links, and living timeline in owner-scoped atomic records under `data/atlas/`.

Atlas V3 adds **Sentinel**, an opt-in operating layer for project signals. It recognizes no-prefix requests such as “show Sentinel,” “what changed in the project,” “acknowledge signal signal_…,” “resolve signal signal_…,” and “approve brief brief_…”. Signed GitHub check, pull-request, deployment, and Render deploy events can become normalized evidence, scored risks, and reviewable decision briefs. Duplicate provider deliveries are ignored by stable delivery IDs, and unverified requests are rejected before reaching Atlas.

Atlas V4 makes integrations observable instead of treating **enabled** as **healthy**. Each mapped source now reports `healthy`, `attention`, `misconfigured`, `unconfigured`, or `disabled`, with safe reason codes such as `missing_secret`, `invalid_signature`, `raw_body_unavailable`, `awaiting_first_delivery`, and `delivery_accepted`. A bounded, redacted delivery ledger records status, provider, event, HTTP class, timing, and delivery ID without storing secrets or raw payloads. Ask “diagnose integrations,” “check the webhook connection,” or “show delivery diagnostics” in WhatsApp, or use **Diagnose connections** in the dashboard. **Test local verifier** checks the running HMAC/raw-body path only; it explicitly does not pretend that GitHub delivered a webhook or validate the provider-side secret.

Open `/dashboard/atlas` after owner login to see the Atlas cockpit. It shows workspaces, the North Star outcome, progress, Now/Next work, blockers, the roadmap, risk register, Sentinel signal feed, decision briefs, decision ledger, evidence vault, and recent activity. Atlas uses a balanced action policy: observation and preparation can proceed automatically, while deployments, external posts, permission changes, spending, deletion, and other commit actions require explicit approval. Approving a Sentinel brief records your approval; it does not silently commit code, deploy services, or post externally.

When the bot is running, open `https://your-public-origin/dashboard` in your browser.

#### Sentinel activation

Sentinel is disabled by default. Set `GITHUB_WEBHOOK_SECRET` and/or `RENDER_WEBHOOK_SECRET` in the host environment, open `/dashboard/atlas`, select a workspace, enter the matching GitHub `owner/repository` and/or Render service ID, and choose **Enable / save**. Configure the provider webhook to point to `/webhooks/atlas/github` or `/webhooks/atlas/render` on the bot’s public HTTPS origin. GitHub delivery signatures are checked with `X-Hub-Signature-256`; Render signatures and timestamps are checked using its Standard Webhooks format. If no external webhook is configured, the existing local monitor and mission loop still create Sentinel signals for repeated errors, provider outages, and stalled Atlas missions.

After a provider delivery, inspect the dashboard’s **Integration health** and **Recent deliveries** panels before changing secrets. A 401 is now retained as a redacted `invalid_signature` or related reason code. Change a webhook secret only in the provider and Render environment, wait for the service to deploy, then redeliver the provider test. Consequential recovery actions remain approval-gated; Atlas can diagnose and propose a repair but does not rotate credentials, edit GitHub settings, or redeploy by itself.

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

### 🔧 Natural requests
Say “search the web for…”, “what’s the weather in…”, “translate this…”, “find the latest news about…”, “make this a sticker”, “show me anime…”, “remind me…”, “create a poll”, “say this out loud”, “kick this member”, “promote this member”, or “remember that I prefer…”. ARIA resolves the request without a prefix. Legacy forms such as `!search` still work during migration.

### 🎬 Anime Downloads — runtime requirements
Anime downloads (natural anime requests and the web browser) depend on two things that are
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
Natural reminder and schedule requests are persisted to `data/schedules.json` and re-armed automatically on restart, so they survive redeploys. Legacy prefix forms remain compatible. For persistent production operation, use Render/Docker/PM2 or another always-on host; the default sandbox is not a production scheduler.
