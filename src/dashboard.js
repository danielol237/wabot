// ARIA Dashboard — clean sidebar + card-grid control room
// Mounted on /dashboard in index.js
// Real auth + session, light theme, reference-grade layout.

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const router = express.Router();

const SESSION_TTL = 12 * 60 * 60 * 1000;
const SESSIONS_FILE = path.join(__dirname, "../data/dashboardSessions.json");
const CSRF_SECRET = process.env.DASHBOARD_CSRF_SECRET || process.env.DASHBOARD_PASSWORD || "aria-csrf";

// ── Persisted sessions ────────────────────────────────────────────
// Sessions survive process restarts and are shared across instances by
// writing to a JSON file. Prune + persist on every change.
const sessions = new Map();
function hashToken(t) {
  return crypto.createHash("sha256").update(String(t)).digest("hex");
}
function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
    for (const [k, v] of Object.entries(raw || {})) {
      // Store only the SHA-256 of the token — the persistent file must not
      // contain reusable credentials. Keys from older plaintext files are
      // hashed on load so a leaked file is useless.
      const key = /^[a-f0-9]{64}$/.test(k) ? k : hashToken(k);
      if (v && v.expires && v.expires > Date.now()) sessions.set(key, v.expires);
    }
  } catch (_) {}
}
function persistSessions() {
  const now = Date.now();
  const out = {};
  for (const [k, v] of sessions) {
    if (v > now) out[k] = { expires: v };
    else sessions.delete(k);
  }
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(out)); } catch (_) {}
}
loadSessions();

// Cookie reader — must run BEFORE the CSRF guards (which read req.cookies).
router.use((req, res, next) => {
  const raw = req.headers.cookie || "";
  req.cookies = {};
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) req.cookies[k] = decodeURIComponent(v.join("=") || "");
  }
  next();
});

// JSON body parsing for the /api routes (must run before the CSRF guards
// below, which read req.body). Login stays raw so its form body is untouched.
router.use("/api", express.json());

// ── CSRF (stateless, derived from the session cookie) ─────────────
function csrfFor(req) {
  const token = req.cookies?.["aria_session"] || "";
  return crypto.createHmac("sha256", CSRF_SECRET).update(token).digest("hex").slice(0, 32);
}
function csrfOk(req) {
  const given = req.body?._csrf || req.query?._csrf || "";
  return !!given && given === csrfFor(req);
}

// Guard every state-changing POST on the dashboard (logout, anime retry,
// health checks, etc.) with the same CSRF check — one consistent policy instead
// of ad-hoc guards. /login is excluded: there's no session yet, and the login
// throttle already mitigates abuse.
router.post("*", (req, res, next) => {
  if (req.path === "/login") return next();
  if (!csrfOk(req)) return res.status(403).json({ error: "Invalid or missing CSRF token." });
  next();
});

// ── Login rate limiting (#20) ─────────────────────────────────────
const loginAttempts = new Map(); // ip -> { count, resetAt }
function isLoginThrottled(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) return false;
  return rec.count >= 8; // 8 attempts / 15 min
}
function recordLoginAttempt(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  rec.count++;
  loginAttempts.set(ip, rec);
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkAuth(req, res, next) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return res.send(renderPage("Locked", "", true));
  const token = req.cookies?.["aria_session"];
  const h = hashToken(token);
  if (token && sessions.get(h) && sessions.get(h) > Date.now()) return next();
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) {
    if (constantTimeEqual(auth.slice(7), pw)) {
      const t = crypto.randomBytes(24).toString("hex");
      sessions.set(hashToken(t), Date.now() + SESSION_TTL);
      persistSessions();
      res.cookie("aria_session", t, { httpOnly: true, maxAge: SESSION_TTL, sameSite: "lax" });
      return next();
    }
  } else if (auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      if (constantTimeEqual(decoded.split(":")[1] || "", pw)) {
        const t = crypto.randomBytes(24).toString("hex");
        sessions.set(hashToken(t), Date.now() + SESSION_TTL);
        res.cookie("aria_session", t, { httpOnly: true, maxAge: SESSION_TTL, sameSite: "lax" });
        return next();
      }
    } catch (_) {}
  }
  return res.status(401).send(renderPage("Login", loginForm(), false, true));
}

function loginForm() {
  return `<div class="login">
    <div class="login-logo">◢</div>
    <h1>ARIA</h1>
    <p>personal intelligence cockpit</p>
    <form method="POST" action="/dashboard/login">
      <input type="password" name="password" placeholder="access key" autofocus required />
      <button class="btn btn-primary btn-block" type="submit">Enter</button>
    </form>
    ${process.env.DASHBOARD_PASSWORD ? "" : '<p class="hint">Set DASHBOARD_PASSWORD in env</p>'}
  </div>`;
}

