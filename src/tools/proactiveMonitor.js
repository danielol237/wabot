// ── ARIA Proactive Monitoring ──────────────────────────────────
// A lightweight background loop that watches for things worth surfacing
// (errors, mission stalls, AI-provider failures, long-running jobs) and pushes
// an alert to the owner's chat instead of waiting to be pinged.
//
// Deliberately conservative: only alerts on real, actionable signals, and it
// rate-limits so it never spams. If something is quiet, it stays quiet.

const { track } = require("../utils/eventLog");
const { log, error } = require("../utils/logger");

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const MIN_BETWEEN_ALERTS_MS = 30 * 60 * 1000; // don't alert on the same thing more than once/30min

function recordSentinelSignal(signal) {
  try {
    const configured = String(process.env.OWNER_NUMBER || "").trim();
    if (!configured) return;
    const owner = configured.includes("@") ? configured : configured + "@s.whatsapp.net";
    const sentinel = require("./atlasSentinel");
    const atlas = require("./atlasStore");
    for (const workspace of atlas.listWorkspaces(owner, { state: "active" }).filter((item) => item.sentinel?.enabled)) {
      sentinel.ingestLocal(owner, workspace.id, signal, { notify: false });
    }
  } catch (_) {}
}

let timer = null;
let lastAlert = {}; // key -> ts

function shouldAlert(key) {
  const now = Date.now();
  if (lastAlert[key] && now - lastAlert[key] < MIN_BETWEEN_ALERTS_MS) return false;
  lastAlert[key] = now;
  return true;
}

// Run one monitoring pass. Returns a list of alerts to send (strings).
async function runMonitorPass(holder) {
  const alerts = [];

  try {
    // 1. Recent errors from botAdmin
    const botAdmin = safeReq("../tools/botAdmin");
    if (botAdmin && botAdmin.getRecentErrors) {
      const recent = botAdmin.getRecentErrors(5) || [];
      const fresh = recent.filter((e) => Date.now() - (e.time || 0) < 60 * 60 * 1000);
      if (fresh.length >= 3 && shouldAlert("errors")) {
        alerts.push(`⚠️ *Heads up:* I logged ${fresh.length} errors in the last hour. Might be worth a look — *!errors* for details.`);
      }
      if (fresh.length >= 3) {
        recordSentinelSignal({
          source: "local",
          kind: "runtime_errors",
          action: "review",
          sourceId: "runtime-errors",
          dedupeKey: `local:runtime-errors:${Math.floor(Date.now() / (60 * 60 * 1000))}`,
          title: `${fresh.length} runtime errors in the last hour`,
          summary: "ARIA recorded at least three recent runtime errors. Review the error log before treating the system as healthy.",
          severity: "high",
        });
      }
    }
  } catch (_) {}

  try {
    // 2. Stalled missions (running > 30 min with no progress movement)
    const durable = safeReq("../tools/durableMissions");
    if (durable && durable.getAllMissions) {
      const missions = durable.getAllMissions() || [];
      const stalled = missions.filter((m) => {
        if (m.status !== "running") return false;
        const last = m.updatedAt || m.createdAt || 0;
        return Date.now() - last > 30 * 60 * 1000;
      });
      if (stalled.length && shouldAlert("mission-stall")) {
        alerts.push(`⏳ One of my missions (*${stalled[0].id}*) has been running a while with no update. Check it with *!mission status ${stalled[0].id}*.`);
      }
    }
  } catch (_) {}

  try {
    // 3. AI providers — ACTUALLY probe them (not just "is a key set"). Uses the
    //    same providerHealth checker as the dashboard so a bad/expired key is
    //    caught, not just a missing one.
    const ph = safeReq("../tools/providerHealth");
    if (ph && ph.checkAll) {
      const results = await ph.checkAll();
      const withKeys = (results || []).filter((r) => r.keySet !== false);
      const down = withKeys.filter((r) => !r.ok);
      const anyUp = withKeys.some((r) => r.ok);
      if (withKeys.length && !anyUp && shouldAlert("ai-down")) {
        alerts.push(`🔌 *All configured AI providers are failing.* ${down.map((d) => `${d.name} (${d.error || "error"})`).join(", ")} — replies may fail. Check the dashboard → Health.`);
      }
      if (withKeys.length && !anyUp) {
        recordSentinelSignal({
          source: "local",
          kind: "provider_outage",
          action: "review",
          sourceId: "ai-providers",
          dedupeKey: `local:provider-outage:${Math.floor(Date.now() / (60 * 60 * 1000))}`,
          title: "All configured AI providers are failing",
          summary: down.map((item) => `${item.name}: ${item.error || "unavailable"}`).join("; ").slice(0, 1000),
          severity: "critical",
        });
      }
      if (withKeys.length === 0 && shouldAlert("no-ai-keys")) {
        alerts.push("🔌 I don't have any AI provider keys configured right now — I can't generate replies. Add one of OPENROUTER_API_KEY / GROQ_API_KEY / GEMINI_API_KEY.");
      }
    }
  } catch (_) {}

  return alerts;
}

// Send alerts via the mission socket (which has the live sock reference).
async function pushAlerts(holder) {
  try {
    const alerts = await runMonitorPass(holder);
    const sock = holder && holder.getSock ? holder.getSock() : null;
    const ownerChat = process.env.OWNER_CHAT_ID;
    if (alerts.length && sock) {
      const text = alerts.join("\n\n");
      // Send to owner chat if known, otherwise to any connected chat we've seen.
      if (ownerChat) {
        await sock.sendMessage(ownerChat, { text }).catch(() => {});
        track("alert", text.slice(0, 120), { target: "owner" });
      }
    }
  } catch (err) {
    error("Proactive monitor push failed:", err.message);
  }
}

function safeReq(mod) {
  try { return require(mod); } catch (_) { return null; }
}

function startMonitor(holder) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => pushAlerts(holder), CHECK_INTERVAL_MS);
  timer.unref && timer.unref();
  log("📡 Proactive monitoring started (every " + CHECK_INTERVAL_MS / 60000 + " min).");
}

function stopMonitor() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startMonitor, stopMonitor, pushAlerts, runMonitorPass };
