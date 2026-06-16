# 🤖 ARIA — Peak WhatsApp AI Bot

A full-featured WhatsApp AI bot powered by Groq + whatsapp-web.js.

## Features
- 🧠 AI chat with memory (Groq / OpenRouter)
- 🎨 Free image generation (Pollinations.ai)
- 🔍 Web search (DuckDuckGo, no API key)
- 📥 Media downloader (YouTube, TikTok, Instagram, etc.)
- ⚙️ Code runner (JS, Python, Bash)
- 🕷️ Website scraper/reader
- ⏰ Reminders with natural time parsing
- 📊 File analysis (PDF, DOCX, CSV, TXT)

---

## Setup

### 1. Clone & install
```bash
git clone <your-repo>
cd wabot
npm install
```

### 2. Create .env file
```bash
cp .env.example .env
```
Then fill in:
```
GROQ_API_KEY=your_key_here
```
Get a free Groq key at: https://console.groq.com

### 3. Install yt-dlp (for downloads)
```bash
# Windows
winget install yt-dlp

# Linux/Mac
pip install yt-dlp
```

### 4. Run locally
```bash
npm run dev
```
Scan the QR code with WhatsApp on your phone.

---

## Deploy to Railway

1. Push code to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Done — Railway handles the rest via nixpacks.toml

> ⚠️ First deploy: check logs for QR code, scan once, then session is saved permanently.

---

## Commands

| Command | Description |
|---|---|
| `!imagine [prompt]` | Generate an image |
| `!search [query]` | Search the web |
| `!dl [url]` | Download video/audio |
| `!run js` + code | Run JavaScript |
| `!run py` + code | Run Python |
| `!scrape [url]` | Read any website |
| `!remind 10m message` | Set a reminder |
| `!clear` | Reset conversation memory |
| `!help` | Show this menu |
| *(any message)* | Chat with AI |
| *(send a file)* | Analyze file |

---

## Project Structure
```
wabot/
├── src/
│   ├── index.js              # Entry point
│   ├── handlers/
│   │   └── messageHandler.js # Routes all messages
│   ├── tools/
│   │   ├── ai.js             # Groq/OpenRouter AI
│   │   ├── webSearch.js      # DuckDuckGo search
│   │   ├── imageGen.js       # Pollinations.ai
│   │   ├── downloader.js     # yt-dlp wrapper
│   │   ├── codeRunner.js     # JS/Python sandbox
│   │   ├── scraper.js        # Website reader
│   │   ├── reminders.js      # Timed reminders
│   │   └── fileAnalyzer.js   # PDF/DOCX/CSV reader
│   └── utils/
│       ├── memory.js         # Conversation history
│       └── helpers.js        # Reply/react helpers
├── sessions/                 # WA auth (auto-created)
├── temp/                     # Temp files (auto-created)
├── .env                      # Your keys
├── railway.json              # Railway config
└── nixpacks.toml             # System deps for Railway
```
