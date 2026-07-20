require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const pino = require("pino");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const { handleMessage } = require("./handlers/messageHandler");
const { loadPlugins } = require("./utils/pluginLoader");
const { startTaskPoller } = require("./tools/taskPoller");

const TEMP_DIR = path.join(__dirname, "../temp");
const SESSIONS_DIR = path.join(__dirname, "../sessions");
[TEMP_DIR, SESSIONS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Load plugins once at startup. A broken plugin logs an error and gets
// skipped — it never prevents the rest of the bot from starting.
const loadedPlugins = loadPlugins();
console.log(`🧩 ${loadedPlugins.length} plugin(s) loaded.`);

const app = express();
app.use(express.json());

let latestQrDataUrl = null;
let qrGeneratedAt = null;
let pairingCode = null;
let pairingCodeRequested = false; // prevents re-requesting a new code on every reconnect attempt
let isReady = false;
let lastError = null;
let sock = null;

const USE_PAIRING_CODE = !!process.env.PHONE_NUMBER;

app.get("/", (req, res) => {
  res.send(`ARIA Bot — status: ${isReady ? "✅ connected" : "⏳ waiting for link"}`);
});

// Serve built projects for preview. Each project is stored in data/projects/{slug}/
// and can be viewed at /preview/{slug}. Only serves static files for now —
// dynamic previews (npm start) would need their own port.
app.use("/preview", express.static(path.join(__dirname, "../data/projects")));

app.get("/preview", (req, res) => {
  const projectsDir = path.join(__dirname, "../data/projects");
  if (!fs.existsSync(projectsDir)) return res.send("No projects built yet.");
  const projects = fs.readdirSync(projectsDir).filter((f) => fs.statSync(path.join(projectsDir, f)).isDirectory());
  if (projects.length === 0) return res.send("No projects built yet.");
  let html = `<html><body style="background:#111;color:#fff;font-family:sans-serif;padding:40px;">
    <h1>📁 ARIA Projects</h1><ul>`;
  projects.forEach((p) => { html += `<li><a href="/preview/${p}/" style="color:#0f0;">${p}</a></li>`; });
  html += "</ul></body></html>";
  res.send(html);
});

app.get("/qr", (req, res) => {
  if (isReady) {
    return res.send(`<html><body style="background:#111;color:#0f0;font-family:sans-serif;text-align:center;padding-top:100px;">
      <h1>✅ ARIA is connected!</h1></body></html>`);
  }
  if (lastError) {
    return res.send(`<html><head><meta http-equiv="refresh" content="5"></head><body style="background:#111;color:#f55;font-family:sans-serif;text-align:center;padding-top:60px;">
      <h2>⚠️ Error occurred</h2><pre style="white-space:pre-wrap;padding:0 20px;">${lastError}</pre>
      <p>Page will retry automatically...</p></body></html>`);
  }

  if (USE_PAIRING_CODE) {
    if (!pairingCode) {
      return res.send(`<html><head><meta http-equiv="refresh" content="2"></head>
        <body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;">
        <h2>⏳ Generating pairing code...</h2></body></html>`);
    }
    return res.send(`<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding-top:60px;">
      <h2>📱 Enter this code in WhatsApp</h2>
      <p style="font-size:48px;letter-spacing:8px;color:#0f0;font-weight:bold;">${pairingCode}</p>
      <p>WhatsApp → Linked Devices → Link a Device → Link with phone number instead</p></body></html>`);
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

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["ARIA", "Chrome", "1.0.0"],
  });

  // Wrap sendMessage once here so EVERY message ARIA sends anywhere in the app
  // gets tracked automatically — this is what makes "reply to ARIA's message" detection
  // reliable, instead of trying to parse WhatsApp's quoted-message fields after the fact.
  const { trackSentMessage } = require("./utils/botMessages");
  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const result = await originalSendMessage(...args);
    if (result?.key?.id) trackSentMessage(result.key.id);
    return result;
  };

  // If using pairing code and not yet registered, request the code ONCE.
  // IMPORTANT: requesting a pairing code naturally causes Baileys to close the
  // connection with status 428 right after — that's expected protocol behavior,
  // NOT an error. The old code treated every close as "reconnect immediately",
  // which re-requested a fresh pairing code every ~3 seconds, invalidating
  // whatever code you were trying to type and causing WhatsApp to reject the
  // rapid repeated requests with 401s — an infinite self-inflicted loop.
  if (USE_PAIRING_CODE && !sock.authState.creds.registered && !pairingCodeRequested) {
    pairingCodeRequested = true;
    try {
      const code = await sock.requestPairingCode(process.env.PHONE_NUMBER.replace(/[^0-9]/g, ""));
      pairingCode = code;
      console.log(`\n📱 Pairing code: ${code}\n(Enter this in WhatsApp → Linked Devices → Link with phone number instead)\nYou have about 60 seconds — don't worry if the connection log looks like it closed, that's normal right after requesting a code.\n`);
    } catch (err) {
      console.error("Failed to request pairing code:", err.message);
      lastError = `Pairing code request failed: ${err.message}`;
      pairingCodeRequested = false; // allow retry on genuine failure
    }
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !USE_PAIRING_CODE) {
      console.log("📱 New QR generated! Visit /qr to scan it.");
      qrcodeTerminal.generate(qr, { small: true });
      try {
        latestQrDataUrl = await QRCode.toDataURL(qr, { width: 300 });
        qrGeneratedAt = Date.now();
        lastError = null;
      } catch (err) {
        console.error("QR image generation failed:", err.message);
      }
    }

    if (connection === "open") {
      console.log("✅ ARIA is online and ready!");
      isReady = true;
      latestQrDataUrl = null;
      pairingCode = null;
      pairingCodeRequested = false;
      lastError = null;
      startTaskPoller(sock); // safe to call again on reconnect — it clears any previous interval first

      // Pass socket to scheduler so scheduled messages can send
      const { setSock } = require("./tools/scheduler");
      setSock(sock);

      // Heartbeat — ping WhatsApp every 30s to detect silent disconnects.
      // Baileys can drop the socket without emitting a "close" event on some network
      // conditions (NAT timeout, mobile data flips). A periodic ping forces an actual
      // round-trip and triggers disconnect/reconnect if the socket is actually dead.
      if (sock._heartbeatInterval) clearInterval(sock._heartbeatInterval);
      sock._heartbeatInterval = setInterval(async () => {
        try {
          await sock.ws.ping();
        } catch (_) {
          // ping failed — the connection.update handler will pick up the close
        }
      }, 30000);
    }

    if (connection === "close") {
      isReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log("⚠️ Connection closed. Status code:", statusCode, "Reconnecting:", shouldReconnect);

      // If we're mid-pairing (code issued, not yet registered), DON'T reconnect
      // immediately — that's what caused the loop. Give the person time to actually
      // type the code into WhatsApp before trying again.
      const isPendingPairing = USE_PAIRING_CODE && !sock.authState.creds.registered && pairingCodeRequested;
      const reconnectDelay = isPendingPairing ? 45000 : 3000;

      if (isPendingPairing && statusCode !== DisconnectReason.loggedOut) {
        console.log("⏳ Waiting for pairing code to be entered before retrying...");
      }

      if (shouldReconnect) {
        setTimeout(() => {
          // If still not registered after the wait, allow a fresh pairing code request
          if (isPendingPairing) pairingCodeRequested = false;
          startBot().catch((err) => {
            console.error("Reconnect failed:", err.message);
            lastError = err.message;
          });
        }, reconnectDelay);
      } else {
        console.log("❌ Logged out. Need a fresh QR scan — clearing session.");
        lastError = "Logged out — restart the service to get a fresh QR.";
        pairingCodeRequested = false;
        // Clear session files so next boot generates a fresh QR
        try {
          fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
          fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        } catch (err) {
          console.error("Failed to clear session:", err.message);
        }
        setTimeout(() => startBot().catch((err) => {
          console.error("Restart after logout failed:", err.message);
          lastError = err.message;
        }), 5000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      // Auto-save view-once media and forward to owner's DM
      const viewOnceMsg = msg.message?.imageMessage?.viewOnce || msg.message?.videoMessage?.viewOnce;
      if (viewOnceMsg) {
        try {
          const isVideo = !!msg.message?.videoMessage;
          const buffer = await sock.downloadMediaMessage(msg);
          if (buffer) {
            // Save to ARIA own DM (her number) so owner sees it privately
            const ariaJid = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
            const sender = msg.pushName || msg.key.participant || "someone";
            const chatName = msg.key.remoteJid?.includes("g.us") ? "a group" : "a chat";
            if (ariaJid && ariaJid !== msg.key.remoteJid) {
              if (isVideo) {
                await sock.sendMessage(ariaJid, { video: buffer, caption: "🔒 View-once video saved from " + sender + " in " + chatName });
              } else {
                await sock.sendMessage(ariaJid, { image: buffer, caption: "🔒 View-once photo saved from " + sender + " in " + chatName });
              }
              console.log("Auto-saved view-once media from", sender);
            }
          }
        } catch (voErr) {
          console.error("View-once save error:", voErr.message);
        }
      }

      try {
        await handleMessage(sock, msg, loadedPlugins);
      } catch (err) {
        console.error("Message handler error:", err);
        try {
          const { logError } = require("./tools/botAdmin");
          logError("messageHandler", err.message);
        } catch (_) {}

        // Previously, a crash here left the user with just a 🧠 reaction and total
        // silence — confusing and looked like the bot was ignoring them. Always
        // send something back so it's clear what happened instead of going quiet.
        try {
          await sock.sendMessage(msg.key.remoteJid, {
            text: "⚠️ Something broke on my end processing that — try again, or rephrase it.",
          }, { quoted: msg });
        } catch (_) {
          // If even this fails, there's genuinely nothing more we can do for this message
        }
      }
    }
  });

  // Welcome / leave messages when group membership changes
  sock.ev.on("group-participants.update", async (update) => {
    try {
      const { getGroupSettings } = require("./utils/groupSettings");
      const settings = getGroupSettings(update.id);

      if (update.action === "add" && settings.welcome) {
        const message = settings.welcomeMsg || "Welcome {user} to the group! 👋";
        for (const participant of update.participants) {
          const text = message.replace("{user}", `@${participant.split("@")[0]}`);
          await sock.sendMessage(update.id, { text, mentions: [participant] });
        }
      }

      if (update.action === "remove" && settings.leaveMsg) {
        for (const participant of update.participants) {
          const text = settings.leaveMsg.replace("{user}", `@${participant.split("@")[0]}`);
          await sock.sendMessage(update.id, { text, mentions: [participant] });
        }
      }
    } catch (err) {
      console.error("group-participants.update handler error:", err.message);
    }
  });

  return sock;
}

startBot().catch((err) => {
  console.error("❌ Failed to start bot:", err.message);
  lastError = err.message;
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));

// Flush memory to disk on shutdown so nothing's lost on a clean restart/deploy
const { flushNow } = require("./utils/memory");
process.on("SIGINT", () => { flushNow(); process.exit(0); });
process.on("SIGTERM", () => { flushNow(); process.exit(0); });

module.exports = { getSock: () => sock };
