// ── ARIA 24/7 Autonomous Mission Runner ───────────────────────
// The missing glue between the durable mission engine and proactive
// behaviour. Every N minutes it:
//   1. Finds missions that are paused / waiting-to-continue / pending and
//      resumes them (so long-running goals actually get finished).
//   2. Pushes a proactive progress update to the owner when a mission moves.
//   3. Surfaces stalled missions so nothing silently dies.
//
// This is the "works for you 24/7" layer — combined with the durable engine,
// world model and memory, it makes ARIA feel like she's executing goals, not
// just waiting to be pinged.

const { log, error } = require("../utils/logger");

let timer = null;
let sockRef = null;
const RUN_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
const lastNotified = new Map(); // missionId -> ts (rate-limit proactive updates)

function init(sock) {
  sockRef = sock;
  // Warmup / fresh-number safety: don't spam proactive missions until the
  // account has matured. Reply-only until ARIA_WARMUP is removed.
  if (process.env.ARIA_WARMUP === "true") {
    log("🌱 Warmup mode: mission runner disabled.");
    return;
  }
  startRunner();
}

function startRunner() {
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    try { await runMissionPass(); } catch (e) { error("Mission runner tick error:", e.message); }
  }, RUN_INTERVAL_MS);
  if (timer.unref) timer.unref();
  log(`🚀 Mission runner started (every ${RUN_INTERVAL_MS / 60000} min).`);
}

// One pass: resume anything that should be running, notify on progress/stall.
async function runMissionPass() {
  if (!sockRef) return;
  const durable = require("./durableMissions");
  const missions = durable.getAllMissions ? durable.getAllMissions() : [];
  if (!missions.length) return;

  for (const m of missions) {
    // 1. Resume missions that are paused mid-build or queued/pending.
    const shouldResume =
      (m.status === "pending") ||
      (m.status === "running" && m.progress && /(continue|paused|resume|step \d)/i.test(m.progress));

    if (shouldResume && m.status === "running" && m.lease && m.lease.active && Date.now() - m.updatedAt < 5 * 60 * 1000) {
      // Actively being worked on — skip.
      continue;
    }

    if (shouldResume) {
      // Resume (durable engine ignores if it's already owned).
      durable.executeMission(m.id, true);
    }

    // 2. Proactive progress update for the owner (rate-limited to 1/6h per mission).
    const ownerChat = process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER + "@s.whatsapp.net" : null;
    const sixH = 6 * 60 * 60 * 1000;
    if (ownerChat && m.status === "running" && Date.now() - (lastNotified.get(m.id) || 0) > sixH) {
      lastNotified.set(m.id, Date.now());
      try {
        await sockRef.sendMessage(ownerChat, {
          text: `📈 *Mission update* \`${m.id}\`\n\n"${(m.objective || "").slice(0, 60)}"\n\n${m.progress || m.status}`,
        });
      } catch (e) { error("Mission runner notify error:", e.message); }
    }

    // 3. Surface stalled missions (running but no movement for 30+ min).
    const stalledFor = Date.now() - (m.updatedAt || m.createdAt || 0);
    if (m.status === "running" && stalledFor > 30 * 60 * 1000 && ownerChat && Date.now() - (lastNotified.get("stall-" + m.id) || 0) > 6 * 60 * 60 * 1000) {
      lastNotified.set("stall-" + m.id, Date.now());
      try {
        await sockRef.sendMessage(ownerChat, {
          text: `⚠️ *Mission \`${m.id}\` has been running a while without progress.*\n\n"${(m.objective || "").slice(0, 60)}"\n\nCheck it: *!mission status ${m.id}*`,
        });
      } catch (e) { error("Mission runner stall-notify error:", e.message); }
    }
  }
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { init, startRunner, runMissionPass, stop };
