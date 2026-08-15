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
const { log, error, warn } = require("./utils/logger");
const { startTaskPoller } = require("./tools/taskPoller");

const TEMP_DIR = path.join(__dirname, "../temp");
const SESSIONS_DIR = path.join(__dirname, "../sessions");
const sessionPersistence = require("./utils/sessionPersistence");
[TEMP_DIR, SESSIONS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
});

// Load plugins once at startup. A broken plugin logs an error and gets
// skipped — it never prevents the rest of the bot from starting.
const loadedPlugins = loadPlugins();
log(`🧩 ${loadedPlugins.length} plugin(s) loaded.`);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({
  limit: "256kb",
  verify: (req, res, buf) => {
    if (String(req.originalUrl || req.url || "").startsWith("/webhooks/")) req.rawBody = Buffer.from(buf);
  },
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' https: wss:; media-src 'self' https: blob:");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// Public root: the deployed product entry point is the anime catalog. The
// legacy ARIA control site remains available through its existing API routes.
app.get("/", (req, res) => res.redirect(302, "/anime"));

// Small, dependency-aware readiness contract for Render and external monitors.
// It intentionally exposes only operational state, never environment values or
// provider credentials. `/healthz/live` stays green when an optional media
// dependency is unavailable; `/healthz` is ready only when core media tooling
// can be verified.
app.get("/healthz/live", (req, res) => res.json({ ok: true, service: "aria" }));
app.get("/healthz", async (req, res) => {
  try {
    const ajm = require("./tools/animeJobManager");
    const runtimeDeps = await ajm.getRuntimeDeps({ refresh: req.query.refresh === "1" });
    const mediaReady = !!(runtimeDeps.ytDlp && runtimeDeps.ffmpeg && runtimeDeps.ffprobe);
    const ready = mediaReady;
    res.status(ready ? 200 : 503).json({
      ok: ready,
      service: "aria",
      build: process.env.RENDER_GIT_COMMIT || process.env.RENDER_GIT_COMMIT_SHA || "unknown",
      whatsappReady: !!isReady,
      media: runtimeDeps,
    });
  } catch (err) {
    res.status(503).json({ ok: false, service: "aria", error: "health check failed" });
  }
});
app.get("/aria-mark.png", (req, res) => res.sendFile(path.join(__dirname, "../assets/aria-mark-icon.png")));
const websiteRouter = require("./website");
app.use("/", websiteRouter);
// Android Companion API; remains disabled until COMPANION_API_KEY is configured.
app.use("/api/companion", require("./companion"));

// Signed Atlas Sentinel webhooks — provider payloads are verified before they
// enter the durable project brain. They remain opt-in through environment secrets
// and workspace source mappings.
app.use("/webhooks/atlas", require("./tools/atlasWebhooks"));

// Mount web dashboard
const dashboardRouter = require("./dashboard");
app.use("/dashboard", dashboardRouter);
// Platform core and Revenue Engine APIs reuse the dashboard owner session and CSRF boundary.
app.use("/api/platform", require("./platformRouter"));

// ARIA Learner Portal — per-learner accounts (Google OAuth / email), each
// student's own Learner Space + competition leaderboard. Own session cookie
// (aria_portal), separate from the owner dashboard.
app.use("/portal", require("./tools/learnerPortal").router);

let latestQrDataUrl = null;
let qrGeneratedAt = null;
let pairingCode = null;
let pairingCodeRequested = false; // prevents re-requesting a new code on every reconnect attempt
let isReady = false;
let lastError = null;
let sock = null;
function htmlEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Boot-once guard: socket-INDEPENDENT services (session backup, task poller,
// memory curator) must init exactly once at the first connection, NOT on every
// WhatsApp reconnect (audit #35). Reconnects only need to re-wire the socket-
// dependent services (autonomous, missions, scheduler, heartbeat, ...).
let servicesStarted = false;
// Centralized heartbeat tracking — the interval is attached to a socket for
// convenience, but we clear the previous one on close/reconnect so repeated
// reconnects never stack up orphaned ping timers.
let heartbeatTimer = null;

const USE_PAIRING_CODE = !!process.env.PHONE_NUMBER;

// Serve built projects for preview. Each project is stored in data/projects/{slug}/
// and can be viewed at /preview/{slug}. Auth-protected (same session as dashboard)
// so built projects aren't publicly exposed.
const { checkAuth } = require("./dashboard");
app.use("/preview", checkAuth, express.static(path.join(__dirname, "../data/projects")));

// Anime Browser — first-class web section behind the same dashboard auth.
const animeBrowserRouter = require("./animeBrowser");
app.use("/dashboard/anime", checkAuth, animeBrowserRouter);

// ARIA Anime — standalone PUBLIC streaming/download site (separate from dashboard).
const animeSiteRouter = require("./animeSite");
app.use("/anime", animeSiteRouter);

app.get("/preview", checkAuth, (req, res) => {
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

function pairingPage(title, content, refresh = 0) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ""}<title>${htmlEsc(title)} · ARIA</title><script>try{const t=localStorage.getItem('aria-pairing-theme');document.documentElement.dataset.theme=t||((matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light')}catch(_){document.documentElement.dataset.theme='light'}</script><style>:root{color-scheme:dark;--bg:#0b0d12;--panel:#151a22;--line:#2a3240;--text:#f4f6fa;--muted:#9ba6b8;--accent:#ff5d6c;--ok:#42d6a2}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif}.card{width:min(560px,100%);padding:28px;border:1px solid var(--line);border-radius:20px;background:var(--panel);text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)}.mark{display:block;width:48px;height:48px;margin:0 auto 16px;border-radius:14px;object-fit:cover;background:#0b0d12;box-shadow:0 8px 24px rgba(255,107,107,.18)}h1{font-size:24px;margin:0 0 8px;letter-spacing:-.03em}.sub{color:var(--muted);font-size:13px;line-height:1.6}.qr{width:min(300px,80vw);height:auto;margin:22px auto 14px;padding:10px;background:#fff;border-radius:14px}.code{display:block;margin:22px 0 14px;padding:16px;border:1px solid rgba(66,214,162,.4);border-radius:14px;color:var(--ok);font:800 34px/1 ui-monospace,monospace;letter-spacing:.18em}.steps{margin:22px auto 0;padding:16px;border-radius:12px;background:#0f141b;color:var(--muted);font-size:12px;text-align:left;line-height:1.8}.status{display:inline-flex;padding:5px 10px;border-radius:99px;background:rgba(66,214,162,.12);color:var(--ok);font-size:11px;font-weight:800}.status.error{background:rgba(255,93,108,.12);color:var(--accent)}a{display:inline-block;margin-top:18px;color:var(--text);text-decoration:none;border:1px solid var(--line);border-radius:9px;padding:9px 13px;font-size:12px;font-weight:700}/* ARIA V9 pairing surface */
:root{color-scheme:light;--bg:#fbfafc;--panel:#fff;--line:#e7e1eb;--text:#1a1720;--muted:#6d6678;--accent:#8e6bd6;--accent2:#ed7184;--ok:#3a9c8e}body{background:radial-gradient(circle at 50% 0,#f2eafa 0,transparent 44%),var(--bg);color:var(--text);font-family:"DM Sans",Inter,system-ui,sans-serif;padding:18px}.card{width:min(620px,100%);padding:40px 34px;border:1px solid var(--line);border-radius:28px;background:rgba(255,255,255,.92);box-shadow:0 24px 70px rgba(55,36,76,.12)}.mark{width:58px;height:58px;margin-bottom:22px;border-radius:17px;background:#f2eafa;box-shadow:0 10px 26px rgba(142,107,214,.16)}h1{font-family:Georgia,"Times New Roman",serif;font-size:clamp(30px,5vw,42px);font-weight:500;letter-spacing:-.055em}.sub{color:var(--muted);font-size:14px;line-height:1.7}.qr{width:min(320px,82vw);margin:26px auto 18px;padding:14px;border:1px solid var(--line);border-radius:18px;box-shadow:0 12px 28px rgba(55,36,76,.08)}.code{margin:24px 0 18px;padding:20px;border:1px solid #dfd1ef;border-radius:16px;background:#f6f1fa;color:var(--accent);font:800 clamp(25px,7vw,38px)/1 ui-monospace,monospace;letter-spacing:.16em;word-break:break-word}.steps{margin:24px auto 0;padding:17px 18px;border:1px solid var(--line);border-radius:14px;background:#f7f3f9;color:var(--muted);font-size:13px;text-align:left;line-height:1.8}.status{background:#e3f4f1;color:var(--ok);padding:6px 11px}.status.error{background:#fae6ea;color:#c54f66}a{color:var(--text);border-color:var(--line);border-radius:11px;padding:11px 15px}a:hover{border-color:#cbb9e7;color:var(--accent)}@media(max-width:520px){.card{padding:30px 20px;border-radius:22px}.mark{width:52px;height:52px}.steps{font-size:12px}}
.theme-toggle{position:fixed;top:16px;right:18px;border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:11px;padding:9px 11px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.theme-toggle:hover{border-color:var(--accent);color:var(--text)}:root[data-theme="dark"]{color-scheme:dark;--bg:#0c0e13;--panel:#141821;--line:#2b3544;--text:#f6f7fb;--muted:#aeb7c7;--accent:#c9a7ff;--ok:#55d5b4}:root[data-theme="dark"] body{background:radial-gradient(850px 480px at 90% 0,#222036,transparent 64%),#0c0e13}:root[data-theme="dark"] .card{background:#141821;border-color:#2b3544;box-shadow:0 20px 60px rgba(0,0,0,.34)}:root[data-theme="dark"] .steps{background:#1a202b;border-color:#2b3544}:root[data-theme="dark"] .code{background:#201c2e;border-color:#4b3d6a;color:#c9a7ff}
</style></head><body><button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark theme">◐ Dark</button><main class="card"><img class="mark" src="/aria-mark.png" alt="ARIA" width="48" height="48">${content}</main><script>(function(){const b=document.getElementById('theme-toggle');if(!b)return;function sync(){const d=document.documentElement.dataset.theme==='dark';b.textContent=d?'☼ Light':'◐ Dark';b.setAttribute('aria-label',d?'Switch to light theme':'Switch to dark theme')}b.addEventListener('click',function(){const n=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=n;try{localStorage.setItem('aria-pairing-theme',n)}catch(_){}sync()});sync()})()</script></body></html>`;
}

app.get("/qr", checkAuth, (req, res) => {
  if (isReady) return res.send(pairingPage("WhatsApp connected", `<span class="status">Connected</span><h1>ARIA is online</h1><p class="sub">WhatsApp pairing is complete. Return to the dashboard to manage the bot.</p><a href="/dashboard">Back to dashboard</a>`));
  if (lastError) return res.send(pairingPage("Pairing error", `<span class="status error">Needs attention</span><h1>Pairing needs attention</h1><p class="sub">${htmlEsc(lastError)}</p><p class="sub">This page will retry automatically.</p>`, 5));
  if (USE_PAIRING_CODE) {
    if (!pairingCode) return res.send(pairingPage("Preparing pairing code", `<h1>Preparing pairing code</h1><p class="sub">Keep this page open. A new code will appear shortly.</p>`, 2));
    return res.send(pairingPage("Pair with a code", `<span class="status">Secure owner pairing</span><h1>Enter this code in WhatsApp</h1><code class="code">${htmlEsc(pairingCode)}</code><div class="steps">WhatsApp → Linked devices → Link a device → Link with phone number instead</div>`));
  }
  if (!latestQrDataUrl) return res.send(pairingPage("Preparing QR code", `<h1>Preparing QR code</h1><p class="sub">Keep this page open. The QR will appear as soon as WhatsApp provides it.</p>`, 2));
  const ageSeconds = Math.floor((Date.now() - qrGeneratedAt) / 1000);
  return res.send(pairingPage("Scan WhatsApp QR", `<span class="status">Secure owner pairing</span><h1>Scan with WhatsApp</h1><img class="qr" src="${latestQrDataUrl}" alt="WhatsApp pairing QR code"><p class="sub">Generated ${ageSeconds}s ago. This screen refreshes every 3 seconds.</p><div class="steps">WhatsApp → Linked devices → Link a device → Scan the QR shown above.</div>`, 3));
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


  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !USE_PAIRING_CODE) {
      log("📱 New QR generated! Visit /qr to scan it.");
      qrcodeTerminal.generate(qr, { small: true });
      try {
        latestQrDataUrl = await QRCode.toDataURL(qr, { width: 300 });
        qrGeneratedAt = Date.now();
        lastError = null;
      } catch (err) {
        error("QR image generation failed:", err.message);
      }
    }

    if (connection === "open") {
      log("✅ ARIA is online and ready!");
      isReady = true;
      latestQrDataUrl = null;
      lastError = null;
      // ── Boot-once services (socket-independent) ──────────────────────────
      // These don't need a socket and must NOT re-run on every reconnect.
      if (!servicesStarted) {
        servicesStarted = true;
        // One-time migration of any legacy per-store JSON files into the unified
        // ProfileStore (audit #18). No-op once migrated.
        try { require("./utils/profileStore").migrateLegacy(); } catch (_) {}
        // Keep the session backed up so restarts don't force a QR re-scan
        sessionPersistence.startAutoSync();
        sessionPersistence.backupSession().catch((e) => warn("Initial session backup:", e.message));
        startTaskPoller(sock);

        // Start periodic memory curation (keeps long-term memory clean)
        try {
          const { startCurator } = require("./tools/memoryCurator");
          startCurator();
        } catch (e) {
          error("Memory curator init error:", e.message);
        }
      }

      // Start autonomous mode — ARIA sends proactive messages
      try {
        const { init } = require("./tools/autonomous");
        init(sock);
      } catch (e) {
        error("Autonomous init error:", e.message);
      }

      // Start the 24/7 mission runner — resumes + reports on long-term goals
      try {
        const missionRunner = require("./tools/missionRunner");
        missionRunner.init(sock);
      } catch (e) {
        error("Mission runner init error:", e.message);
      }

      // Start proactive monitoring (errors, stalled missions, provider status)
      try {
        const { startMonitor } = require("./tools/proactiveMonitor");
        const holder = require("./tools/missionSock");
        holder.setSock(sock);
        startMonitor(holder);
      } catch (e) {
        error("Proactive monitor init error:", e.message);
      }

      // Log the connection as an event
      try {
        require("./utils/eventLog").track("system", "ARIA came online");
      } catch (_) {}

      // Request pairing code once the connection is open and if not yet registered
      if (USE_PAIRING_CODE && !sock.authState.creds.registered && !pairingCodeRequested) {
        pairingCodeRequested = true;
        sock.requestPairingCode(process.env.PHONE_NUMBER.replace(/[^0-9]/g, "")).then(code => {
          pairingCode = code;
          log(`\n📱 Pairing code: ${code}\n(Enter this in WhatsApp → Linked Devices → Link with phone number instead)\n`);
        }).catch(err => {
          error("Pairing code failed:", err.message);
          pairingCodeRequested = false;
        });
      } // safe to call again on reconnect — it clears any previous interval first

      // Pass socket to scheduler so scheduled messages can send, and re-arm
      // any schedules persisted across a restart.
      const { setSock, rearmAll } = require("./tools/scheduler");
      setSock(sock);
      rearmAll();

      // Re-arm persisted recurring reminders too.
      try {
        const { rearmAll: rearmReminders } = require("./tools/recurringReminders");
        rearmReminders(sock);
      } catch (e) {
        error("Recurring reminder rearm error:", e.message);
      }

      // Recover any durable missions that were mid-execution when we last died,
      // and give the mission engine the socket so it can report progress.
      try {
        const { recoverMissions, setSock: setMissionSock } = require("./tools/durableMissions");
        setMissionSock(sock);
        recoverMissions();
        // Shared mission socket so the orchestrator can send updates too
        const missionSock = require("./tools/missionSock");
        missionSock.setSock(sock);
      } catch (e) {
        error("Mission recovery error:", e.message);
      }

      // Heartbeat — ping WhatsApp every 30s to detect silent disconnects.
      // Baileys can drop the socket without emitting a "close" event on some network
      // conditions (NAT timeout, mobile data flips). A periodic ping forces an actual
      // round-trip and triggers disconnect/reconnect if the socket is actually dead.
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(async () => {
        try {
          await sock.ws.ping();
        } catch (_) {
          // ping failed — the connection.update handler will pick up the close
        }
      }, 30000);
    }

    if (connection === "close") {
      isReady = false;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      log("⚠️ Connection closed. Status code:", statusCode, "Reconnecting:", shouldReconnect);

      // If we're mid-pairing (code issued, not yet registered), DON'T reconnect
      // immediately — that's what caused the loop. Give the person time to actually
      // type the code into WhatsApp before trying again.
      const isPendingPairing = USE_PAIRING_CODE && !sock.authState.creds.registered && pairingCodeRequested;
      const reconnectDelay = isPendingPairing ? 45000 : 3000;

      if (isPendingPairing && statusCode !== DisconnectReason.loggedOut) {
        log("⏳ Waiting for pairing code to be entered before retrying...");
      }

      if (shouldReconnect) {
        setTimeout(() => {
          // If still not registered after the wait, allow a fresh pairing code request
          if (isPendingPairing) pairingCodeRequested = false;
          startBot().catch((err) => {
            error("Reconnect failed:", err.message);
            lastError = err.message;
          });
        }, reconnectDelay);
      } else {
        log("❌ Logged out. Need a fresh QR scan — clearing session.");
        lastError = "Logged out — restart the service to get a fresh QR.";
        pairingCodeRequested = false;
        // Clear session files so next boot generates a fresh QR
        try {
          fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
          fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        } catch (err) {
          error("Failed to clear session:", err.message);
        }
        setTimeout(() => startBot().catch((err) => {
          error("Restart after logout failed:", err.message);
          lastError = err.message;
        }), 5000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      // View-once media is ephemeral BY DESIGN. Auto-downloading and forwarding
      // it is a privacy-sensitive behavior, so it's gated behind an explicit
      // SAVE_VIEW_ONCE=true opt-in (audit #36). When disabled, view-once media
      // is left untouched. When enabled, it's forwarded to the OWNER's DM only,
      // and every save is recorded in the audit log.
      const saveViewOnce = process.env.SAVE_VIEW_ONCE === "true";
      const viewOnceMsg =
        msg.message?.imageMessage?.viewOnce ||
        msg.message?.videoMessage?.viewOnce ||
        msg.message?.audioMessage?.viewOnce;
      if (viewOnceMsg && saveViewOnce) {
        try {
          const isVideo = !!msg.message?.videoMessage;
          const isAudio = !!msg.message?.audioMessage;
          const buffer = await sock.downloadMediaMessage(msg);
          if (buffer) {
            // Save to the OWNER's DM so they see it privately. Prefer the
            // owner's LID (WhatsApp's newer format) or phone number; fall back
            // to ARIA's own DM if the owner can't be determined.
            const ownerLid = process.env.OWNER_LID || "211643824869445";
            const ownerPhone = (process.env.OWNER_NUMBER || "237650284057").replace(/[^0-9]/g, "");
            const ownerJid = ownerLid && ownerLid.includes("@")
              ? ownerLid
              : (ownerLid ? `${ownerLid}@lid` : `${ownerPhone}@s.whatsapp.net`);
            const sender = msg.pushName || msg.key.participant || "someone";
            const chatName = msg.key.remoteJid?.includes("g.us") ? "a group" : "a chat";
            const destJid = ownerJid || (sock.user?.id?.split(":")[0] + "@s.whatsapp.net");
            if (destJid && destJid !== msg.key.remoteJid) {
              if (isAudio) {
                const ptt = !!msg.message?.audioMessage?.ptt;
                await sock.sendMessage(destJid, { audio: buffer, mimetype: "audio/ogg; codecs=opus", ptt, caption: "🔒 View-once voice note saved from " + sender + " in " + chatName });
              } else if (isVideo) {
                await sock.sendMessage(destJid, { video: buffer, caption: "🔒 View-once video saved from " + sender + " in " + chatName });
              } else {
                await sock.sendMessage(destJid, { image: buffer, caption: "🔒 View-once photo saved from " + sender + " in " + chatName });
              }
              // Audit trail: record every view-once save (who, what, where, when)
              // so the behavior is observable, not silently buried in the handler.
              try {
                require("./utils/eventLog").track("view-once-saved", `${isVideo ? "video" : isAudio ? "voice" : "photo"} from ${sender} in ${chatName}`, { destJid, sender, chatName });
              } catch (_) {}
              log("Auto-saved view-once media from", sender);
            }
          }
        } catch (voErr) {
          error("View-once save error:", voErr.message);
        }
      }

      try {
        await handleMessage(sock, msg, loadedPlugins);
      } catch (err) {
        error("Message handler error:", err);
        try {
          const { logError } = require("./tools/botAdmin");
          logError("messageHandler", err.message);
        } catch (_) {}

        // Previously, a crash here left the user with just a 🧠 reaction and total
        // silence — confusing and looked like the bot was ignoring them. Always
        // send something back so it's clear what happened instead of going quiet.
        try {
          await sock.sendMessage(msg.key.remoteJid, {
            text: "⚠️ Something broke on my end: " + (err?.message || err || "unknown error"),
          }, { quoted: msg });
        } catch (_) {
          // If even this fails, there's genuinely nothing more we can do for this message
        }
      }
    }
  });

  // Welcome / leave messages and PASQUA group protections when membership changes
  sock.ev.on("group-participants.update", async (update) => {
    try {
      await require("./tools/groupProtection").handleParticipantUpdate(sock, update);
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
      error("group-participants.update handler error:", err.message);
    }
  });

  return sock;
}

const PORT = process.env.PORT || 3001;

// Boot: restore the Git-backed WhatsApp session FIRST (await it) so the bot
// doesn't reach useMultiFileAuthState() with an empty session and force a QR
// re-scan even though a valid session exists in the backup repo. Only after
// restore finishes do we start the socket and listen.
async function boot() {
  try {
    const r = await sessionPersistence.restoreSession();
    if (r?.ok) log("💾 Session restored — keeping existing WhatsApp link.");
    else if (r?.err) warn("Session restore:", r.err);
  } catch (e) {
    warn("Session restore error:", e.message);
  }

  await startBot().catch((err) => {
    error("❌ Failed to start bot:", err.message);
    lastError = err.message;
  });

  app.listen(PORT, () => log(`🚀 Server on port ${PORT}`));
}

boot();

// Flush memory to disk on shutdown so nothing's lost on a clean restart/deploy
const { flushNow } = require("./utils/memory");
const shutdown = async () => {
  flushNow();
  sessionPersistence.stopAutoSync();
  await sessionPersistence.backupSession().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = { getSock: () => sock };