router.post("/login", (req, res) => {
  const pw = process.env.DASHBOARD_PASSWORD;
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  if (isLoginThrottled(ip)) {
    return res.status(429).send(renderPage("Login", loginForm() + '<p class="error">Too many attempts. Try again later.</p>', false, true));
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const supplied = new URLSearchParams(body).get("password") || "";
    if (pw && constantTimeEqual(supplied, pw)) {
      loginAttempts.delete(ip);
      const t = crypto.randomBytes(24).toString("hex");
      sessions.set(hashToken(t), Date.now() + SESSION_TTL);
      persistSessions();
      res.cookie("aria_session", t, { httpOnly: true, maxAge: SESSION_TTL, sameSite: "lax" });
      return res.redirect("/dashboard");
    }
    recordLoginAttempt(ip);
    return res.status(401).send(renderPage("Login", loginForm() + '<p class="error">Wrong key.</p>', false, true));
  });
});

router.post("/logout", (req, res) => {
  const token = req.cookies?.["aria_session"];
  if (token) { sessions.delete(hashToken(token)); persistSessions(); }
  res.clearCookie("aria_session");
  res.redirect("/dashboard");
});

function tryLoad(mod) { try { return require(mod); } catch (_) { return null; } }

function collectData() {
  const os = require("os");
  const uptime = Math.floor(process.uptime());
  const hrs = Math.floor(uptime / 3600), mins = Math.floor((uptime % 3600) / 60);
  const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

  const botAdmin = tryLoad("./tools/botAdmin");
  const stats = botAdmin ? botAdmin.getStats() : null;
  const errors = botAdmin ? (botAdmin.getRecentErrors ? botAdmin.getRecentErrors(6) : []) : [];
  const durable = tryLoad("./tools/durableMissions");
  const missions = durable && durable.getAllMissions ? durable.getAllMissions() : [];
  const activeMissions = missions.filter((m) => m.status === "running" || m.status === "pending");
  const mem = tryLoad("./utils/semanticMemory");
  let memories = [];
  try { const store = mem && mem.getUserStore ? mem.getUserStore("*") : null; memories = store?.memories || []; } catch (_) {}
  let mediaMem = [];
  try { const mm = tryLoad("./tools/mediaMemory"); mediaMem = mm && mm.getAllMedia ? mm.getAllMedia("*", 10) : []; } catch (_) {}
  let households = [];
  try { const hh = tryLoad("./tools/household"); households = hh && hh.listHouseholds ? hh.listHouseholds() : []; } catch (_) {}
  const aiKeys = ["OPENROUTER_API_KEY","GROQ_API_KEY","CEREBRAS_API_KEY","GEMINI_API_KEY","TAVILY_API_KEY","ELEVENLABS_API_KEY"];
  const keysSet = aiKeys.filter((k) => process.env[k]).length;

  return { os, hrs, mins, memMB, stats, errors, missions, activeMissions, memories, mediaMem, households, keysSet, aiKeys };
}

// Anime download job panel — reads live state from the anime job manager.
function renderDownloadsPane() {
  let snap;
  try { snap = require("./tools/animeJobManager").snapshot(); } catch (_) { snap = null; }
  if (!snap) {
    return `<div class="pane" id="pane-downloads"><div class="page-title">Downloads</div><div class="page-sub">anime pipeline</div><div class="card"><div class="empty">Job manager unavailable.</div></div></div>`;
  }

  const statusBadge = (s) =>
    s === "done" ? '<span class="badge b-green">done</span>'
    : s === "failed" ? '<span class="badge b-red">failed</span>'
    : s === "running" ? '<span class="badge b-accent">running</span>'
    : '<span class="badge b-muted">queued</span>';

  const jobCard = (j) => `
    <div class="card" data-job="${j.id}">
      <div class="h"><span>${j.name} — Ep ${j.episode}</span>${statusBadge(j.status)}</div>
      ${j.current ? `<div class="row"><span class="k">stage</span><span class="v">${j.current.provider} · ${j.current.stage}</span></div>` : ""}
      ${j.steps.length ? `<div class="feed" style="margin-top:6px">${j.steps.slice(-8).map((s)=>`<div class="feed-item"><div class="feed-ico" style="color:${s.ok?"var(--green)":"var(--red)"}">${s.ok?"✓":"✗"}</div><div class="feed-body"><div class="m">${s.provider} ${s.stage}</div><div class="s">${s.message||""}</div></div></div>`).join("")}</div>` : ""}
      ${j.result ? `<div class="row"><span class="k">file</span><span class="v">${(j.result.size/1024/1024).toFixed(1)} MB · ${j.result.provider}</span></div>` : ""}
      ${j.error ? `<div class="row"><span class="k" style="color:var(--red)">error</span><span class="v" style="color:var(--red)">${j.error.code}: ${j.error.message}</span></div>` : ""}
      ${j.status === "failed" ? `<button class="qbtn" style="margin-top:10px" onclick="retryJob('${j.id}')">↻ Retry</button>` : ""}
    </div>`;

  const active = [...snap.current, ...snap.queued];
  return `
    <div class="pane" id="pane-downloads"><div class="page-title">Downloads</div><div class="page-sub">anime pipeline · live</div>
      <div class="stats">
        <div class="stat"><div class="n">${active.length}</div><div class="l">active / queued</div></div>
        <div class="stat"><div class="n">${snap.counts.done}</div><div class="l">completed</div></div>
        <div class="stat"><div class="n">${snap.counts.failed}</div><div class="l">failed</div></div>
        <div class="stat"><div class="n">${snap.counts.running}</div><div class="l">downloading now</div></div>
      </div>
      <div class="grid2" id="downloads-active">
        ${active.length ? active.map(jobCard).join("") : `<div class="card"><div class="empty">No downloads running. Send !animedl in chat.</div></div>`}
      </div>
      <div class="card" style="margin-top:16px"><div class="h">Recent</div>
        ${snap.recent.length ? snap.recent.map(jobCard).join("") : `<div class="empty">No finished jobs yet.</div>`}
      </div>
    </div>`;
}

