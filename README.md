# ARIA — WhatsApp AI Bot (Baileys Edition)

Built in **JavaScript / Node.js**. This version uses `@whiskeysockets/baileys` instead of `whatsapp-web.js` — meaning **no Chrome, no Puppeteer, no browser at all**. It connects directly to WhatsApp's servers, which fixes the Chrome version mismatch issues and makes it light enough to run on a phone via Termux.

## Setup

```bash
npm install
cp .env.example .env
# add your GROQ_API_KEY in .env
npm run dev
```

Scan the QR in your terminal (or visit `/qr` in browser if deployed).

## Why Baileys instead of whatsapp-web.js?

| | whatsapp-web.js | Baileys |
|---|---|---|
| Needs Chrome/Puppeteer | ✅ Yes (heavy, version mismatches) | ❌ No |
| RAM usage | High | Low |
| Works well on phone (Termux) | Difficult | Yes |
| Reconnect speed | Slow (relaunches browser) | Fast (just websocket) |

## Running on Render (free tier)

Same as before — push to GitHub, connect on Render, set env vars. Build command is now just:
```
npm install
```
No Puppeteer Chrome install step needed anymore.

**Important:** Free tier still wipes the filesystem on restart, so the session will still need rescanning after long inactivity. This is a Render limitation, not a Baileys one.

## Running on your phone (Termux)

This is now realistic since there's no Chrome dependency:
```bash
pkg install nodejs git -y
git clone <your-repo>
cd wabot
npm install
cp .env.example .env
# edit .env with nano
npm run dev
```
Keep Termux running in the background (use `termux-wake-lock` to prevent Android from killing it).
