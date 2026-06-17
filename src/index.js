require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const express = require("express");
const { handleMessage } = require("./handlers/messageHandler");

// Ensure required folders exist
const TEMP_DIR = path.join(__dirname, "../temp");
const SESSIONS_DIR = path.join(__dirname, "../sessions");
[TEMP_DIR, SESSIONS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
app.use(express.json());

let latestQrDataUrl = null;
let qrGeneratedAt = null;
let isReady = false;
let lastError = null;

app.get("/", (req, res) => {
  res.send(`ARIA Bot — status: ${isReady ? "✅ connected" : "⏳ waiting for QR scan"}`);
});

app.get("/qr", (req, res) => {
  if (isReady) {
    return res.send(`<html><body style="background:#111;color:#0f0;font-family:sans-serif;text-align:center;padding-top:100px;">
      <h1>✅ ARIA is connected!</h1></body></html>`);
  }
  if (lastError) {
    return res.send(`<html><body style="background:#111;color:#f55;font-family:sans-serif;text-align:center;padding-top:60px;">
      <h2>⚠️ Error occurred</h2><pre style="white-space:pre-wrap;padding:0 20px;">${lastError}</pre></body></html>`);
  }
  if (!latestQrDataUrl) {
    return res.send(`<html><head><meta http-equiv="refresh" content="2"></head>
      <body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;">
      <h2>⏳ Waiting for QR code to generate...</h2></body></html>`);
  }
  const ageSeconds = Math.floor((Date.now() - qrGeneratedAt) / 1000);
  res.send(`<html><head><meta http-equiv="refresh" content="3"></head>
    <body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding-top:40px;">
    <h2>📱 Scan this QR with WhatsApp</h2>
    <img src="${latestQrDataUrl}" style="width:300px;height:300px;" />
    <p>Generated ${ageSeconds}s ago — page auto-refreshes every 3s</p></body></html>`);
});

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

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSIONS_DIR }),
  puppeteer: puppeteerConfig,
});

client.on("qr", async (qr) => {
  console.log("📱 New QR generated! Visit /qr to scan it.");
  qrcodeTerminal.generate(qr, { small: true });
  try {
    latestQrDataUrl = await QRCode.toDataURL(qr, { width: 300 });
    qrGeneratedAt = Date.now();
    lastError = null;
  } catch (err) {
    console.error("QR image generation failed:", err.message);
  }
});

client.on("ready", () => {
  console.log("✅ ARIA is online and ready!");
  isReady = true;
  latestQrDataUrl = null;
  lastError = null;
});

client.on("auth_failure", (msg) => {
  console.error("❌ Auth failed:", msg);
  lastError = `Auth failure: ${msg}`;
  isReady = false;
});

client.on("disconnected", (reason) => {
  console.log("⚠️ Client disconnected:", reason);
  isReady = false;
  latestQrDataUrl = null;
  // Give it a moment before reinitializing to avoid rapid crash loops
  setTimeout(() => {
    client.initialize().catch((err) => {
      console.error("Reinitialize failed:", err.message);
      lastError = err.message;
    });
  }, 5000);
});

client.on("message", async (msg) => {
  try {
    await handleMessage(client, msg);
  } catch (err) {
    console.error("Message handler error:", err);
  }
});

client.initialize().catch((err) => {
  console.error("❌ Initialize failed:", err.message);
  lastError = err.message;
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));

module.exports = { client };
