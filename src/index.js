require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const { handleMessage } = require("./handlers/messageHandler");
const QRCode = require('qrcode');
let currentQR = null;

const app = express();
app.use(express.json());

// Health check for Railway
app.get("/", (req, res) => res.send("ARIA Bot is running 🤖"));
app.get('/qr', (req, res) => {
  if (!currentQR) return res.send('<h3>No QR yet</h3><p>Restart service on Render to generate new QR</p>');
  res.send(`
    <div style="text-align:center;margin-top:50px;font-family:sans-serif">
      <h2>Scan with WhatsApp</h2>
      <p>WhatsApp > Settings > Linked Devices > Link a Device</p>
      <img src="${currentQR}" style="width:300px;border:2px solid #ccc">
    </div>
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
client.on('qr', async (qr) => {
  currentQR = await QRCode.toDataURL(qr);
  console.log('QR generated! Open: https://wabot-ytal.onrender.com/qr');
});

client.on("ready", () => {
  console.log("✅ ARIA is online and ready!");
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
