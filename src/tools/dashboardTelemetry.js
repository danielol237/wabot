// ── ARIA Dashboard Telemetry / Data Layer ────────────────────────
// The intelligence behind the cockpit. Kept SEPARATE from the dashboard's
// rendering so the UI stays a thin view over live, real data.
//
// Provides:
//   • liveStatus()   — real-time ARIA core status (model, memory, missions,
//                      msgs/min, latency, errors)
//   • analytics()    — 24h / 7d / 30d time-series (messages, commands, AI,
//                      errors, latency) from a rolling persisted buffer
//   • academyData()  — learners, lessons, challenges, projects, avg mastery,
//                      most-active track, weakest skill, streaks, top learners
//   • learnerProfile(uid) — Engineering DNA / career fit / roadmap drill-down
//   • incidentData() — incident center (resolved / active / critical + latest)
//   • brainData()    — ARIA 'brain' pane (memory/learning/automation/reliability)
//
// Time-series events are appended via record(type, meta) by lightweight hooks
// in the message handler, command router, and AI module.

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/dashboardTelemetry.json");
let telemetry = { events: [] }; // { t, type, ok, latency }
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) || {};
    if (Array.isArray(raw.events)) telemetry.events = raw.events;
  } catch (_) { telemetry.events = []; }
}
let saveTimer = null;
function persist() {
  // Throttle disk writes (batch + debounce) so hot paths don't thrash the file.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(FILE, JSON.stringify(telemetry)); } catch (_) {}
  }, 3000);
}
load();

function tryLoad(mod) { try { return require(mod); } catch (_) { return null; } }

// ── Record an event into the rolling time-series ───────────────
// type: 'message' | 'command' | 'ai' | 'error' | 'download' | 'incident'
// meta: { ok?, latency? (ms), provider?, detail? }
function record(type, meta = {}) {
  const ev = { t: Date.now(), type, ok: meta.ok, latency: meta.latency, provider: meta.provider, detail: meta.detail };
  telemetry.events.push(ev);
  // Bound memory — keep ~30 days of events (rough cap).
  if (telemetry.events.length > 60000) telemetry.events = telemetry.events.slice(-30000);
  persist();
}

// ── Analytics: aggregate the buffer into 24h / 7d / 30d buckets ──
function analytics() {
  const now = Date.now();
  const DAY = 86400000;
  const windows = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };
  const out = {};
  for (const [label, ms] of Object.entries(windows)) {
    const since = now - ms;
    const inWin = telemetry.events.filter((e) => e.t >= since);
    const count = (type) => inWin.filter((e) => e.type === type).length;
    const okCount = (type) => inWin.filter((e) => e.type === type && e.ok !== false).length;
    const latencies = inWin.filter((e) => e.latency != null).map((e) => e.latency);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const aiCalls = inWin.filter((e) => e.type === "ai").length;
    const aiFail = inWin.filter((e) => e.type === "ai" && e.ok === false).length;
    const providers = {};
    for (const e of inWin.filter((x) => x.type === "ai" && x.provider)) {
      providers[e.provider] = (providers[e.provider] || 0) + 1;
    }
    out[label] = {
      messages: count("message"),
      commands: count("command"),
      aiRequests: aiCalls,
      errors: count("error"),
      downloads: count("download"),
      incidents: count("incident"),
      aiFailures: aiFail,
      latencyMs: avgLatency,
      aiSuccessRate: aiCalls ? Math.round((okCount("ai") / aiCalls) * 100) : 100,
      providers,
    };
  }
  return out;
}

// ── Live ARIA core status ─────────────────────────────────────
function liveStatus() {
  const os = require("os");
  const botAdmin = tryLoad("./botAdmin");
  const stats = botAdmin ? botAdmin.getStats() : null;
  const durable = tryLoad("./durableMissions");
  const missions = durable && durable.getAllMissions ? durable.getAllMissions() : [];
  const activeMissions = missions.filter((m) => m.status === "running" || m.status === "pending").length;
  const mem = tryLoad("./utils/semanticMemory");
  let memoryCount = 0;
  try { const store = mem && mem.getUserStore ? mem.getUserStore("*") : null; memoryCount = store?.memories?.length || 0; } catch (_) {}
  const recent = telemetry.events.filter((e) => e.t >= Date.now() - 60000);
  const msgsPerMin = recent.filter((e) => e.type === "message").length;
  const aiEvents = telemetry.events.filter((e) => e.type === "ai" && e.t >= Date.now() - 5 * 60000);
  const lat = aiEvents.filter((e) => e.latency != null);
  const avgLatency = lat.length ? Math.round(lat.reduce((a, b) => a + b.latency, 0) / lat.length) : 0;
  const lastAI = aiEvents[aiEvents.length - 1];
  const errs = telemetry.events.filter((e) => e.type === "error" && e.t >= Date.now() - 5 * 60000).length;

  // Primary + fallback AI providers (best-effort from env order).
  const order = ["CEREBRAS", "GEMINI", "GROQ", "OPENROUTER"];
  const enabled = order.filter((k) => process.env[k + "_API_KEY"]);
  const primary = (enabled[0] || "none").toLowerCase();
  const fallback = (enabled[1] || "none").toLowerCase();

  return {
    online: true,
    uptimeHrs: Math.floor(process.uptime() / 3600),
    memMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    cpuCores: os.cpus()?.length || 0,
    primary, fallback,
    lastProvider: lastAI?.provider || primary,
    lastLatency: lastAI?.latency != null ? Math.round(lastAI.latency) : avgLatency || 0,
    avgLatency,
    msgsPerMin,
    memoryCount,
    activeMissions,
    totalMissions: missions.length,
    errors5m: errs,
    messages: stats?.messages || 0,
    commands: stats?.commands || 0,
    providerHealth: (() => {
      try { return require("./providerHealth").getHealth(); } catch (_) { return { results: [], runtime: {}, lastCheckedAt: null, checking: false }; }
    })(),
  };
}

