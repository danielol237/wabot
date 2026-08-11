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

# ── Install runtime tools ARIA needs (not npm packages) ──────────
# yt-dlp (anime/video downloads), ffmpeg (HLS merge + media), python3
# (code sandbox fallback) and docker (isolated code execution). Without
# these, anime/code/video features silently fail even though AI+WhatsApp work.
echo -e "${YELLOW}🎬 Installing yt-dlp, ffmpeg, python3, docker, nginx...${NC}"
apt install -y -qq ffmpeg python3 python3-pip nginx 2>/dev/null || true
if ! command -v yt-dlp >/dev/null 2>&1; then
  pip3 install --break-system-packages -q yt-dlp 2>/dev/null || pip3 install -q yt-dlp 2>/dev/null || true
fi
if ! command -v docker >/dev/null 2>&1; then
  apt install -y -qq docker.io 2>/dev/null || true
fi

# ── Dedicated unprivileged user ────────────────────────────
# Never run ARIA as root. It has code execution, plugin install, filesystem
# + git access — running as root gives any successful privilege escalation a
# system-wide blast radius. Create a dedicated 'aria' user instead.
APP_USER="aria"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -r -m -s /bin/bash "$APP_USER" 2>/dev/null || useradd -m -s /bin/bash "$APP_USER" 2>/dev/null || true
fi
# Docker group so the app user can run sandboxed containers without root.
if command -v docker >/dev/null 2>&1; then usermod -aG docker "$APP_USER" 2>/dev/null || true; fi

# ── Clone repo (owned by the app user) ─────────────────────
echo -e "${YELLOW}📥 Cloning ARIA...${NC}"
cd /opt
if [ -d "wabot" ]; then
  cd wabot && sudo -u "$APP_USER" git pull 2>/dev/null || git pull
else
  git clone https://github.com/danielol237/wabot.git
  chown -R "$APP_USER:$APP_USER" /opt/wabot
  cd wabot
fi

# ── Install npm packages ───────────────────────────────────
echo -e "${YELLOW}📦 Installing npm packages...${NC}"
# Prefer the lockfile for reproducible installs (npm ci). Fall back to
# npm install if the lockfile is out of sync. Run as the app user so node_modules
# and the runtime data are owned by aria, not root.
if [ -f "package-lock.json" ]; then
  sudo -u "$APP_USER" npm ci --omit=dev 2>/dev/null || sudo -u "$APP_USER" npm install --omit=dev
else
  sudo -u "$APP_USER" npm install --omit=dev
fi

# ── Setup .env ─────────────────────────────────────────────
if [ ! -f ".env" ]; then
  cp .env.example .env
  chown "$APP_USER:$APP_USER" .env
  echo -e "${GREEN}✅ .env created from template${NC}"
fi

# ── PM2 for persistence (as the app user) ──────────────────
echo -e "${YELLOW}🔧 Setting up PM2 as ${APP_USER}...${NC}"
sudo -u "$APP_USER" npm install -g pm2 2>/dev/null || true
sudo -u "$APP_USER" bash -lc 'pm2 delete aria 2>/dev/null || true; pm2 start src/index.js --name aria --max-memory-restart 500M; pm2 save' 2>/dev/null || \
  sudo -u "$APP_USER" bash -lc 'pm2 start src/index.js --name aria --max-memory-restart 500M; pm2 save'
sudo -u "$APP_USER" bash -lc 'pm2 startup 2>/dev/null || true'

# ── Nginx reverse proxy (https-ready) ──────────────────────
# Prefer Nginx in front of the Node server rather than exposing port 3001
# directly to the Internet. Nginx proxies :80 -> localhost:3001 (all the
# dashboards/APIs stay on 3001). For TLS, run 'certbot --nginx' afterwards.
echo -e "${YELLOW}🌐 Configuring Nginx reverse proxy...${NC}"
cat > /etc/nginx/sites-available/wabot <<'EOF'
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/wabot /etc/nginx/sites-enabled/wabot
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

# ── UFW firewall ───────────────────────────────────────────
echo -e "${YELLOW}🔒 Configuring firewall...${NC}"
# ALWAYS allow SSH before enabling the firewall, or the script can lock you
# out of your own VPS (default-deny inbound would block port 22).
SSH_PORT=$(grep -E '^Port ' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1)
SSH_PORT=${SSH_PORT:-22}
ufw allow "${SSH_PORT}/tcp" 2>/dev/null || true
# Only expose 80/443 to the Internet; 3001 stays bound to the host so it's
# reachable via Nginx, not directly.
ufw allow 80/tcp 2>/dev/null || true
ufw allow 443/tcp 2>/dev/null || true
ufw allow 3001/tcp 2>/dev/null || true
ufw --force enable 2>/dev/null || true

# ── Final message ──────────────────────────────────────────
IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      ✅ ARIA is LIVE!                 ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo -e "📱 Scan QR: ${CYAN}http://$IP/dashboard (or http://$IP:3001/dashboard direct)${NC}"
echo -e "🛸 Dashboard: ${CYAN}http://$IP/dashboard${NC}"
echo -e "🔐 HTTPS: ${CYAN}sudo certbot --nginx${NC}"
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
