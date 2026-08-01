# ARIA — WhatsApp AI Bot (Baileys Edition)

Built in **JavaScript / Node.js**. Uses `@whiskeysockets/baileys` — no Chrome, no Puppeteer, no browser needed. Connects directly to WhatsApp's servers.

## Quick Setup

```bash
npm install
cp .env.example .env
# add your GROQ_API_KEY (or Cerebras/Gemini) in .env
npm run dev
```

Scan the QR in terminal (or visit `/qr` in browser).

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

## Features

### 🤖 AI Chat
Talk naturally — mention "aria" or just send a message. Falls back through Cerebras → Gemini → Groq → OpenRouter if one fails. Fully unrestricted — no content filters.

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

### 🛠️ Development Tools
`!run js/py/sh <code>` — execute code
`!build <app description>` — AI builds full apps
`!edit <file> <instruction>` — edit project files
`!agent <task>` — multi-step AI agent
`!evolve` — self-improvement engine

### 🌐 Web Dashboard
When the bot is running, open `http://your-server-ip:3001/dashboard` in your browser.

Requires `DASHBOARD_PASSWORD` in .env.

**Dashboard pages:**
- `/dashboard` — live stats (uptime, messages, spawns, errors)
- `/dashboard/spawns` — set spawn rate, pause/resume, see timing
- `/dashboard/trainers` — view all Pokémon trainers
- `/dashboard/logs` — error log viewer
- `/dashboard/admin` — manage admins, broadcast, config status

### 🔧 Other Commands
`!search`, `!weather`, `!translate`, `!news`, `!lyrics`, `!sticker`, `!carbon`, `!wallpaper`, `!anime`, `!episodes`, `!trending`, `!remind`, `!poll`, `!say` (TTS), `!kick`, `!promote`, `!tagall`, `!warn`, `!clear`, `!remember`

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