// Health pane — anime source + AI provider probe results.
function healthRow(item) {
  const ok = !!item.ok;
  return `<div class="row"><span class="k">${item.name}</span><span class="v"><span class="badge ${ok ? "b-green" : "b-red"}">${ok ? "healthy" : item.error || "down"}</span>${item.latency ? ` · ${item.latency}ms` : ""}${item.status ? ` · HTTP ${item.status}` : ""}</span></div>`;
}

function renderHealthPane() {
  let src = [], prov = [], srcChecked = null, provChecked = null;
  try { const s = require("./tools/sourceHealth").getHealth(); src = s.results || []; srcChecked = s.lastCheckedAt; } catch (_) {}
  try { const p = require("./tools/providerHealth").getHealth(); prov = p.results || []; provChecked = p.lastCheckedAt; } catch (_) {}
  const ts = (t) => (t ? new Date(t).toLocaleTimeString() : "not checked");
  return `
    <div class="pane" id="pane-health"><div class="page-title">Health</div><div class="page-sub">sources & AI providers · live probes</div>
      <div class="card"><div class="h">Anime Sources <span class="badge b-accent">checked ${ts(srcChecked)}</span></div>
        ${src.length ? src.map(healthRow).join("") : `<div class="empty">Not checked yet. Click "Re-check sources".</div>`}
        <button class="qbtn" style="margin-top:12px" onclick="checkSources()">↻ Re-check sources</button>
      </div>
      <div class="card" style="margin-top:16px"><div class="h">AI Providers <span class="badge b-accent">checked ${ts(provChecked)}</span></div>
        ${prov.length ? prov.map(healthRow).join("") : `<div class="empty">Not checked yet. Click "Re-check providers".</div>`}
        <button class="qbtn" style="margin-top:12px" onclick="checkProviders()">↻ Re-check providers</button>
      </div>
    </div>`;
}