// ── Academy intelligence ──────────────────────────────────────
function academyData() {
  const lm = tryLoad("./academy/learnerModel");
  const ce = tryLoad("./academy/curriculumEngine");
  const fe = tryLoad("./academy/forgettingEngine");
  const pw = tryLoad("./academy/projectWorkspace");
  const ae = tryLoad("./academy/assessmentEngine");

  // Learners
  const learners = lm && lm.getAllLearners ? lm.getAllLearners() : [];
  const learnerCount = learners.length;

  // Lessons (all tracks)
  let lessons = 0;
  try { const ov = ce.allTrackOverviews(); lessons = ov.reduce((s, l) => s + l.totalLessons, 0); } catch (_) {}

  // Challenges = count of coding_challenge sections across curriculum.
  let challenges = 0;
  try {
    for (const t of ce.allTracks()) {
      for (const level of Object.keys(ce.trackLessons(t.id) || {})) {
        for (const raw of ce.trackLessons(t.id)[level] || []) {
          const l = raw.sections ? raw : null;
          const sections = l ? l.sections : [];
          if (!sections.length) continue;
          challenges += sections.filter((s) => s.type === "coding_challenge").length;
        }
      }
    }
  } catch (_) {}

  // Projects
  let projects = 0;
  try {
    for (const track of Object.values(pw.PROJECTS || {}))
      for (const level of Object.values(track || {})) projects += (level || []).length;
  } catch (_) {}

  // Average mastery across all learners/tracks.
  let masterySum = 0, masteryCount = 0;
  for (const l of learners) {
    const rec = lm.learner(l.uid);
    for (const track of Object.values(rec.mastery || {}))
      for (const pct of Object.values(track || {})) { masterySum += pct; masteryCount++; }
  }
  const avgMastery = masteryCount ? Math.round(masterySum / masteryCount) : 0;

  // Most active track = track with the most attempts across learners.
  const trackAttempts = {};
  for (const l of learners) {
    const rec = lm.learner(l.uid);
    for (const a of rec.attempts || []) trackAttempts[a.track] = (trackAttempts[a.track] || 0) + 1;
  }
  const mostActiveTrack = Object.entries(trackAttempts).sort((a, b) => b[1] - a[1])[0] || null;

  // Weakest skill = lowest-confidence skill across learners with >=2 attempts.
  const skillConf = {};
  for (const l of learners) {
    const rec = lm.learner(l.uid);
    for (const [skill, s] of Object.entries(rec.skills || {})) {
      if (s.total < 2) continue;
      if (!skillConf[skill] || s.confidence < skillConf[skill].confidence)
        skillConf[skill] = { confidence: s.confidence, total: s.total };
    }
  }
  const weakestSkill = Object.entries(skillConf).sort((a, b) => a[1].confidence - b[1].confidence)[0] || null;

  // Streaks
  const streaks = learners.filter((l) => l.streak >= 2).length;

  // Top 5 by XP
  const top = learners.slice(0, 5);

  return { learnerCount, lessons, challenges, projects, avgMastery, mostActiveTrack, weakestSkill, streaks, top };
}

// ── Learner drill-down (Engineering DNA / career / roadmap) ────
function learnerProfile(uid) {
  const dnaMod = tryLoad("./academy/engineeringDNA");
  const lm = tryLoad("./academy/learnerModel");
  const xpMod = tryLoad("./academy/xpSystem");
  let dna = [], career = null, roadmapList = [], stats = { xp: 0, streak: 0, attempts: 0 }, tier = null;
  try { dna = dnaMod.engineeringDNA(uid); } catch (_) {}
  try { career = dnaMod.careerFit(uid); } catch (_) {}
  try { roadmapList = dnaMod.roadmap(uid, career?.top?.role); } catch (_) {}
  try { stats = lm.getStats(uid); } catch (_) {}
  try { tier = xpMod.tierFor(stats.xp); } catch (_) {}
  return { uid, dna, career: career?.top || null, careerRanked: career?.ranked || [], roadmapList, stats, tier };
}

