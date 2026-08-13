// ARIA Dashboard — live intelligence cockpit
// Mounted on /dashboard in index.js
// Real auth + session (hashed tokens, CSRF, login throttle), live telemetry,
// analytics, academy intelligence, incident center, and the 'brain' pane.
//
// Session store: in-memory Map + hashed-token JSON persistence. Acceptable for
// a single-instance deployment; if this ever runs multi-instance/concurrent,
// migrate sessions to Redis/DB so a shared token store isn't write-contended.
// Tokens are stored only as SHA-256 hashes, so a leaked file is not reusable.

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

// Sources pane — per-job Source Resolution Engine report.
function resolverSummaryCard(j) {
  const r = j.resolver;
  if (!r) return null;
  const conf = r.confidence || {};
  const confChips = [
    conf.title != null ? `title ${conf.title}%` : null,
    conf.season != null ? `season ${conf.season}%` : null,
    conf.episodeExists === false ? "⚠️ episode not listed" : null,
  ].filter(Boolean);
  const sel = r.selected || {};
  const diag = r.diagnostics || [];
  return `
    <div class="card">
      <div class="h"><span>${j.name} — Ep ${j.episode}</span><span class="badge b-accent">source</span></div>
      ${r.canonical ? `<div class="row"><span class="k">canonical</span><span class="v mono">${r.canonical.title} (id ${r.canonical.id}${r.canonical.totalEpisodes ? ` · ${r.canonical.totalEpisodes} eps` : ""})</span></div>` : ""}
      ${confChips.length ? `<div class="row"><span class="k">confidence</span><span class="v">${confChips.map((c) => `<span class="badge b-muted">${c}</span>`).join(" ")}</span></div>` : ""}
      <div class="row"><span class="k">candidates</span><span class="v">${(r.candidates || []).length} discovered</span></div>
      ${(r.candidates || []).length ? `<div class="feed" style="margin-top:6px">${r.candidates.map((c, i) => {
        const v = (r.validation || {})[c.url] || {};
        return `<div class="feed-item"><div class="feed-ico" style="color:${v.ok ? "var(--green)" : "var(--faint)"}">${v.ok ? "✓" : "·"}</div><div class="feed-body"><div class="m mono">${c.provider} · ${c.type}${c.quality !== "unknown" ? ` · ${c.quality}` : ""}</div><div class="s">${v.ok ? "validated" : (v.reason || "not validated")}</div></div></div>`;
      }).join("")}</div>` : ""}
      ${diag.length ? `<div class="row"><span class="k">discovery latency</span><span class="v">${diag.map((d) => `${d.provider} ${d.latencyMs}ms`).join(" · ")}</span></div>` : ""}
      ${sel.provider ? `<div class="row"><span class="k" style="color:var(--green)">selected</span><span class="v"><span class="badge b-green">${sel.provider}</span> ${sel.type}${sel.height ? ` · ${sel.height}p` : ""}${sel.codec ? ` · ${sel.codec}` : ""}${sel.duration ? ` · ${Number(sel.duration).toFixed(0)}s` : ""} · score ${sel.score}</span></div>` : ""}
    </div>`;
}

