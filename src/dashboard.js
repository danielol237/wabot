// ARIA Web Dashboard — browser control panel
// Mounted on /dashboard in index.js
// Fixed auth: real login form + signed cookie session, constant-time compare,
// secure /preview, and an ARIA-branded dark UI.

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const router = express.Router();

const SESSION_TTL = 12 * 60 * 60 * 1000; // 12h

// ── Cookie parsing middleware (runs before routes; no extra dep needed) ──
router.use((req, res, next) => {
  const raw = req.headers.cookie || "";
  req.cookies = {};
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) req.cookies[k] = decodeURIComponent(v.join("=") || "");
  }
  next();
});

// ── Session store (in-memory; fine for a single-instance dashboard) ──
const sessions = new Map(); // token -> expiry

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
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

  // Check cookie session first
  const token = req.cookies?.["aria_session"];
  if (token && sessions.get(token) && sessions.get(token) > Date.now()) {
    return next();
  }

  // Fallback: Authorization header (Bearer or Basic)
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) {
    const supplied = auth.slice(7);
    if (constantTimeEqual(supplied, pw)) {
      const t = crypto.randomBytes(24).toString("hex");
      sessions.set(t, Date.now() + SESSION_TTL);
      res.cookie("aria_session", t, { httpOnly: true, maxAge: SESSION_TTL, sameSite: "lax" });
      return next();
    }
  } else if (auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const supplied = decoded.split(":")[1] || "";
      if (constantTimeEqual(supplied, pw)) {
        const t = crypto.randomBytes(24).toString("hex");
        sessions.set(t, Date.now() + SESSION_TTL);
        res.cookie("aria_session", t, { httpOnly: true, maxAge: SESSION_TTL, sameSite: "lax" });
        return next();
      }
    } catch (_) {}
  }

  // No valid session → show login page
  return res.status(401).send(renderPage("Login", loginForm(), false, true));
}

function loginForm() {
  return `<div class="login-card">
    <div class="logo">◢ ARIA</div>
    <p class="tagline">Aegis Command Center</p>
    <form method="POST" action="/dashboard/login">
      <input type="password" name="password" placeholder="Dashboard password" autofocus required />
      <button type="submit" class="btn btn-primary btn-block">Enter</button>
    </form>
    ${process.env.DASHBOARD_PASSWORD ? "" : '<p class="hint">Set DASHBOARD_PASSWORD in .env</p>'}
  </div>`;
}

router.post("/login", (req, res) => {
  const pw = process.env.DASHBOARD_PASSWORD;
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const supplied = new URLSearchParams(body).get("password") || "";
    if (pw && constantTimeEqual(supplied, pw)) {
      const t = crypto.randomBytes(24).toString("hex");
      sessions.set(t, Date.now() + SESSION_TTL);
      res.cookie("aria_session", t, { httpOnly: true, maxAge: SESSION_TTL, sameSite: "lax" });
      return res.redirect("/dashboard");
    }
    return res.status(401).send(renderPage("Login", loginForm() + '<p class="error">Wrong password.</p>', false, true));
  });
});

router.post("/logout", (req, res) => {
  const token = req.cookies?.["aria_session"];
  if (token) sessions.delete(token);
  res.clearCookie("aria_session");
  res.redirect("/dashboard");
});