// ── Incident center ───────────────────────────────────────────
function incidentData() {
  const inc = tryLoad("./academy/incidentSimulator");
  const lm = tryLoad("./academy/learnerModel");
  const ev = tryLoad("./academy/evidenceEngine");

  // Resolved incidents = correct incident evidence recorded in the learner model.
  let resolved = 0, critical = 0, active = 0;
  const latest = [];
  try {
    const all = lm ? Object.values(lm.learner("__all__") || {}) : [];
  } catch (_) {}
  // Derive from evidence across all learners.
  const incEvidence = [];
  try {
    const learners = lm.getAllLearners();
    for (const l of learners) {
      for (const e of ev.evidenceFor(l.uid, "incident") || ev.evidenceFor(l.uid) || []) {
        if (e.type === "incident" || e.sectionType === "incident") incEvidence.push(e);
      }
    }
  } catch (_) {}

  // Active incidents from incident simulator state (per-chat flows).
  let activeFlows = 0;
  try {
    const state = inc && inc._state ? inc._state : null;
    if (state && state.chats) activeFlows = Object.values(state.chats).filter((c) => c.step).length;
  } catch (_) {}
  active = activeFlows;

  // Resolved from evidence records with type incident.
  resolved = incEvidence.filter((e) => e.correct).length;

  // Latest incident info: from the standalone INCIDENTS list for display.
  const totalIncidents = inc && inc.INCIDENTS ? inc.INCIDENTS.length : 0;
  const latestIncident = inc && inc.INCIDENTS ? inc.INCIDENTS[inc.INCIDENTS.length - 1] : null;

  return { resolved, active, critical, totalIncidents, latestIncident };
}

// ── ARIA 'brain' pane ─────────────────────────────────────────
// Every metric is a CALCULABLE formula, never a hand-wavy score. Each returns
// { value, formula } so the dashboard can show not just the % but what it
// actually means.
const MEMORY_CAPACITY = 2000; // soft cap for the semantic store

function brainData() {
  const lm = tryLoad("./academy/learnerModel");
  const fe = tryLoad("./academy/forgettingEngine");
  const mem = tryLoad("./utils/semanticMemory");

  // Memory = used / capacity (capped at MEMORY_CAPACITY entries).
  let memoryCount = 0;
  try { const store = mem.getUserStore("*"); memoryCount = store?.memories?.length || 0; } catch (_) {}
  const memoryPct = Math.min(100, Math.round((memoryCount / MEMORY_CAPACITY) * 100));

  // Learning = average recall health across all learners (retained knowledge).
  let learning = 0, learningDenom = 0;
  try {
    const learners = lm.getAllLearners();
    for (const l of learners) { learning += fe.recallHealth(l.uid).health; learningDenom++; }
    learning = learningDenom ? Math.round(learning / learningDenom) : 0;
  } catch (_) { learning = 0; }

  // Automation = completed missions / total missions.
  let automation = 0, autoDenom = 0;
  try {
    const durable = tryLoad("./durableMissions");
    const missions = durable.getAllMissions();
    autoDenom = missions.length;
    automation = autoDenom ? Math.round(missions.filter((m) => m.status === "completed").length / autoDenom * 100) : 0;
  } catch (_) { automation = 0; }

  // Reliability = AI success rate over the last 30d (1 - failures/total).
  // When there's no AI traffic yet, report null ("no data") instead of a fake
  // number — a vibe % is worse than an honest "insufficient data".
  const a = analytics()["30d"] || {};
  let reliability = null, reliabilityDenom = a.aiRequests || 0;
  if (reliabilityDenom > 0) reliability = Math.round(((reliabilityDenom - (a.aiFailures || 0)) / reliabilityDenom) * 100);

  // Recurring failures: distinct error details occurring >=2x in the last 24h.
  const recurring = {};
  try {
    const now = Date.now();
    for (const e of telemetry.events) {
      if (e.type !== "error" || e.t < now - 86400000 || !e.detail) continue;
      const key = String(e.detail).slice(0, 60);
      recurring[key] = (recurring[key] || 0) + 1;
    }
  } catch (_) {}
  const recurringFailures = Object.entries(recurring).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4);

  // Current focus: from the most recent active mission objective.
  let focus = "Idle — no active mission";
  try {
    const durable = tryLoad("./durableMissions");
    const missions = durable.getAllMissions();
    const act = missions.find((m) => m.status === "running" || m.status === "pending");
    if (act && act.objective) focus = act.objective;
  } catch (_) {}

  // Provider reputation snapshot (anime source resolution).
  let providers = [];
  try {
    const { reputationReport } = require("./sourceResolver");
    providers = reputationReport();
  } catch (_) {}

  return {
    memory: { value: memoryPct, formula: `stored ${memoryCount} / capacity ${MEMORY_CAPACITY}` },
    learning: { value: learning, formula: `avg recall health over ${learningDenom} learner(s)` },
    automation: { value: automation, formula: `completed missions / total (${autoDenom})` },
    reliability: { value: reliability, formula: reliabilityDenom ? `(total - failures) / total over 30d (${reliabilityDenom} calls)` : "no AI traffic in 30d" },
    memoryCount,
    focus,
    recurringFailures,
    providers,
  };
}

module.exports = { record, analytics, liveStatus, academyData, learnerProfile, incidentData, brainData };