function renderSourcesPane() {
  let snap = null;
  try { snap = require("./tools/animeJobManager").snapshot(); } catch (_) { snap = null; }
  const jobs = [
    ...(snap ? snap.current : []),
    ...(snap ? snap.recent : []),
  ];
  const withResolver = jobs.filter((j) => j.resolver);
  return `
    <div class="pane" id="pane-sources"><div class="page-title">Sources</div><div class="page-sub">source resolution engine · canonical → discover → validate → select</div>
      ${withResolver.length ? withResolver.map(resolverSummaryCard).join("") : `<div class="card"><div class="empty">No resolved sources yet. Send !animedl in a chat — the resolver logs its full report here.</div></div>`}
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
  let overview = [], userStats = { xp: 0, streak: 0, attempts: 0 };
  try {
    const ce = require("./tools/academy/curriculumEngine");
    overview = ce.allTrackOverviews();
    const owner = (process.env.OWNER_NUMBER || "237650284057").split("@")[0];
    const lm = require("./tools/academy/learnerModel");
    userStats = lm.getStats(owner);
  } catch (_) {}
  const totalLessons = overview.reduce((s, l) => s + l.totalLessons, 0);
  return `<div class="pane" id="pane-study"><div class="page-title">Academy</div><div class="page-sub">adaptive coding academy · ${overview.length} tracks</div>
    <div class="card"><div class="h">Your progress</div>
      <div class="row"><span class="k">Total XP</span><span class="v">${userStats.xp}</span></div>
      <div class="row"><span class="k">Streak</span><span class="v">${userStats.streak} day${userStats.streak === 1 ? "" : "s"}</span></div>
      <div class="row"><span class="k">Attempts</span><span class="v">${userStats.attempts}</span></div>
      <div class="feed-item" style="margin-top:8px"><div class="feed-ico">🎓</div><div class="feed-body"><div class="m">Run <b>!academy</b> in a chat — pick a track + level, work through composable lessons (explain → example → quiz → coding challenge), and ARIA adapts to your weak spots.</div></div></div>
    </div>
    <div class="card"><div class="h">Tracks (${totalLessons} lessons)</div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
        ${overview.map((l) => `<div class="mini-card" style="border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--panel2)">
          <div style="font-weight:700;margin-bottom:2px">${l.emoji} ${l.name}</div>
          <div style="color:var(--muted);font-size:12px">${l.tagline}</div>
          <div style="color:var(--faint);font-size:11px;margin-top:6px">${l.levels} levels · ${l.totalLessons} lessons</div>
        </div>`).join("")}
      </div>
    </div>
  </div>`;
}

// ── Intelligence cockpit panes ────────────────────────────────
function bar(value, max = 100, color = "var(--accent)") {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return `<div class="bar"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

// Real-time ARIA status strip (rendered live via /api/live).
function renderLiveStrip(ls) {
  const provBadge = (p) => `<span class="badge ${p && p !== "none" ? "b-accent" : "b-muted"}">${p || "none"}</span>`;
  return `
    <div class="pane show" id="pane-home">
      <div class="page-title">Command</div><div class="page-sub">ARIA core · live telemetry</div>
      <div class="hero" style="background:linear-gradient(120deg,#0f1230,#1a1d45)">
        <div class="hrow">
          <div class="avatar">◢</div>
          <div style="color:#fff"><h2 style="color:#fff">ARIA CORE <span class="badge b-green" id="core-badge">● ONLINE</span></h2>
            <div class="sub" style="color:#9aa3c9">model <b style="color:#cdd3f0">${ls.primary}</b> · fallback <b style="color:#cdd3f0">${ls.fallback}</b> · pid ${process.pid}</div>
          </div>
        </div>
        <div class="stats" style="margin-top:18px;background:transparent">
          <div class="stat dark"><div class="n" id="lv-memory">${ls.memoryCount}</div><div class="l">memories</div></div>
          <div class="stat dark"><div class="n" id="lv-missions">${ls.activeMissions}</div><div class="l">active missions</div></div>
          <div class="stat dark"><div class="n" id="lv-msg">${ls.msgsPerMin}</div><div class="l">msgs / min</div></div>
          <div class="stat dark"><div class="n" id="lv-lat">${ls.lastLatency}ms</div><div class="l">latency</div></div>
          <div class="stat dark"><div class="n" id="lv-err">${ls.errors5m}</div><div class="l">errors / 5m</div></div>
        </div>
        <div style="color:#9aa3c9;font-size:12px;margin-top:6px">uptime ${ls.uptimeHrs}h · ${ls.memMB}MB · ${ls.cpuCores} cores · <span id="lv-last">last AI: ${ls.lastProvider} in ${ls.lastLatency}ms</span></div>
      </div>
    </div>`;
}

// Analytics — 24h / 7d / 30d.
function renderAnalyticsPane(a) {
  const windows = ["24h", "7d", "30d"];
  const rows = (key, label, emoji) => windows.map((w) => {
    const v = a[w] ? a[w][key] : 0;
    return `<td>${v}</td>`;
  }).join("");
  const providerRows = Object.entries(a["24h"]?.providers || {}).map(([p, c]) => {
    const total = a["24h"].aiRequests || 1;
    return `<div class="row"><span class="k mono">${p}</span><span class="v">${c} calls</span>${bar(c, total, "var(--cyan)")}</div>`;
  }).join("");
  return `
    <div class="pane" id="pane-analytics"><div class="page-title">Analytics</div><div class="page-sub">volume · latency · reliability</div>
      <div class="card"><div class="h">Activity <span class="badge b-accent">live</span></div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="color:var(--muted);text-align:left"><th></th><th>24h</th><th>7d</th><th>30d</th></tr></thead>
          <tbody>
            <tr><td>💬 Messages</td>${rows("messages")}</tr>
            <tr><td>⚡ Commands</td>${rows("commands")}</tr>
            <tr><td>🤖 AI requests</td>${rows("aiRequests")}</tr>
            <tr><td>❌ Errors</td>${rows("errors")}</tr>
            <tr><td>⬇️ Downloads</td>${rows("downloads")}</tr>
            <tr><td>🚨 Incidents</td>${rows("incidents")}</tr>
            <tr><td>⏱️ Latency</td>${rows("latencyMs")}<td style="color:var(--faint);font-size:11px">ms</td></tr>
          </tbody>
        </table>
      </div>
      <div class="grid2" style="margin-top:16px">
        <div class="card"><div class="h">AI Reliability</div>
          <div class="row"><span class="k">Success rate (30d)</span><span class="v" id="an-succ">${a["30d"]?.aiSuccessRate || 100}%</span></div>
          <div class="row"><span class="k">Failures (30d)</span><span class="v">${a["30d"]?.aiFailures || 0}</span></div>
          <div class="row"><span class="k">Avg latency</span><span class="v">${a["30d"]?.latencyMs || 0}ms</span></div>
        </div>
        <div class="card"><div class="h">Providers (24h)</div>
          ${providerRows || `<div class="empty">No AI traffic yet.</div>`}
        </div>
      </div>
    </div>`;
}

// ── ARIA Learner Space ──────────────────────────────────────────
// Each learner's personal "spot": identity header, ARIA's first-person
// insights, skill strengths/weak-spots, learning pace, best time, goals,
// personalized next step, and ARIA's running notes.
function renderLearnerSpacePane(space, selfUid) {
  const id = space.identity;
  const name = id.nickname || id.name || id.uid.split("@")[0];
  const tierColor = id.tier === "pro" ? "var(--accent)" : id.tier === "advanced" ? "var(--green)" : id.tier === "intermediate" ? "var(--cyan)" : "var(--muted)";

  const insightCards = (space.insights || []).map((i) => {
    const tagColor = i.tag === "focus" ? "var(--amber)" : i.tag === "nudge" ? "var(--cyan)" : i.tag === "strength" ? "var(--green)" : "var(--accent)";
    return `<div class="feed-item"><div class="feed-ico" style="color:${tagColor};background:var(--panel2)">💭</div><div class="feed-body"><div class="m">${i.text}</div><div class="s">${i.tag}</div></div></div>`;
  }).join("") || `<div class="empty">No insights yet — start learning and I'll begin reading you.</div>`;

  const skillChips = (arr, emoji) => arr.length ? arr.map((s) => `<span class="badge b-muted">${emoji} ${s.skill} · ${Math.round(s.confidence)}%</span>`).join(" ") : `<span class="badge b-muted">—</span>`;

  const goalRows = (space.goals || []).map((g) => `<div class="row"><span class="k">🎯</span><span class="v">${g}</span></div>`).join("") || `<div class="empty">Set a goal and I'll help you chase it.</div>`;

  const noteRows = (space.ariaNotes || []).map((n) => `<div class="feed-item"><div class="feed-ico">📝</div><div class="feed-body"><div class="m">${n.text}</div><div class="s">${new Date(n.ts).toLocaleString()}</div></div></div>`).join("") || `<div class="empty">No notes yet.</div>`;

  const recentText = space.recency == null ? "never" : space.recency === 0 ? "today" : `${space.recency}d ago`;

  return `
    <div class="pane" id="pane-learnerspace"><div class="page-title">Learner Space</div><div class="page-sub">ARIA knows you · your spot · ${id.tier}</div>
      <div class="hero" style="background:linear-gradient(120deg,#13153a,#1c2050)">
        <div class="hrow">
          <div class="avatar" style="background:linear-gradient(135deg,#8b5cf6,#3b82f6)">${name.slice(0, 1).toUpperCase()}</div>
          <div style="color:#fff"><h2 style="color:#fff">${name}</h2>
            <div class="sub" style="color:#9aa3c9"><span class="badge" style="background:${tierColor};color:#fff">${id.tier}</span> ${id.xp} XP · ${id.streak}d streak ${space.recency == null ? "" : "· last seen " + recentText}</div>
          </div>
        </div>
      </div>
      <div class="grid2">
        <div class="card"><div class="h">💭 ARIA's insights</div>${insightCards}</div>
        <div>
          <div class="card"><div class="h">Strengths</div>${skillChips(space.skills.strong, "💪")}</div>
          <div class="card" style="margin-top:12px"><div class="h">Needs focus</div>${skillChips(space.skills.focus, "🎯")}</div>
          <div class="card" style="margin-top:12px"><div class="h">Improving</div>${skillChips(space.skills.improving, "📈")}</div>
        </div>
      </div>
      <div class="grid2" style="margin-top:16px">
        <div class="card"><div class="h">How you learn</div>
          <div class="row"><span class="k">Pace</span><span class="v">${space.pace.label}</span></div>
          <div class="row"><span class="k">Best time</span><span class="v">${space.bestTime ? space.bestTime.time : "—"}</span></div>
          <div class="row"><span class="k">Style</span><span class="v">${space.style || "learning…"}</span></div>
          <div style="color:var(--faint);font-size:11px;margin-top:8px">${space.pace.detail}</div>
        </div>
        <div class="card"><div class="h">Goals</div>${goalRows}</div>
      </div>
      <div class="card" style="margin-top:16px"><div class="h">➡️ What's next</div><div class="row"><span class="k">Recommendation</span><span class="v">${space.next.text}</span></div></div>
      <div class="card" style="margin-top:16px"><div class="h">ARIA's notes</div>${noteRows}</div>
      <div class="card" style="margin-top:16px"><div class="h">💬 Tell this learner something (ARIA delivers)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="ls-msg" placeholder="A note or encouragement for ${name}…" style="flex:1;min-width:200px;background:var(--panel2);border:1px solid var(--line);color:var(--text);padding:10px 12px;border-radius:10px;font-size:13px;outline:none">
          <button class="qbtn" onclick="sendLearnerNote('${id.uid}')">Send ➤</button>
        </div>
        <div id="ls-msg-result" style="color:var(--faint);font-size:11px;margin-top:8px"></div>
      </div>
    </div>
    <script>
    async function sendLearnerNote(uid){
      const txt=document.getElementById('ls-msg').value.trim();
      const res=document.getElementById('ls-msg-result');
      if(!txt){res.textContent='Enter a message first.';return;}
      try{
        const r=await fetch('/dashboard/api/learner-note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid,text:txt,_csrf:CSRF})});
        const j=await r.json();
        if(r.ok){res.textContent='✅ Saved as an ARIA note for '+uid+'.';document.getElementById('ls-msg').value='';}
        else res.textContent='❌ '+ (j.error||'failed');
      }catch(e){res.textContent='❌ '+e.message;}
    }
    </script>`;
}

// Academy intelligence + learner drill-down.
function renderAcademyPane(ad, selfUid, profile) {
  const track = ad.mostActiveTrack;
  const trackRow = track
    ? `<div class="row"><span class="k">Most active</span><span class="v">${track[0]} · ${track[1]} attempts</span></div>${bar(track[1], Math.max(1, track[1]))}`
    : `<div class="empty">No activity yet.</div>`;
  const weak = ad.weakestSkill;
  const weakRow = weak
    ? `<div class="row"><span class="k">Weakest skill</span><span class="v">${weak[0]} · ${weak[1].confidence}%</span></div>${bar(100 - weak[1].confidence, 100, "var(--red)")}`
    : `<div class="empty">Not enough data.</div>`;
  const topRows = ad.top.map((l, i) => {
    const name = l.uid === selfUid ? "*you*" : l.uid.split("@")[0];
    return `<div class="row"><span class="k">${i + 1}. ${name}</span><span class="v">${l.xp} XP${l.streak ? ` · ${l.streak}d 🔥` : ""}</span></div>`;
  }).join("");
  return `
    <div class="pane" id="pane-academy"><div class="page-title">Academy</div><div class="page-sub">intelligence · learners · mastery</div>
      <div class="stats">
        <div class="stat"><div class="n">${ad.learnerCount}</div><div class="l">learners</div></div>
        <div class="stat"><div class="n">${ad.lessons}</div><div class="l">lessons</div></div>
        <div class="stat"><div class="n">${ad.challenges}</div><div class="l">challenges</div></div>
        <div class="stat"><div class="n">${ad.projects}</div><div class="l">projects</div></div>
      </div>
      <div class="grid2">
        <div class="card"><div class="h">Mastery</div>
          <div class="row"><span class="k">Avg mastery</span><span class="v">${ad.avgMastery}%</span></div>
          <div class="row"><span class="k">Streaks ≥2d</span><span class="v">${ad.streaks}</span></div>
          ${trackRow}
        </div>
        <div class="card"><div class="h">Top learners</div>${topRows || `<div class="empty">No ranked learners yet.</div>`}</div>
      </div>
      <div class="card" style="margin-top:16px"><div class="h">Weakest skill (needs attention)</div>${weakRow}</div>
      <div class="card" style="margin-top:16px"><div class="h">Engineering DNA <span class="badge b-accent">${profile?.uid === selfUid ? "you" : profile?.uid?.split("@")[0] || "learner"}</span><button class="qbtn" style="padding:5px 10px;font-size:11px" onclick="openLearner('${profile?.uid || ""}')">Drill down ▸</button></div>
        <div id="dna-clusters">
        ${profile && profile.dna.length ? profile.dna.map((c) => `<div class="row"><span class="k">${c.cluster}</span><span class="v">${c.score}%</span></div>${bar(c.score, 100, c.score >= 60 ? "var(--green)" : c.score >= 35 ? "var(--amber)" : "var(--red)")}`).join("") : `<div class="empty">No DNA yet — start !academy.</div>`}
        ${profile?.career ? `<div class="row"><span class="k">Best-fit</span><span class="v">${profile.career.emoji} ${profile.career.role} (${profile.career.fit}%)</span></div>` : ""}
        ${profile?.roadmapList && profile.roadmapList.length ? `<div class="row"><span class="k">Next</span><span class="v">${profile.roadmapList.slice(0, 4).join(", ")}</span></div>` : ""}
        </div>
        <div class="feed-item" style="margin-top:8px"><div class="feed-ico">🧬</div><div class="feed-body"><div class="m">Click <b>Drill down</b> for the full learner view — evidence, attempts, weaknesses, recommended drills.</div></div></div>
      </div>
      <!-- Learner detail modal -->
      <div id="learner-modal" style="display:none;position:fixed;inset:0;background:rgba(10,12,30,.55);z-index:50;align-items:center;justify-content:center;padding:20px">
        <div class="card" style="max-width:560px;width:100%;max-height:86vh;overflow:auto;background:var(--panel)">
          <div class="h" id="lm-title">Learner</div>
          <div id="lm-body"></div>
          <button class="qbtn" style="margin-top:14px" onclick="document.getElementById('learner-modal').style.display='none'">Close</button>
        </div>
      </div>
    </div>`;
}

// Incident center.
function renderIncidentsPane(id) {
  const latest = id.latestIncident;
  return `
    <div class="pane" id="pane-incidents"><div class="page-title">Incidents</div><div class="page-sub">production response · ${id.totalIncidents} scenarios</div>
      <div class="stats">
        <div class="stat"><div class="n" style="color:var(--green)">${id.resolved}</div><div class="l">resolved</div></div>
        <div class="stat"><div class="n" style="color:var(--amber)">${id.active}</div><div class="l">active</div></div>
        <div class="stat"><div class="n" style="color:var(--red)">${id.critical}</div><div class="l">critical</div></div>
      </div>
      <div class="card"><div class="h">Latest scenario ${latest ? `<span class="badge b-accent">${latest.difficulty}</span>` : ""}</div>
        ${latest ? `
          <div class="row"><span class="k">${latest.title}</span></div>
          <div class="row"><span class="k">Skills</span><span class="v">${latest.skills.join(", ")}</span></div>
        ` : `<div class="empty">No incident scenarios loaded.</div>`}
        <div class="feed-item" style="margin-top:8px"><div class="feed-ico">🚨</div><div class="feed-body"><div class="m">Run <b>!incident</b> in a chat to diagnose a live incident. Grades your root-cause + fix.</div></div></div>
      </div>
    </div>`;
}

// ARIA 'brain' pane.
function renderBrainPane(b) {
  const fail = b.recurringFailures.map(([k, c]) => `<div class="row"><span class="k">${k}</span><span class="v">×${c}</span></div>`).join("");
  // Every % is backed by a formula — show the definition under the bar.
  const meter = (label, met, emoji) => {
    const pct = met.value; // null = no data yet
    const shown = pct == null ? "—" : pct + "%";
    const color = pct == null ? "var(--faint)" : pct >= 80 ? "var(--green)" : pct >= 60 ? "var(--amber)" : "var(--red)";
    const barHtml = pct == null ? `<div class="empty" style="padding:6px">no data yet</div>` : bar(pct, 100, color);
    return `<div class="row"><span class="k">${emoji} ${label}</span><span class="v">${shown}</span></div>${barHtml}<div style="color:var(--faint);font-size:10.5px;margin:-6px 0 10px">= ${met.formula}</div>`;
  };
  return `
    <div class="pane" id="pane-brain"><div class="page-title">Brain</div><div class="page-sub">ARIA intelligence · every % is a defined formula</div>
      <div class="card"><div class="h">Core systems</div>
        ${meter("Memory", b.memory, "🧠")}
        ${meter("Learning", b.learning, "📚")}
        ${meter("Automation", b.automation, "⚙️")}
        ${meter("Reliability", b.reliability, "🛡️")}
      </div>
      <div class="card" style="margin-top:16px"><div class="h">Current focus</div>
        <div class="row"><span class="k">${b.focus}</span></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="h">Recurring failures (24h) ${b.recurringFailures.length ? `<span class="badge b-red">${b.recurringFailures.length}</span>` : `<span class="badge b-green">clear</span>`}</div>
        ${fail || `<div class="empty">No recurring failures.</div>`}
      </div>
      <div class="card" style="margin-top:16px"><div class="h">Anime source reputation <span class="badge b-accent">resolver</span></div>
        ${(b.providers || []).length ? b.providers.map((p) => {
          const circ = p.circuit === "open" ? `<span class="badge b-red">🔴 open</span>` : p.circuit === "half-open" ? `<span class="badge b-amber">🟠 half-open</span>` : `<span class="badge b-green">🟢 closed</span>`;
          const color = p.score >= 70 ? "var(--green)" : p.score >= 40 ? "var(--amber)" : "var(--red)";
          return `<div class="row"><span class="k mono">${p.provider}</span><span class="v">${p.score}/100 ${circ}</span></div>${bar(p.score, 100, color)}${p.circuit === "open" ? `<div style="color:var(--faint);font-size:10.5px;margin:-6px 0 10px">retry in ${Math.ceil((p.retryAfterMs || 0) / 60000)}min · ${p.lastError || ""}</div>` : ""}`;
        }).join("") : `<div class="empty">No provider activity yet. Send !animedl to start.</div>`}
      </div>
    </div>`;
}

function renderPage(title, content, passwordNeeded = false, isLogin = false, csrf = "") {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title} · ARIA</title>
<style>
:root{
  /* Brand — professional indigo/violet */
  --brand:#6366f1; --brand2:#8b5cf6; --brand-soft:rgba(99,102,241,.12);
  /* Theme-agnostic status colors */
  --green:#22c55e; --amber:#f59e0b; --red:#ef4444;
  --radius:14px; --radius-sm:10px;
  --shadow:0 1px 2px rgba(16,24,40,.05),0 8px 24px rgba(16,24,40,.06);
  --shadow-lg:0 2px 4px rgba(16,24,40,.06),0 16px 40px rgba(16,24,40,.1);
}
[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0b0f1a; --panel:#141a29; --panel2:#0f1522; --panel3:#1b2334; --line:#222c42; --line2:#2e3a55;
  --text:#e7ecf5; --muted:#93a0b8; --faint:#5d6b88;
  --accent:#a5b4fc; --accent2:#c4b5fd; --cyan:#67e8f9;
}
[data-theme="light"]{
  color-scheme:light;
  --bg:#f6f7fb; --panel:#ffffff; --panel2:#f1f3f9; --panel3:#e9ecf5; --line:#e2e6f0; --line2:#cdd3e5;
  --text:#1a2130; --muted:#5b6678; --faint:#8a93a8;
  --accent:#6366f1; --accent2:#8b5cf6; --cyan:#0891b2;
  --shadow:0 1px 2px rgba(16,24,40,.06),0 8px 24px rgba(16,24,40,.07);
  --shadow-lg:0 2px 4px rgba(16,24,40,.07),0 16px 40px rgba(16,24,40,.1);
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,'Segoe UI','Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}
.mono{font-family:ui-monospace,Consolas,monospace}

/* Theme toggle — fixed top-right, styled for both themes */
.theme-toggle{position:fixed;top:16px;right:18px;z-index:60;width:38px;height:38px;border-radius:11px;border:1px solid var(--line2);background:var(--panel);color:var(--text);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow);transition:.15s}
.theme-toggle:hover{transform:translateY(-1px);box-shadow:var(--shadow-lg)}

.app{display:flex;min-height:100vh}
.sidebar{width:240px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--line);padding:22px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.sb-brand{display:flex;align-items:center;gap:11px;padding:0 8px;margin-bottom:26px}
.sb-logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--brand),var(--brand2));display:flex;align-items:center;justify-content:center;color:#fff;font-size:19px;font-weight:800;box-shadow:0 4px 12px var(--brand-soft)}
.sb-name{font-size:16px;font-weight:800;color:var(--text);letter-spacing:-.01em}
.sb-name small{display:block;font-size:11px;color:var(--muted);font-weight:600}
.sb-group{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);font-weight:700;padding:0 10px;margin:16px 0 6px}
.navitem{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:10px;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer;transition:.14s;border:1px solid transparent}
.navitem .ico{font-size:16px;width:20px;text-align:center}
.navitem:hover{background:var(--panel2);color:var(--text)}
.navitem.active{background:var(--brand-soft);color:var(--accent);border-color:var(--brand-soft)}
.sb-bottom{margin-top:auto;padding-top:16px;border-top:1px solid var(--line)}
.sb-online{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);padding:0 12px;margin-bottom:12px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(34,197,94,.15)}
.logout{width:100%;background:none;border:1px solid var(--line);color:var(--muted);border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer;transition:.14s}
.logout:hover{color:var(--red);border-color:rgba(239,68,68,.4)}

