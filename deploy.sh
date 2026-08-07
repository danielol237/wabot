#!/bin/bash
# ARIA One-Click Deploy — runs on any fresh Ubuntu/Debian VPS
# Usage: curl -sSL https://raw.githubusercontent.com/danielol237/wabot/main/deploy.sh | bash
# Or: wget -qO- https://raw.githubusercontent.com/danielol237/wabot/main/deploy.sh | bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║        ARIA WhatsApp Bot Deployer      ║"
echo "  ║     One-Click Setup — No BS Edition    ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Check root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}❌ Run as root: sudo bash deploy.sh${NC}"
  exit 1
fi

# ── Install dependencies ───────────────────────────────────
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
apt update -qq
apt install -y -qq curl wget git nano 2>/dev/null || true

# Install Node 20 (current LTS) — Node 18 is EOL
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  echo -e "${YELLOW}📦 Installing Node 20 LTS...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y -qq nodejs
fi

# ── Clone repo ─────────────────────────────────────────────
echo -e "${YELLOW}📥 Cloning ARIA...${NC}"
cd /opt
if [ -d "wabot" ]; then
  cd wabot && git pull
else
  git clone https://github.com/danielol237/wabot.git
  cd wabot
fi

# ── Install npm packages ───────────────────────────────────
echo -e "${YELLOW}📦 Installing npm packages...${NC}"
npm install --omit=dev 2>/dev/null || npm install

# ── Setup .env ─────────────────────────────────────────────
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo -e "${GREEN}✅ .env created from template${NC}"
fi

# ── PM2 for persistence ────────────────────────────────────
echo -e "${YELLOW}🔧 Setting up PM2...${NC}"
npm install -g pm2 2>/dev/null || npm install pm2
pm2 delete aria 2>/dev/null || true
pm2 start src/index.js --name aria --max-memory-restart 500M
pm2 save
pm2 startup 2>/dev/null || true

# ── UFW firewall ───────────────────────────────────────────
echo -e "${YELLOW}🔒 Configuring firewall...${NC}"
ufw allow 3001/tcp 2>/dev/null || true
ufw --force enable 2>/dev/null || true

# ── Final message ──────────────────────────────────────────
IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      ✅ ARIA is LIVE!                 ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo -e "📱 Scan QR: ${CYAN}http://$IP:3001${NC}"
echo -e "🛸 Dashboard: ${CYAN}http://$IP:3001/dashboard${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Edit .env:   nano /opt/wabot/.env"
echo "  2. Add your GROQ_API_KEY at minimum"
echo "  3. Restart:     pm2 restart aria"
echo "  4. Check logs:  pm2 logs aria"
echo ""
echo -e "${CYAN}Set these in .env for full features:${NC}"
echo "  GROQ_API_KEY    — AI chat + voice transcription"
echo "  OWNER_NUMBER    — Your WhatsApp (no +)"
echo "  DASHBOARD_PASSWORD — Web panel access"
echo "  ELEVENLABS_API_KEY — Voice responses"
echo "  TAVILY_API_KEY  — Web search"
echo ""
echo -e "${GREEN}ARIA is running. Configure .env and restart. 🔥${NC}"
