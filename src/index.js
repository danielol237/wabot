require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const express = require("express");
const { handleMessage } = require("./handlers/messageHandler");

// Ensure required folders exist (Render/fresh clones won't have them)
const TEMP_DIR = path.join(__dirname, "../temp");
const SESSIONS_DIR = path.join(__dirname, "../sessions");
[TEMP_DIR, SESSIONS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
app.use(express.json());

// Stores the latest QR as a base64 data URL so the webpage can always show the freshest one
let latestQrDataUrl = null;
let qrGeneratedAt = null;
let isReady = false;

// Health check
app.get("/", (req, res) => res.send("ARIA Bot is running 🤖"));

// Auto-refreshing QR page — keeps polling for the newest QR so you never miss the scan window
app.get("/qr", (req, res) => {
  if (isReady) {
    return res.send(`
      <html><body style="background:#111;color:#0f0;font-family:sans-serif;text-align:center;padding-top:100px;">
        <h1>✅ ARIA is already connected!</h1>
        <p>No need to scan anything.</p>
      </body></html>
    `);
  }

  if (!latestQrDataUrl) {
    return res.send(`
      <html><head><meta http-equiv="refresh" content="2"></head>
      <body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;">
        <h2>⏳ Waiting for QR code to generate...</h2>
        <p>This page refreshes automatically.</p>
      </body></html>
    `);
  }

  const ageSeconds = Math.floor((Date.now() - qrGeneratedAt) / 1000);
  res.send(`
    <html><head><meta http-equiv="refresh" content="3"></head>
    <body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding-top:40px;">
      <h2>📱 Scan this QR with WhatsApp</h2>
      <img src="${latestQrDataUrl}" style="width:300px;height:300px;" />
      <p>Generated ${ageSeconds}s ago — page auto-refreshes every 3s</p>
      <p style="color:#888;font-size:12px;">If it's been more than 20s, wait for the next refresh — a new QR is coming.</p>
    </body></html>
  `);
});

// On Render, use their installed Chrome. Locally, let puppeteer find it automatically.
const puppeteerConfig = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--single-process",
    "--disable-gpu",
  ],
};

// Use bundled puppeteer's own Chrome on Render
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./sessions" }),
  puppeteer: puppeteerConfig,
});

// QR Code for first-time login
client.on("qr", async (qr) => {
  console.log("\n📱 New QR generated! Visit /qr to scan it.\n");
  qrcode.generate(qr, { small: true });

  try {
    latestQrDataUrl = await QRCode.toDataURL(qr, { width: 300 });
    qrGeneratedAt = Date.now();
  } catch (err) {
    console.error("QR image generation failed:", err.message);
  }
});

client.on("ready", () => {
  console.log("✅ ARIA is online and ready!");
  isReady = true;
  latestQrDataUrl = null;
});

client.on("auth_failure", (msg) => {
  console.error("❌ Auth failed:", msg);
});

client.on("disconnected", (reason) => {
  console.log("⚠️ Client disconnected:", reason);
  client.initialize(); // auto reconnect
});

// Main message handler
client.on("message", async (msg) => {
  try {
    await handleMessage(client, msg);
  } catch (err) {
    console.error("Message handler error:", err);
  }
});

// Start
client.initialize();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));

module.exports = { client };