// Logs pane — live console fed by the SSE stream, with severity filter + search.
function renderLogsPane() {
  let logs = [];
  try { logs = require("./utils/logStream").getRecent(80); } catch (_) {}
  const fmtTime = (t) => new Date(t).toLocaleTimeString();
  const levelBadge = (lvl) => ({
    error: '<span class="badge b-red">ERROR</span>',
    warn: '<span class="badge b-amber">WARN</span>',
    debug: '<span class="badge b-muted">DEBUG</span>',
  }[lvl] || '<span class="badge b-accent">INFO</span>');
  return `
    <div class="pane" id="pane-logs"><div class="page-title">Logs</div><div class="page-sub">live stream · severity + search</div>
      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        <select id="log-level" onchange="filterLogs()" style="background:var(--panel);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:10px;font-size:13px">
          <option value="">All levels</option>
          <option value="error">Errors</option>
          <option value="warn">Warnings</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
        <input id="log-search" placeholder="Search logs…" oninput="filterLogs()" style="flex:1;min-width:180px;background:var(--panel);border:1px solid var(--line);color:var(--text);padding:8px 12px;border-radius:10px;font-size:13px;outline:none" />
        <span style="color:var(--faint);font-size:11px" id="log-status">● live</span>
      </div>
      <div class="card" id="log-console" style="max-height:62vh;overflow:auto;font-family:ui-monospace,Consolas,monospace;font-size:11.5px">
        ${logs.map((e) => `<div class="log-line" data-level="${e.level}" data-msg="${e.message.toLowerCase().replace(/"/g, "&quot;")}" style="padding:3px 0;border-bottom:1px solid var(--line);color:var(--muted)"><span style="color:var(--faint)">${fmtTime(e.ts)}</span> ${levelBadge(e.level)} <span>${e.message.replace(/</g, "&lt;").slice(0, 500)}</span></div>`).join("") || `<div class="empty">No logs yet.</div>`}
      </div>
    </div>`;
}

function renderStudyPane() {
  let overview = [];
  try { overview = require("./tools/studySystem").getCurriculumOverview(); } catch (_) {}
  return `<div class="pane" id="pane-study"><div class="page-title">Study</div><div class="page-sub">ARIA curriculum · 8 languages</div>
    <div class="card"><div class="h">Curricula</div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
        ${overview.map((l) => `<div class="mini-card" style="border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--panel2)">
          <div style="font-weight:700;margin-bottom:2px">${l.name}</div>
          <div style="color:var(--muted);font-size:12px">${l.tagline}</div>
          <div style="color:var(--faint);font-size:11px;margin-top:6px">${l.levels} levels · ${l.totalLessons} lessons</div>
        </div>`).join("")}
      </div>
      <div class="row" style="margin-top:14px"><span class="k">Total lessons</span><span class="v">${overview.reduce((s, l) => s + l.totalLessons, 0)}</span></div>
      <div class="feed-item" style="margin-top:8px"><div class="feed-ico">📱</div><div class="feed-body"><div class="m">Use <b>!study</b> in a chat — pick a language, then a level (🌱 beginner → 👑 pro), and ARIA walks you through each lesson.</div></div></div>
    </div>
  </div>`;
}

function renderPage(title, content, passwordNeeded = false, isLogin = false, csrf = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title} · ARIA</title>
<style>
:root{
  --bg:#f6f7ff; --panel:#ffffff; --panel2:#f1f2fb; --panel3:#eceefb; --line:#e6e8f5; --line2:#d6daf0;
  --text:#1a1f3a; --muted:#6a7290; --faint:#97a0bf;
  --accent:#7c5cff; --accent2:#5b8cff; --cyan:#3dd6ff; --green:#22c55e; --amber:#f59e0b; --red:#ef4444;
  --shadow:0 1px 3px rgba(30,34,90,.06),0 6px 20px rgba(30,34,90,.05);
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,'Segoe UI',system-ui,sans-serif;background:linear-gradient(160deg,#eef0ff 0%,#f6f7ff 40%,#f0f6ff 100%);color:var(--text);min-height:100vh;background-attachment:fixed}
.mono{font-family:ui-monospace,Consolas,monospace}

.app{display:flex;min-height:100vh}
.sidebar{width:236px;flex-shrink:0;background:#fff;border-right:1px solid var(--line);padding:22px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.sb-brand{display:flex;align-items:center;gap:10px;padding:0 8px;margin-bottom:24px}
.sb-logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:800}
.sb-name{font-size:17px;font-weight:800;color:var(--text)}
.sb-name small{display:block;font-size:11px;color:var(--muted);font-weight:600}
.sb-group{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);font-weight:700;padding:0 10px;margin:14px 0 6px}
.navitem{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer;transition:.15s;border:1px solid transparent}
.navitem .ico{font-size:16px;width:20px;text-align:center}
.navitem:hover{background:var(--panel2);color:var(--text)}
.navitem.active{background:rgba(124,92,255,.1);color:var(--accent);border-color:rgba(124,92,255,.18)}
.sb-bottom{margin-top:auto;padding-top:16px;border-top:1px solid var(--line)}
.sb-online{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);padding:0 12px;margin-bottom:12px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green)}
.logout{width:100%;background:none;border:1px solid var(--line);color:var(--muted);border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer}
.logout:hover{color:var(--red);border-color:rgba(239,68,68,.4)}

.main{flex:1;padding:30px 34px 60px;max-width:1100px}
.page-title{font-size:26px;font-weight:800;color:var(--text)}
.page-sub{color:var(--muted);font-size:13px;margin-bottom:22px}

.hero{background:linear-gradient(120deg,#fff 0%,#f7f8ff 100%);border:1px solid var(--line);border-radius:18px;padding:22px;margin-bottom:20px;box-shadow:var(--shadow)}
.hero .hrow{display:flex;align-items:center;gap:14px}
.hero .avatar{width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,var(--accent),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;color:#fff}
.hero h2{font-size:18px;font-weight:800;display:flex;align-items:center;gap:10px}
.hero .sub{color:var(--muted);font-size:13px;margin-top:3px}
.actions{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
.qbtn{display:inline-flex;align-items:center;gap:7px;padding:10px 16px;border-radius:11px;font-size:13px;font-weight:700;cursor:pointer;border:none;background:var(--panel2);color:var(--text);transition:.15s}
.qbtn:hover{transform:translateY(-1px);box-shadow:var(--shadow)}
.qbtn.purple{background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;box-shadow:var(--shadow)}
.stat .n{font-size:26px;font-weight:800}
.stat .l{color:var(--muted);font-size:12px;margin-top:3px}

.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:var(--shadow)}
.card .h{font-size:13px;font-weight:800;color:var(--text);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
.card .h .badge{font-size:10px;padding:2px 9px;border-radius:99px}
.row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}
.row:last-child{border:none}
.row .k{color:var(--muted)}
.row .v{font-weight:600;text-align:right}
.feed{display:flex;flex-direction:column}
.feed-item{display:flex;gap:11px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}
.feed-item:last-child{border:none}
.feed-ico{width:32px;height:32px;border-radius:9px;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.feed .t{font-weight:600}
.feed .m{color:var(--muted);font-size:12px}
.feed .s{color:var(--faint);font-size:11px}
.badge{display:inline-block;padding:2px 9px;border-radius:99px;font-size:10px;font-weight:700}
.b-green{background:rgba(34,197,94,.13);color:var(--green)}
.b-red{background:rgba(239,68,68,.12);color:var(--red)}
.b-amber{background:rgba(245,158,11,.13);color:var(--amber)}
.b-accent{background:rgba(124,92,255,.13);color:var(--accent)}
.b-muted{background:var(--panel2);color:var(--muted)}
.empty{text-align:center;padding:22px;color:var(--faint);font-size:12px}
.pane{display:none}
.pane.show{display:block;animation:fade .25s}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.login{width:100%;max-width:380px;background:var(--panel);border:1px solid var(--line2);border-radius:22px;padding:38px 30px;text-align:center;box-shadow:var(--shadow)}
.login-logo{width:56px;height:56px;margin:0 auto 14px;border-radius:16px;background:linear-gradient(135deg,var(--accent),var(--cyan));display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:800}
.login h1{font-size:20px;font-weight:800}
.login p{color:var(--muted);font-size:13px;margin:8px 0 22px}
.login input{width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--text);padding:13px;border-radius:11px;font-size:15px;outline:none;margin-bottom:12px}
.login input:focus{border-color:var(--accent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 18px;border-radius:11px;border:none;font-size:14px;font-weight:700;cursor:pointer;background:var(--panel2);color:var(--text)}
.btn-primary{background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff}
.btn-block{width:100%}
.error{color:var(--red);margin-top:12px;font-size:13px}
.hint{color:var(--faint);margin-top:12px;font-size:11px}

@media(max-width:820px){
  .sidebar{width:72px;padding:18px 8px}
  .sb-name,.sb-group,.navitem span:not(.ico),.sb-online span{display:none}
  .navitem{justify-content:center;padding:12px}
  .navitem .ico{font-size:20px}
  .sb-brand{justify-content:center;padding:0}
  .main{padding:20px 16px 60px}
  .grid2{grid-template-columns:1fr}
}
</style>
</head>
<body>
${isLogin ? `<div class="login-wrap">${content}</div>` : `
<div class="app">
  <aside class="sidebar">
    <div class="sb-brand"><div class="sb-logo">◢</div><div class="sb-name">ARIA<small>control room</small></div></div>
    <div class="sb-group">Workspace</div>
    <div class="navitem active" data-pane="home"><span class="ico">◉</span><span>Home</span></div>
    <a class="navitem" style="text-decoration:none" href="/dashboard/anime"><span class="ico">🎬</span><span>Anime</span></a>
    <div class="navitem" data-pane="missions"><span class="ico">◆</span><span>Missions</span></div>
    <div class="navitem" data-pane="memory"><span class="ico">🧠</span><span>Memory</span></div>
    <div class="navitem" data-pane="media"><span class="ico">🖼️</span><span>Media</span></div>
    <div class="navitem" data-pane="downloads"><span class="ico">⬇️</span><span>Downloads</span></div>
    <div class="navitem" data-pane="household"><span class="ico">🏠</span><span>Household</span></div>
    <div class="navitem" data-pane="study"><span class="ico">🎓</span><span>Study</span></div>
    <div class="sb-group">System</div>
    <div class="navitem" data-pane="activity"><span class="ico">📈</span><span>Activity</span></div>
    <div class="navitem" data-pane="system"><span class="ico">🛠️</span><span>System</span></div>
    <div class="navitem" data-pane="health"><span class="ico">❤️</span><span>Health</span></div>
    <div class="navitem" data-pane="logs"><span class="ico">📜</span><span>Logs</span></div>
    <div class="navitem" data-pane="admin"><span class="ico">🔐</span><span>Admin</span></div>
    <div class="sb-bottom">
      <div class="sb-online"><span class="dot"></span><span>ARIA online</span></div>
      <form method="POST" action="/dashboard/logout">${csrf ? `<input type="hidden" name="_csrf" value="${csrf}" />` : ""}<button class="logout">Leave dashboard</button></form>
    </div>
  </aside>
  <main class="main">
    ${passwordNeeded ? `<div class="card"><div class="empty">Set DASHBOARD_PASSWORD in env to access.</div></div>` : content}
  </main>