// ── HTML template ──────────────────────────────────────────
function renderPage(title, content, passwordNeeded = false, isLogin = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | ARIA</title>
  <style>
    :root { --bg:#07070b; --panel:#101018; --panel2:#161624; --border:#232338; --text:#e4e4f0; --muted:#7a7a95; --accent:#a78bfa; --accent2:#22d3ee; --good:#34d399; --bad:#f87171; --warn:#fbbf24; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Segoe UI',Roboto,sans-serif; background:radial-gradient(1200px 600px at 20% -10%, #1a1035 0%, var(--bg) 55%); color:var(--text); min-height:100vh; }
    .nav { display:flex; align-items:center; gap:1.5rem; padding:1rem 2rem; border-bottom:1px solid var(--border); background:rgba(16,16,24,0.7); backdrop-filter:blur(8px); position:sticky; top:0; z-index:10; }
    .nav .brand { font-size:1.25rem; font-weight:700; background:linear-gradient(90deg,var(--accent),var(--accent2)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
    .nav a { color:var(--muted); text-decoration:none; font-size:0.9rem; padding:0.3rem 0.5rem; border-radius:6px; transition:all .15s; }
    .nav a:hover, .nav a.active { color:var(--text); background:var(--panel2); }
    .nav .spacer { flex:1; }
    .container { max-width:1200px; margin:0 auto; padding:2rem; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:1rem; margin-bottom:2rem; }
    .card { background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--border); border-radius:14px; padding:1.5rem; }
    .card h3 { color:var(--accent); margin-bottom:0.9rem; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.08em; font-weight:600; }
    .value { font-size:2.2rem; font-weight:700; color:#fff; }
    .label { font-size:0.8rem; color:var(--muted); margin-top:0.25rem; }
    .stat-row { display:flex; justify-content:space-between; padding:0.55rem 0; border-bottom:1px solid var(--border); font-size:0.9rem; }
    .stat-row:last-child { border:none; }
    .badge { display:inline-block; padding:0.2rem 0.6rem; border-radius:999px; font-size:0.72rem; font-weight:600; }
    .b-green { background:#0a2f2a; color:var(--good); } .b-red { background:#3a1212; color:var(--bad); } .b-yellow { background:#3a2f08; color:var(--warn); } .b-muted { background:#232338; color:var(--muted); }
    .btn { display:inline-block; padding:0.55rem 1.1rem; border-radius:8px; border:none; cursor:pointer; font-size:0.85rem; font-weight:600; transition:all .15s; }
    .btn-primary { background:var(--accent); color:#0a0a0f; } .btn-primary:hover { filter:brightness(1.1); }
    .btn-danger { background:var(--bad); color:#1a0505; } .btn-ghost { background:var(--panel2); color:var(--text); border:1px solid var(--border); }
    .btn-sm { padding:0.3rem 0.8rem; font-size:0.8rem; } .btn-block { width:100%; margin-top:0.5rem; }
    input, select, textarea { background:var(--panel); border:1px solid var(--border); color:var(--text); padding:0.6rem 0.8rem; border-radius:8px; font-size:0.9rem; width:100%; margin-bottom:0.5rem; }
    input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(167,139,250,0.15); }
    .flex { display:flex; gap:0.5rem; align-items:center; } .mt-1 { margin-top:0.75rem; }
    table { width:100%; border-collapse:collapse; } th { text-align:left; padding:0.6rem; color:var(--muted); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; } td { padding:0.6rem; border-bottom:1px solid var(--border); font-size:0.9rem; }
    pre { background:var(--bg); padding:0.9rem; border-radius:8px; font-size:0.78rem; overflow-x:auto; max-height:320px; border:1px solid var(--border); line-height:1.5; }
    .login-card { max-width:360px; margin:15vh auto 0; background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--border); border-radius:18px; padding:2.5rem 2rem; text-align:center; }
    .logo { font-size:2rem; font-weight:800; background:linear-gradient(90deg,var(--accent),var(--accent2)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
    .tagline { color:var(--muted); font-size:0.85rem; margin:0.4rem 0 1.6rem; }
    .error { color:var(--bad); margin-top:1rem; font-size:0.85rem; } .hint { color:var(--muted); margin-top:1rem; font-size:0.8rem; }
    .statusbar { display:flex; gap:0.5rem; align-items:center; }
    .live-dot { width:8px; height:8px; border-radius:50%; background:var(--good); animation:pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    @media (max-width:600px){ .container{padding:1rem} .nav{padding:0.75rem 1rem} .nav a{font-size:0.8rem} }
  </style>
</head>
<body>
  <nav class="nav">
    <span class="brand">◢ ARIA</span>
    <a href="/dashboard" class="${title==='Dashboard'?'active':''}">Dashboard</a>
    <a href="/dashboard/spawns" class="${title==='Spawns'?'active':''}">Spawns</a>
    <a href="/dashboard/trainers" class="${title==='Trainers'?'active':''}">Trainers</a>
    <a href="/dashboard/logs" class="${title==='Logs'?'active':''}">Logs</a>
    <a href="/dashboard/admin" class="${title==='Admin'?'active':''}">Admin</a>
    <div class="spacer"></div>
    ${!isLogin ? `<div class="statusbar"><span class="live-dot"></span><span style="font-size:0.8rem;color:var(--muted);" id="up">—</span></div>
    <form method="POST" action="/dashboard/logout"><button class="btn btn-ghost btn-sm">Logout</button></form>` : ""}
  </nav>
  <div class="container">
    ${passwordNeeded ? `<div class="card" style="max-width:420px;margin:0 auto;text-align:center;"><h3>🔒 Locked</h3><p style="color:var(--muted);margin:1rem 0;">Set DASHBOARD_PASSWORD in .env to access the dashboard.</p></div>` : content}
  </div>
  <script>
    if(document.getElementById("up")){ const u=Math.floor(process?0:0); }
  </script>
</body>
</html>`;
}

// ── Routes ─────────────────────────────────────────────────

// Main dashboard
router.get("/", checkAuth, (req, res) => {
  try {
    const os = require("os");
    const uptime = Math.floor(process.uptime());
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);

    let botStats = { messages: 0, commands: 0, errors: 0 };
    let spawnStats = { dailyLimit: 20, remaining: 0, enabled: true };
    try { botStats = require("./tools/botAdmin").getStats() || botStats; } catch (_) {}
    try { spawnStats = require("./tools/pokemonSpawn").getSpawnStats(); } catch (_) {}

    const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const content = `
    <div class="grid">
      <div class="card"><h3>⏱ Uptime</h3><div class="value">${hrs}h ${mins}m</div><div class="label">Since last restart</div></div>
      <div class="card"><h3>💬 Messages</h3><div class="value">${botStats.messages || "—"}</div><div class="label">Processed</div></div>
      <div class="card"><h3>🦎 Spawns</h3><div class="value">${spawnStats.remaining}</div><div class="label">Remaining / ${spawnStats.dailyLimit}</div></div>
      <div class="card"><h3>⚠️ Errors</h3><div class="value">${botStats.errors || 0}</div><div class="label">${botStats.errors > 0 ? '<span class="badge b-red">Needs attention</span>' : '<span class="badge b-green">All clear</span>'}</div></div>
    </div>
    <div class="grid">
      <div class="card">
        <h3>🔧 System</h3>
        <div class="stat-row"><span>CPU</span><span>${os.cpus().length} cores</span></div>
        <div class="stat-row"><span>Memory</span><span>${memMB} MB used</span></div>
        <div class="stat-row"><span>Node</span><span>${process.version}</span></div>
        <div class="stat-row"><span>Platform</span><span>${os.platform()}</span></div>
        <div class="stat-row"><span>Status</span><span class="badge b-green">Online</span></div>
      </div>
      <div class="card">
        <h3>📡 API Keys</h3>
        ${["GROQ_API_KEY","CEREBRAS_API_KEY","GEMINI_API_KEY","TAVILY_API_KEY","ELEVENLABS_API_KEY"].map(k => `
          <div class="stat-row"><span>${k}</span><span class="badge ${process.env[k] ? "b-green" : "b-red"}">${process.env[k] ? "Set" : "Missing"}</span></div>`).join("")}
      </div>
      <div class="card">
        <h3>🌙 Time Period</h3>
        <div class="value" style="font-size:1.4rem;"><span id="timePeriod">—</span></div>
        <div class="label" id="timeDetail"></div>
      </div>
    </div>
    <script>try{const p=${JSON.stringify(require("./tools/pokemonSpawn").getTimePeriod())};document.getElementById("timePeriod").textContent=p.emoji+" "+p.name;document.getElementById("timeDetail").textContent="Boost: "+p.boost.join(", ");}catch(_){}</script>`;
    res.send(renderPage("Dashboard", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});

// Spawn controls
router.get("/spawns", checkAuth, (req, res) => {
  try {
    const { getSpawnStats } = require("./tools/pokemonSpawn");
    const stats = getSpawnStats();
    const content = `
    <div class="grid">
      <div class="card">
        <h3>🦎 Spawn Controls</h3>
        <form method="POST" action="/dashboard/spawns/set" class="flex" style="margin-bottom:1rem;">
          <input type="number" name="limit" value="${stats.dailyLimit}" min="0" max="100" style="width:90px;">
          <button type="submit" class="btn btn-primary btn-sm">Set Rate</button>
        </form>
        <div class="stat-row"><span>Status</span><span class="badge ${stats.enabled ? "b-green" : "b-red"}">${stats.enabled ? "Active" : "Paused"}</span></div>
        <div class="stat-row"><span>Daily Limit</span><span>${stats.dailyLimit}</span></div>
        <div class="stat-row"><span>Used Today</span><span>${stats.totalToday}</span></div>
        <div class="stat-row"><span>Remaining</span><span>${stats.remaining}</span></div>
        <div class="stat-row"><span>Interval</span><span>every ${stats.intervalMin} min</span></div>
        <div class="stat-row"><span>Next Spawn</span><span>~${stats.nextSpawnMinutes} min</span></div>
        <div class="flex mt-1">
          <form method="POST" action="/dashboard/spawns/toggle"><button type="submit" class="btn ${stats.enabled ? "btn-danger" : "btn-primary"} btn-sm">${stats.enabled ? "Pause" : "Resume"}</button></form>
          <form method="POST" action="/dashboard/spawns/reset"><button type="submit" class="btn btn-ghost btn-sm">Reset</button></form>
        </div>
      </div>
      <div class="card"><h3>🎯 Rarity Weights</h3>
        ${["Common 50%","Uncommon 25%","Rare 15%","Super Rare 7%","Legendary 2.5%","Mythical 0.5%"].map(r => `<div class="stat-row"><span>${r.split(" ")[0]}</span><span>${r.split(" ")[1]}</span></div>`).join("")}
      </div>
    </div>`;
    res.send(renderPage("Spawns", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});

router.post("/spawns/set", checkAuth, (req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    try { const limit = parseInt(new URLSearchParams(body).get("limit")); if (!isNaN(limit)) require("./tools/pokemonSpawn").setSpawnLimit(limit); } catch (_) {}
    res.redirect("/dashboard/spawns");
  });
});
router.post("/spawns/toggle", checkAuth, (req, res) => {
  try { const { getGlobalSpawnConfig, save } = require("./tools/pokemonSpawn"); const cfg = getGlobalSpawnConfig(); cfg.enabled = !cfg.enabled; save(); } catch (_) {}
  res.redirect("/dashboard/spawns");
});
router.post("/spawns/reset", checkAuth, (req, res) => {
  try { require("./tools/pokemonSpawn").setSpawnLimit(20); } catch (_) {}
  res.redirect("/dashboard/spawns");
});

// Trainers
router.get("/trainers", checkAuth, (req, res) => {
  try {
    const { getAllTrainers } = require("./tools/pokemonGame");
    const entries = Object.entries(getAllTrainers() || {});
    const content = `<div class="card"><h3>👤 Trainers (${entries.length})</h3>
      ${entries.length === 0 ? '<p style="color:var(--muted);">No trainers yet.</p>' : `
      <table><tr><th>Name</th><th>Level</th><th>Team</th><th>PC</th><th>Coins</th><th>W/L</th></tr>
      ${entries.map(([id,t]) => `<tr><td>${t.name||"—"}</td><td>${t.level}</td><td>${(t.team||[]).length}</td><td>${(t.pc||[]).length}</td><td>${t.coins}</td><td>${t.wins}/${t.losses}</td></tr>`).join("")}
      </table>`}</div>`;
    res.send(renderPage("Trainers", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});

// Logs
router.get("/logs", checkAuth, (req, res) => {
  try {
    let errors = []; try { errors = require("./tools/botAdmin").getRecentErrors() || []; } catch (_) {}
    const content = `
    <div class="card"><h3>📋 Recent Errors (${errors.length})</h3>
      ${errors.length === 0 ? '<p style="color:var(--muted);">No errors logged. Clean run! 🎉</p>' : `<pre>${errors.map(e => `[${e.time}] [${e.context}] ${e.error}`).join("\n")}</pre>`}
    </div>
    <div class="card mt-1"><h3>🔧 Actions</h3>
      <div class="flex"><form method="POST" action="/dashboard/logs/clear"><button type="submit" class="btn btn-danger btn-sm">Clear Logs</button></form></div>
    </div>`;
    res.send(renderPage("Logs", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});

router.post("/logs/clear", checkAuth, (req, res) => {
  try { require("./tools/botAdmin").clearErrors && require("./tools/botAdmin").clearErrors(); } catch (_) {}
  res.redirect("/dashboard/logs");
});

// Admin
router.get("/admin", checkAuth, (req, res) => {
  try {
    const { listAdmins } = require("./utils/permissions");
    const admins = listAdmins() || [];
    const content = `
    <div class="grid">
      <div class="card"><h3>👑 Admins</h3>
        ${admins.length === 0 ? '<p style="color:var(--muted);">No admins set.</p>' : admins.map(a => `<div class="stat-row"><span>${a}</span><span class="badge b-green">Admin</span></div>`).join("")}
      </div>
      <div class="card"><h3>📢 Broadcast</h3>
        <form method="POST" action="/dashboard/admin/broadcast">
          <textarea name="message" rows="3" placeholder="Message to all chats..."></textarea>
          <button type="submit" class="btn btn-primary">Send Broadcast</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage("Admin", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});

router.post("/admin/broadcast", checkAuth, (req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", async () => {
    const msg = new URLSearchParams(body).get("message");
    try { if (msg) await require("./tools/botAdmin").broadcastToAll(msg); } catch (_) {}
    res.redirect("/dashboard/admin");
  });
});

module.exports = router;
module.exports.checkAuth = checkAuth;