.main{flex:1;padding:32px 36px 60px;max-width:1120px}
.page-title{font-size:24px;font-weight:800;color:var(--text);letter-spacing:-.02em}
.page-sub{color:var(--muted);font-size:13px;margin-bottom:24px}

.hero{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:24px;margin-bottom:22px;box-shadow:var(--shadow)}
.hero .hrow{display:flex;align-items:center;gap:14px}
.hero .avatar{width:52px;height:52px;border-radius:15px;background:linear-gradient(135deg,var(--brand),var(--brand2));display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;color:#fff}
.hero h2{font-size:18px;font-weight:800;display:flex;align-items:center;gap:10px;color:var(--text)}
.hero .sub{color:var(--muted);font-size:13px;margin-top:3px}
.actions{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
.qbtn{display:inline-flex;align-items:center;gap:7px;padding:10px 16px;border-radius:11px;font-size:13px;font-weight:700;cursor:pointer;border:1px solid var(--line);background:var(--panel2);color:var(--text);transition:.14s}
.qbtn:hover{transform:translateY(-1px);box-shadow:var(--shadow)}
.qbtn.purple{background:linear-gradient(90deg,var(--brand),var(--brand2));color:#fff;border:none}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:22px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px;box-shadow:var(--shadow)}
.stat .n{font-size:26px;font-weight:800;color:var(--text);letter-spacing:-.02em}
.stat .l{color:var(--muted);font-size:12px;margin-top:3px}

.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px;box-shadow:var(--shadow)}
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
.bar{height:6px;border-radius:99px;background:var(--panel2);overflow:hidden;margin:2px 0 12px}
.bar-fill{height:100%;border-radius:99px;transition:width .4s}
.stat.dark{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12)}
.stat.dark .n{color:#fff}
.stat.dark .l{color:#9aa3c9}
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
  <button class="theme-toggle" id="themeToggle" title="Toggle theme">🌙</button>
  <aside class="sidebar">
    <div class="sb-brand"><div class="sb-logo">◢</div><div class="sb-name">ARIA<small>control center</small></div></div>
    <div class="sb-group">Overview</div>
    <div class="navitem active" data-pane="home"><span class="ico">◉</span><span>Command</span></div>
    <div class="navitem" data-pane="activity"><span class="ico">📈</span><span>Activity</span></div>
    <div class="navitem" data-pane="analytics"><span class="ico">📊</span><span>Analytics</span></div>
    <div class="sb-group">Intelligence</div>
    <div class="navitem" data-pane="brain"><span class="ico">🧬</span><span>Brain</span></div>
    <div class="navitem" data-pane="memory"><span class="ico">🧠</span><span>Memory</span></div>
    <div class="navitem" data-pane="media"><span class="ico">🖼️</span><span>Media</span></div>
    <div class="sb-group">Academy</div>
    <div class="navitem" data-pane="academy"><span class="ico">🎓</span><span>Academy</span></div>
    <div class="navitem" data-pane="learnerspace"><span class="ico">🧑‍🎓</span><span>Learners</span></div>
    <div class="sb-group">Automation</div>
    <div class="navitem" data-pane="missions"><span class="ico">◆</span><span>Missions</span></div>
    <div class="navitem" data-pane="downloads"><span class="ico">⬇️</span><span>Downloads</span></div>
    <div class="navitem" data-pane="sources"><span class="ico">🧩</span><span>Sources</span></div>
    <div class="sb-group">Operations</div>
    <div class="navitem" data-pane="incidents"><span class="ico">🚨</span><span>Incidents</span></div>
    <div class="navitem" data-pane="health"><span class="ico">❤️</span><span>Health</span></div>
    <div class="navitem" data-pane="logs"><span class="ico">📜</span><span>Logs</span></div>
    <div class="navitem" data-pane="system"><span class="ico">🛠️</span><span>System</span></div>
    <div class="navitem" data-pane="household"><span class="ico">🏠</span><span>Household</span></div>
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
const titles={home:['Command',"ARIA core · live telemetry"],analytics:['Analytics','volume · latency · reliability'],academy:['Academy','learners · mastery · intelligence'],incidents:['Incidents','production response'],brain:['Brain','ARIA intelligence'],missions:['Missions','what ARIA is building'],memory:['Memory','what she remembers'],media:['Media','images & voice'],downloads:['Downloads','anime pipeline'],household:['Household','shared space'],activity:['Activity','what she did'],system:['System','health'],health:['Health','sources & providers'],logs:['Logs','live console'],admin:['Admin','access']};
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
// ── Theme toggle (light/dark) — persisted in localStorage ──
(function(){
  const root=document.documentElement;
  const btn=document.getElementById('themeToggle');
  const saved=localStorage.getItem('aria-theme');
  const prefersDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme=saved||(prefersDark?'dark':'light');
  root.setAttribute('data-theme',theme);
  if(btn)btn.textContent=theme==='dark'?'☀️':'🌙';
  if(btn)btn.addEventListener('click',()=>{
    const next=root.getAttribute('data-theme')==='dark'?'light':'dark';
    root.setAttribute('data-theme',next);
    localStorage.setItem('aria-theme',next);
    btn.textContent=next==='dark'?'☀️':'🌙';
  });
})();
// Learner drill-down — fetch full profile + evidence and open the modal.
async function openLearner(uid){
  const modal=document.getElementById('learner-modal');
  const body=document.getElementById('lm-body');
  const title=document.getElementById('lm-title');
  if(!modal||!body) return;
  modal.style.display='flex';
  body.innerHTML='<div class="empty">Loading…</div>';
  try{
    const r=await fetch('/dashboard/api/learner/'+encodeURIComponent(uid),{headers:{'Accept':'application/json'}});
    if(!r.ok){ body.innerHTML='<div class="empty">Could not load learner.</div>'; return; }
    const d=await r.json();
    title.textContent='🧬 '+(uid.split('@')[0])+' — Engineering DNA';
    let html='';
    html+='<div class="row"><span class="k">XP</span><span class="v">'+(d.stats?.xp||0)+'</span></div>';
    html+='<div class="row"><span class="k">Streak</span><span class="v">'+(d.stats?.streak||0)+'d</span></div>';
    html+='<div class="row"><span class="k">Attempts</span><span class="v">'+(d.stats?.attempts||0)+'</span></div>';
    if(d.career) html+='<div class="row"><span class="k">Best-fit</span><span class="v">'+d.career.emoji+' '+d.career.role+' ('+d.career.fit+'%)</span></div>';
    if(d.recommendation) html+='<div class="feed-item" style="margin-top:8px"><div class="feed-ico">🎯</div><div class="feed-body"><div class="m">'+d.recommendation.reason+'</div>'+(d.recommendation.action?'<div class="s">→ '+d.recommendation.action+'</div>':'')+'</div></div>';
    if(d.dna&&d.dna.length){
      html+='<div style="margin-top:12px"><b>DNA</b></div>';
      for(const c of d.dna) html+='<div class="row"><span class="k">'+c.cluster+'</span><span class="v">'+c.score+'%</span></div><div class="bar"><div class="bar-fill" style="width:'+Math.min(100,c.score)+'%;background:'+(c.score>=60?'var(--green)':c.score>=35?'var(--amber)':'var(--red)')+'"></div></div>';
    }
    if(d.roadmapList&&d.roadmapList.length) html+='<div style="margin-top:10px"><b>Recommended next:</b> '+d.roadmapList.slice(0,6).join(', ')+'</div>';
    if(d.evidence&&d.evidence.length){
      html+='<div style="margin-top:12px"><b>Evidence-backed mastery</b></div>';
      for(const e of d.evidence) html+='<div class="row"><span class="k">'+e.track+'/'+e.level+'</span><span class="v">'+e.percent+'%</span></div>';
    } else html+='<div class="empty" style="margin-top:8px">No assessment evidence yet.</div>';
    body.innerHTML=html;
  }catch(_){ body.innerHTML='<div class="empty">Could not load learner.</div>'; }
}
// Live ARIA status — poll /api/live every 5s and update the Command pane.
async function refreshLive(){
  const home=document.getElementById('pane-home');
  if(!home || !home.classList.contains('show')) return;
  try{
    const r=await fetch('/dashboard/api/live',{headers:{'Accept':'application/json'}});
    if(!r.ok) return;
    const d=await r.json();
    const set=(id,v)=>{const el=document.getElementById(id); if(el)el.textContent=v;};
    set('lv-memory',d.memoryCount);
    set('lv-missions',d.activeMissions);
    set('lv-msg',d.msgsPerMin);
    set('lv-lat',d.lastLatency+'ms');
    set('lv-err',d.errors5m);
    set('lv-last','last AI: '+d.lastProvider+' in '+d.lastLatency+'ms');
  }catch(_){}
}
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
setInterval(refreshLive, 5000);
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

// Anime source reputation API — provider scores + circuit state (auth-protected).
router.get("/api/source-reputation", checkAuth, (req, res) => {
  try {
    const { reputationReport } = require("./tools/sourceResolver");
    return res.json(reputationReport());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Learner Space API — ARIA's personal profile for a learner (auth-protected).
router.get("/api/learner-space/:uid", checkAuth, (req, res) => {
  try {
    const { buildLearnerSpace } = require("./tools/academy/learnerSpace");
    return res.json(buildLearnerSpace(req.params.uid));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Add an ARIA note for a learner (auth-protected, CSRF-checked POST).
router.post("/api/learner-note", checkAuth, (req, res) => {
  try {
    const { uid, text } = req.body || {};
    if (!uid || !text) return res.status(400).json({ error: "uid and text required" });
    const lm = require("./tools/academy/learnerModel");
    lm.addAriaNote(String(uid), String(text).slice(0, 500), "manual");
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Learner drill-down API — full evidence, attempts, weaknesses, recs (auth-protected).
router.get("/api/learner/:uid", checkAuth, (req, res) => {
  try {
    const tel = require("./tools/dashboardTelemetry");
    const profile = tel.learnerProfile(req.params.uid);
    const lm = require("./tools/academy/learnerModel");
    const rec = require("./tools/academy/adaptiveTutor").recommend(req.params.uid);
    const evidence = [];
    try {
      const ee = require("./tools/academy/evidenceEngine");
      const rec2 = lm.learner(req.params.uid);
      for (const track of Object.keys(rec2.mastery || {}))
        for (const level of Object.keys(rec2.mastery[track] || {}))
          evidence.push({ track, level, ...ee.computeEvidenceMastery(req.params.uid, track, level) });
    } catch (_) {}
    return res.json({ ...profile, recommendation: rec, evidence });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Live ARIA telemetry — real-time status for the Command pane (auth-protected).
router.get("/api/live", checkAuth, (req, res) => {
  try {
    const { liveStatus } = require("./tools/dashboardTelemetry");
    return res.json(liveStatus());
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
    const tel = require("./tools/dashboardTelemetry");
    const selfUid = (process.env.OWNER_NUMBER || "237650284057").split("@")[0];
    const ls = tel.liveStatus();
    const a = tel.analytics();
    const ad = tel.academyData();
    const id = tel.incidentData();
    const b = tel.brainData();
    const profile = tel.learnerProfile(selfUid);
    const active = d.activeMissions[0] || d.missions[0];
    let content = renderLiveStrip(ls);
    content += renderAnalyticsPane(a);
    content += renderAcademyPane(ad, selfUid, profile);
    try {
      const { buildLearnerSpace } = require("./tools/academy/learnerSpace");
      content += renderLearnerSpacePane(buildLearnerSpace(selfUid), selfUid);
    } catch (e) {
      content += `<div class="pane" id="pane-learnerspace"><div class="page-title">Learner Space</div><div class="page-sub">ARIA knows you</div><div class="card"><div class="empty">Learner Space unavailable: ${e.message}</div></div></div>`;
    }
    content += renderIncidentsPane(id);
    content += renderBrainPane(b);
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
    content += renderSourcesPane();

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