</div>
`}
<script>
const CSRF=${JSON.stringify(csrf || "")};
const titles={home:['Home',"what's she up to"],missions:['Missions','what ARIA is building'],memory:['Memory','what she remembers'],media:['Media','images & voice'],downloads:['Downloads','anime pipeline'],household:['Household','shared space'],study:['Study','curriculum'],activity:['Activity','what she did'],system:['System','health'],health:['Health','sources & providers'],logs:['Logs','live console'],admin:['Admin','access']};
const navs=document.querySelectorAll('.navitem');
function showPane(p){
  navs.forEach(n=>n.classList.toggle('active',n.dataset.pane===p));
  document.querySelectorAll('.pane').forEach(x=>x.classList.remove('show'));
  const el=document.getElementById('pane-'+p); if(el)el.classList.add('show');
  const t=titles[p]||['','']; const pt=document.querySelector('.page-title'); const ps=document.querySelector('.page-sub');
  if(pt)pt.textContent=t[0]; if(ps)ps.textContent=t[1];
}
navs.forEach(n=>n.addEventListener('click',()=>showPane(n.dataset.pane)));
showPane('home');
// Live downloads panel — refresh just this pane via the JSON API (no full reload).
async function refreshDownloads(){
  const pane=document.getElementById('pane-downloads');
  if(!pane || !pane.classList.contains('show')) return;
  try{
    const r=await fetch('/dashboard/api/anime',{headers:{'Accept':'application/json'}});
    if(!r.ok) return;
    const snap=await r.json();
    const active=[...snap.current,...snap.queued];
    const counts=snap.counts||{};
    document.querySelectorAll('#pane-downloads .stat .n').forEach((el,i)=>{
      const vals=[active.length,counts.done,counts.failed,counts.running];
      if(i<vals.length) el.textContent=vals[i];
    });
  }catch(_){}
}
async function retryJob(id){
  try{
    const r=await fetch('/dashboard/api/anime/'+id+'/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_csrf:CSRF})});
    if(r.ok) setTimeout(refreshDownloads,500);
  }catch(_){}
}
async function checkSources(){
  try{
    await fetch('/dashboard/api/source-health/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_csrf:CSRF})});
    setTimeout(()=>location.reload(),600);
  }catch(_){}
}
async function checkProviders(){
  try{
    await fetch('/dashboard/api/provider-health/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_csrf:CSRF})});
    setTimeout(()=>location.reload(),600);
  }catch(_){}
}
// Live log console — SSE stream + client-side filter.
const fmtT=(t)=>new Date(t).toLocaleTimeString();
const lvlBadge=(l)=>l==='error'?'<span class="badge b-red">ERROR</span>':l==='warn'?'<span class="badge b-amber">WARN</span>':l==='debug'?'<span class="badge b-muted">DEBUG</span>':'<span class="badge b-accent">INFO</span>';
function logLine(e){
  return '<div class="log-line" data-level="'+e.level+'" data-msg="'+String(e.message).toLowerCase().replace(/"/g,'&quot;')+'" style="padding:3px 0;border-bottom:1px solid var(--line);color:var(--muted)"><span style="color:var(--faint)">'+fmtT(e.ts)+'</span> '+lvlBadge(e.level)+' <span>'+String(e.message).replace(/</g,'&lt;').slice(0,500)+'</span></div>';
}
function filterLogs(){
  const lvl=document.getElementById('log-level').value;
  const q=(document.getElementById('log-search').value||'').toLowerCase();
  document.querySelectorAll('#log-console .log-line').forEach(el=>{
    const show=(!lvl||el.dataset.level===lvl)&&(!q||el.dataset.msg.includes(q));
    el.style.display=show?'':'none';
  });
}
let evtSource=null;
function startLogStream(){
  if(evtSource) return;
  try{
    evtSource=new EventSource('/dashboard/api/logs/stream');
    evtSource.onmessage=(ev)=>{
      const consoleEl=document.getElementById('log-console');
      if(!consoleEl) return;
      try{
        const e=JSON.parse(ev.data);
        consoleEl.insertAdjacentHTML('beforeend',logLine(e));
        while(consoleEl.children.length>300) consoleEl.removeChild(consoleEl.firstChild);
        const lvl=document.getElementById('log-level').value;
        const q=(document.getElementById('log-search').value||'').toLowerCase();
        const line=consoleEl.lastChild;
        if((lvl&&line.dataset.level!==lvl)||(q&&!line.dataset.msg.includes(q))) line.style.display='none';
        consoleEl.scrollTop=consoleEl.scrollHeight;
      }catch(_){}
    };
    evtSource.onerror=()=>{ document.getElementById('log-status')&&(document.getElementById('log-status').textContent='● reconnecting'); };
    evtSource.onopen=()=>{ document.getElementById('log-status')&&(document.getElementById('log-status').textContent='● live'); };
  }catch(_){}
}
document.addEventListener('click',()=>{ if(document.getElementById('pane-logs')&&document.getElementById('pane-logs').classList.contains('show')) startLogStream(); });
setInterval(refreshDownloads, 8000);
setInterval(()=>{ location.reload(); }, 120000);
</script>
</body>
</html>`;
}

