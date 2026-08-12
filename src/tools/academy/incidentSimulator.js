// ── ARIA Academy — Production Incident Simulator ─────────────────
// The flagship: ARIA throws a realistic production incident at the learner —
// logs, metrics, traces, database status, deploy history — and they must
// diagnose the root cause, pick a fix, and "resolve" it. ARIA grades root
// cause, fix, time, and communication.
//
// Each incident has:
//   • scenario      — the situation text
//   • evidence      — { logs[], metrics, traces, db, deploy } to present
//   • rootCause     — the real diagnosis
//   • correctFix    — the right remediation
//   • distractors   — plausible but wrong diagnoses/fixes
//   • skills        — skill tags for the learner model
//
// Flow: !incident → pick a scenario (or random) → read evidence → submit
// diagnosis → submit fix → graded. Timer runs from start to resolution.

const fs = require("fs");
const path = require("path");
const { addXp, recordAttempt } = require("./learnerModel");

const STATE_FILE = path.join(__dirname, "../../../data/incidentState.json");

let state = { chats: {} };
function load() {
  try { if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || { chats: {} }; }
  catch (_) { state = { chats: {} }; }
}
function save() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) {} }
load();

// ── Incident definitions ───────────────────────────────────────
const INCIDENTS = [
  {
    id: "db-conn-pool",
    title: "Database connection pool exhaustion",
    difficulty: "medium",
    skills: ["sql-transactions", "backend"],
    scenario: "Users are reporting the app is timing out and throwing 500s. API latency jumped from 120ms to 4.8s.",
    evidence: {
      logs: [
        "[ERROR] connection pool exhausted: timeout waiting for connection from pool",
        "[WARN] slow query detected: 14.2s (SELECT * FROM orders WHERE user_id = ?)",
        "[WARN] 3500 connections open (max 100)",
        "[INFO] deploy: v2.4.1 rolled out 22:00 UTC",
      ],
      metrics: {
        "api_latency_ms": "120 → 4800",
        "error_rate_pct": "0.2 → 17",
        "db_connections": "14 → 3500",
        "cpu": "35% → 94%",
      },
      traces: [
        "GET /orders → db.query → BLOCKED (pool timeout)",
        "GET /orders → db.query → BLOCKED (pool timeout)",
      ],
      db: { status: "UP", connections: "3500 / 100 (exhausted)", slow_queries: "SELECT * FROM orders (14s)" },
      deploy: "v2.4.1 — 'add orders search' — 22:00 UTC",
    },
    rootCause: "A recent deploy added a search feature that runs SELECT * FROM orders with no index and no limit, opening a new connection per request and exhausting the 100-connection pool.",
    correctFix: "Add an index on the orders query columns, cap/limit the query, and reduce connection usage (pool size + reuse).",
    distractors: [
      "Restart the database server",
      "Upgrade the CPU",
      "Increase the connection pool to 5000",
      "Add a load balancer",
    ],
    commBad: "You didn't update anyone while investigating.",
  },
  {
    id: "memory-leak",
    title: "Slow memory leak after deploy",
    difficulty: "hard",
    skills: ["node", "backend"],
    scenario: "The Node.js service gradually climbs in memory and restarts every ~6 hours. Requests get slower before each restart.",
    evidence: {
      logs: [
        "[WARN] memory usage: 62% ... 78% ... 89% ... OOM restart",
        "[INFO] restart: reason=OOM killed",
        "[INFO] deploy: v3.0.0 added a 'cache' feature",
      ],
      metrics: {
        "memory_rss": "200MB → 1.8GB (climbs then OOM)",
        "api_latency_ms": "180 → 900 (rising)",
        "restarts": "0 → 4 in 24h",
      },
      traces: [
        "POST /upload → cache.set() → retains reference",
        "POST /upload → cache.set() → retains reference",
      ],
      db: { status: "UP", connections: "32 / 100" },
      deploy: "v3.0.0 — 'add in-memory cache' — 3 days ago",
    },
    rootCause: "The new 'cache' feature stores every uploaded file in an in-memory Map with no eviction or size limit, so memory grows unbounded until the OOM killer restarts the process.",
    correctFix: "Add a bounded cache (LRU) with a max size and TTL, or move to an external cache like Redis. Ensure references aren't retained unboundedly.",
    distractors: [
      "Add more RAM to the server",
      "Restart the service manually on a schedule",
      "Disable the /upload endpoint",
      "Increase the Node heap limit",
    ],
  },
  {
    id: "slow-query-index",
    title: "Slow queries after data growth",
    difficulty: "medium",
    skills: ["sql-index", "backend"],
    scenario: "A reporting endpoint that used to return in 300ms now takes 20s. It only started slowing down as the table grew.",
    evidence: {
      logs: [
        "[WARN] seq scan on users (500M rows) for query: SELECT * FROM users WHERE email = ?",
        "[WARN] query time: 19.8s",
      ],
      metrics: { "report_latency_ms": "300 → 20000", "db_cpu": "40% → 98%" },
      traces: ["GET /api/report → db.query → seq scan (20s)"],
      db: { status: "UP", connections: "22 / 100", slow_queries: "users.email seq scan" },
      deploy: "No recent deploy",
    },
    rootCause: "As the users table grew to 500M rows, the query on users.email does a full sequential scan because there's no index on the email column.",
    correctFix: "Create an index on users(email).",
    distractors: [
      "Add more RAM",
      "Shard the table by id",
      "Rewrite in another language",
      "Increase connection pool",
    ],
  },
];