// ── Routes ───────────────────────────────────────────────────

// Anime job API — live state for the dashboard (auth-protected).
router.get("/api/anime", checkAuth, (req, res) => {
  try {
    const { snapshot } = require("./tools/animeJobManager");
    return res.json(snapshot());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/api/anime/:id/retry", checkAuth, (req, res) => {
  try {
    const { retryJob } = require("./tools/animeJobManager");
    const fresh = retryJob(req.params.id);
    if (!fresh) return res.status(404).json({ error: "job not found or not retryable" });
    return res.json({ ok: true, id: fresh.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Health endpoints — anime sources + AI providers (auth-protected).
router.get("/api/source-health", checkAuth, async (req, res) => {
  try {
    const { getHealth } = require("./tools/sourceHealth");
    return res.json(getHealth());
  } catch (e) { return res.status(500).json({ error: e.message }); }
});
router.post("/api/source-health/check", checkAuth, async (req, res) => {
  try {
    const { checkAll } = require("./tools/sourceHealth");
    return res.json({ results: await checkAll() });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});
router.get("/api/provider-health", checkAuth, async (req, res) => {
  try {
    const { getHealth } = require("./tools/providerHealth");
    return res.json(getHealth());
  } catch (e) { return res.status(500).json({ error: e.message }); }
});
router.post("/api/provider-health/check", checkAuth, async (req, res) => {
  try {
    const { checkAll } = require("./tools/providerHealth");
    return res.json({ results: await checkAll() });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// Live log console — JSON history + SSE stream (auth via session cookie).
router.get("/api/logs", checkAuth, (req, res) => {
  try {
    const { getRecent } = require("./utils/logStream");
    return res.json({ logs: getRecent(200, { level: req.query.level, search: req.query.search }) });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});
router.get("/api/logs/stream", checkAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": connected\n\n");

  const { subscribe } = require("./utils/logStream");
  const unsubscribe = subscribe((entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});

router.get("/", checkAuth, (req, res) => {
  try {
    const d = collectData();
    const active = d.activeMissions[0] || d.missions[0];
    let content = `
    <div class="pane show" id="pane-home">
      <div class="page-title">Hello</div><div class="page-sub">How can I help you today?</div>

      <div class="hero">
        <div class="hrow">
          <div class="avatar">◢</div>
          <div><h2>ARIA <span class="badge b-green">online</span></h2><div class="sub">${d.activeMissions.length ? "Working on " + d.activeMissions.length + " mission(s)." : "Idle — waiting for you."}</div></div>
        </div>
        <div class="actions">
          <button class="qbtn purple">✦ Ask AI</button>
          <button class="qbtn">Mission updates</button>
          <button class="qbtn">Create task</button>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="n">${d.activeMissions.length}</div><div class="l">active missions</div></div>
        <div class="stat"><div class="n">${d.missions.length}</div><div class="l">total missions</div></div>
        <div class="stat"><div class="n">${d.memories.length}</div><div class="l">memories</div></div>
        <div class="stat"><div class="n">${d.keysSet}/${d.aiKeys.length}</div><div class="l">AI keys</div></div>
      </div>

      <div class="grid2">
        <div class="card"><div class="h">Mission Spotlight ${active ? `<span class="badge b-accent">${active.status}</span>` : ""}</div>
          ${active ? `<div class="row"><span class="k">${active.objective || "Untitled"}</span></div><div class="row"><span class="k">Progress</span><span class="v">${active.progress || "—"}</span></div>${active.trace && active.trace.length ? `<div class="feed" style="margin-top:8px">${active.trace.slice(-3).map(t=>`<div class="feed-item"><div class="feed-ico">🧾</div><div class="feed-body"><div class="m">${t.detail}</div><div class="s">${new Date(t.ts).toLocaleTimeString()}</div></div></div>`).join("")}</div>`:""}` : `<div class="empty">No active mission. Use !delegate or !mission in chat.</div>`}
        </div>
        <div class="card"><div class="h">Attention ${d.errors.length ? `<span class="badge b-red">${d.errors.length}</span>` : `<span class="badge b-green">clear</span>`}</div>
          ${d.errors.length ? d.errors.slice(0,4).map(e=>`<div class="feed-item"><div class="feed-ico">⚠️</div><div class="feed-body"><div class="t" style="color:var(--red)">${(e.message||String(e)).slice(0,70)}</div><div class="s">${new Date(e.time||Date.now()).toLocaleTimeString()}</div></div></div>`).join("") : `<div class="empty">All clear.</div>`}
        </div>
      </div>
    </div>`;

    content += `
    <div class="pane" id="pane-missions"><div class="page-title">Missions</div><div class="page-sub">what ARIA is building</div>
      ${d.missions.length ? `<div class="grid2">${d.missions.slice(0,12).map(m=>`
        <div class="card"><div class="h"><span>${m.id||"mission"}</span><span class="badge ${m.status==='completed'?'b-green':m.status==='running'?'b-accent':m.status==='failed'?'b-red':'b-muted'}">${m.status}</span></div>
          <div class="row"><span class="k">${m.objective||"Untitled"}</span></div>
          <div class="row"><span class="k">Progress</span><span class="v">${m.progress||"—"}</span></div>
        </div>`).join("")}</div>` : `<div class="card"><div class="empty">No missions yet.</div></div>`}
    </div>`;

    content += `
    <div class="pane" id="pane-memory"><div class="page-title">Memory</div><div class="page-sub">what she remembers</div>
      <div class="card"><div class="h">Long-term memories (${d.memories.length})</div>
        ${d.memories.length ? d.memories.slice(-12).reverse().map(m=>`<div class="feed-item"><div class="feed-ico">🧠</div><div class="feed-body"><div class="t">${m.text}</div><div class="s">${new Date(m.ts||Date.now()).toLocaleString()}</div></div></div>`).join("") : `<div class="empty">No memories yet.</div>`}
      </div>
    </div>`;

    content += `
    <div class="pane" id="pane-media"><div class="page-title">Media</div><div class="page-sub">images & voice</div>
      <div class="card"><div class="h">Media remembered (${d.mediaMem.length})</div>
        ${d.mediaMem.length ? d.mediaMem.map(m=>`<div class="feed-item"><div class="feed-ico">${m.kind==='image'?'🖼️':'🎤'}</div><div class="feed-body"><div class="m">${(m.summary||"").slice(0,110)}</div><div class="s">${m.kind} · ${new Date(m.ts).toLocaleString()}</div></div></div>`).join("") : `<div class="empty">Send ARIA an image or voice note.</div>`}
      </div>
    </div>`;

    content += `
    <div class="pane" id="pane-household"><div class="page-title">Household</div><div class="page-sub">shared space</div>
      ${d.households.length ? d.households.map(h=>`<div class="card"><div class="h">🏠 ${h.name}</div>
        <div class="row"><span class="k">Members</span><span class="v">${h.members.length}</span></div>
        <div class="row"><span class="k">Tasks</span><span class="v">${h.sharedTasks.length}</span></div>
        ${h.sharedTasks.length ? h.sharedTasks.slice(-5).map(t=>`<div class="feed-item"><div class="feed-ico">${t.done?'✅':'⬜'}</div><div class="feed-body"><div class="m">${t.text}</div></div></div>`).join("") : ""}
      </div>`).join("") : `<div class="card"><div class="empty">No households. In a group: !household create</div></div>`}
    </div>`;

    content += `
    <div class="pane" id="pane-activity"><div class="page-title">Activity</div><div class="page-sub">what she did</div>
      <div class="card"><div class="h">Session</div>
        <div class="row"><span class="k">Uptime</span><span class="v">${d.hrs}h ${d.mins}m</span></div>
        <div class="row"><span class="k">Messages</span><span class="v">${d.stats?.messages||0}</span></div>
        <div class="row"><span class="k">Commands</span><span class="v">${d.stats?.commands||0}</span></div>
        <div class="row"><span class="k">Started</span><span class="v">${new Date(Date.now()-process.uptime()*1000).toLocaleString()}</span></div>
      </div>
    </div>`;

    content += renderStudyPane();

    content += `
    <div class="pane" id="pane-system"><div class="page-title">System</div><div class="page-sub">health</div>
      <div class="card"><div class="h">Runtime</div>
        <div class="row"><span class="k">Uptime</span><span class="v">${d.hrs}h ${d.mins}m</span></div>
        <div class="row"><span class="k">Memory</span><span class="v">${d.memMB} MB</span></div>
        <div class="row"><span class="k">Node</span><span class="v mono">${process.version}</span></div>
        <div class="row"><span class="k">Platform</span><span class="v">${d.os.platform?.()||"?"} ${d.os.arch?.()||""}</span></div>
        <div class="row"><span class="k">CPU</span><span class="v">${d.os.cpus?.().length||"?"} cores</span></div>
      </div>
      <div class="card"><div class="h">AI Providers</div>
        ${d.aiKeys.map(k=>`<div class="row"><span class="k mono">${k}</span><span class="badge ${process.env[k]?"b-green":"b-muted"}">${process.env[k]?"on":"off"}</span></div>`).join("")}
      </div>
    </div>`;

    content += renderDownloadsPane();

    content += `
    <div class="pane" id="pane-admin"><div class="page-title">Admin</div><div class="page-sub">access</div>
      <div class="card"><div class="h">Access</div>
        <div class="row"><span class="k">Owner</span><span class="v mono">${process.env.OWNER_NUMBER||"built-in"}</span></div>
        <div class="row"><span class="k">Dashboard</span><span class="badge b-green">secured</span></div>
      </div>
    </div>`;

    content += renderHealthPane();
    content += renderLogsPane();

    res.send(renderPage("Home", content, false, false, csrfFor(req)));
  } catch (e) {
    res.send(renderPage("Error", `<div class="card"><div class="empty">${e.message}</div></div>`));
  }
});

module.exports = router;
module.exports.checkAuth = checkAuth;
module.exports.csrfOk = csrfOk;