function randomIncident() {
  return INCIDENTS[Math.floor(Math.random() * INCIDENTS.length)];
}

function hasActiveFlow(chatId) {
  return !!(state.chats[chatId] && state.chats[chatId].step);
}

// Start an incident. Optionally specify by id/name.
function start(chatId, uid, arg) {
  let inc = arg ? INCIDENTS.find((i) => i.id === arg || i.title.toLowerCase().includes(String(arg).toLowerCase())) : null;
  inc = inc || randomIncident();
  state.chats[chatId] = { uid, step: "evidence", inc: inc.id, startedAt: Date.now(), submittedDiagnosis: false };
  save();
  return evidenceView(chatId);
}

function evidenceView(chatId) {
  const st = state.chats[chatId];
  const inc = INCIDENTS.find((i) => i.id === st.inc);
  const e = inc.evidence;
  const metrics = Object.entries(e.metrics).map(([k, v]) => `${k}: ${v}`).join("\n");
  return {
    text: `🚨 *PRODUCTION INCIDENT*\n\n*${inc.title}*\n\n*Situation:* ${inc.scenario}\n\n*Logs:*\n${e.logs.map((l) => `\`${l}\``).join("\n")}\n\n*Metrics:*\n\`\`\`\n${metrics}\n\`\`\`\n\n*Traces:*\n${e.traces.join("\n")}\n\n*Database:* ${e.db.status} · ${e.db.connections} · ${e.db.slow_queries || "no slow queries"}\n\n*Recent deploy:* ${e.deploy}\n\n🔍 Reply with your *diagnosis* (what's the root cause?).`,
    inc,
    phase: "diagnosis",
  };
}

function diagnosisView(chatId) {
  const st = state.chats[chatId];
  const inc = INCIDENTS.find((i) => i.id === st.inc);
  return {
    text: `You said the root cause is:\n\n"${st.diagnosis}"\n\nNow reply with your *fix* (what would you do to resolve it?).`,
    inc,
    phase: "fix",
  };
}

// Grade the diagnosis. Returns { correct, verdict }.
function gradeDiagnosis(inc, answer) {
  const a = String(answer).toLowerCase();
  // Match on key tokens of the root cause.
  const tokens = inc.rootCause.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
  const matched = tokens.filter((t) => a.includes(t)).length;
  const ratio = matched / tokens.length;
  return { correct: ratio >= 0.4, score: ratio };
}

function gradeFix(inc, answer) {
  const a = String(answer).toLowerCase();
  const tokens = inc.correctFix.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
  const matched = tokens.filter((t) => a.includes(t)).length;
  const ratio = matched / tokens.length;
  return { correct: ratio >= 0.4, score: ratio };
}

function handleReply(chatId, uid, input) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return null;

  if (st.step === "evidence") {
    // First answer = diagnosis.
    st.diagnosis = input.trim();
    st.diagnosisAt = Date.now();
    st.step = "fix";
    save();
    return diagnosisView(chatId);
  }

  if (st.step === "fix") {
    const inc = INCIDENTS.find((i) => i.id === st.inc);
    const dg = gradeDiagnosis(inc, st.diagnosis);
    const fx = gradeFix(inc, input.trim());
    const elapsedMin = ((Date.now() - st.startedAt) / 60000).toFixed(1);

    // Record attempts for learner model.
    recordAttempt(uid, { track: "incident", level: inc.difficulty, lessonId: inc.id, sectionType: "incident", correct: dg.correct, skill: inc.skills[0] });
    recordAttempt(uid, { track: "incident", level: inc.difficulty, lessonId: inc.id, sectionType: "incident-fix", correct: fx.correct, skill: inc.skills[0] });

    // XP: correct diagnosis + fix.
    let xp = 0;
    if (dg.correct) xp += 40;
    if (fx.correct) xp += 60;
    if (xp) addXp(uid, xp);

    const root = dg.correct ? "✅" : "❌";
    const fix = fx.correct ? "✅" : "❌";
    const verdict = `🚨 *Incident resolved — debrief*\n\n*Diagnosis:* ${root} ${dg.correct ? "Correct!" : "Missed."}\n_Actual root cause:_ ${inc.rootCause}\n\n*Fix:* ${fix} ${fx.correct ? "Correct!" : "Missed."}\n_Right fix:_ ${inc.correctFix}\n\n*Time:* ${elapsedMin} min\n*XP earned:* +${xp}\n\nPlausible wrong answers: ${inc.distractors.join(" · ")}\n\nReply *again* for a new incident, or *done* to stop.`;

    delete state.chats[chatId];
    save();
    return { text: verdict, graded: true };
  }

  return null;
}

// Command: !incident [name]
async function handleIncidentCommand(sock, msg, args, ctx) {
  const { reply } = require("../../utils/baileysHelpers");
  const uid = (ctx.senderJid || "").split("@")[0];
  const arg = (Array.isArray(args) ? args.join(" ") : args || "").trim();
  const r = start(ctx.chatId, uid, arg || undefined);
  return reply(sock, msg, r.text);
}

module.exports = { handleIncidentCommand, start, handleReply, hasActiveFlow, INCIDENTS };
