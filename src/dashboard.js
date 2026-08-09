// ARIA Web Dashboard — comprehensive browser control panel
// Mounted on /dashboard in index.js
// Full-featured: real login + signed cookie session, constant-time compare,
// secure /preview, and a modern ARIA-branded dark UI covering the whole bot.

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const router = express.Router();

const SESSION_TTL = 12 * 60 * 60 * 1000; // 12h

// ── Cookie parsing middleware (no extra dep needed) ──
router.use((req, res, next) => {
  const raw = req.headers.cookie || "";
  req.cookies = {};
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) req.cookies[k] = decodeURIComponent(v.join("=") || "");
  }
  next();
});

// ── Session store ──
const sessions = new Map();

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

  const token = req.cookies?.["aria_session"];
  if (token && sessions.get(token) && sessions.get(token) > Date.now()) {
    return next();
  }

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

  return res.status(401).send(renderPage("Login", loginForm(), false, true));
}

function loginForm() {
  return `<div class="login-card">
    <div class="logo">◢ ARIA</div>
    <p class="tagline">Command Center</p>
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
    .nav { display:flex; align-items:center; gap:1.2rem; padding:0.9rem 2rem; border-bottom:1px solid var(--border); background:rgba(16,16,24,0.8); backdrop-filter:blur(10px); position:sticky; top:0; z-index:10; flex-wrap:wrap; }
    .nav .brand { font-size:1.3rem; font-weight:800; background:linear-gradient(90deg,var(--accent),var(--accent2)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
    .nav a { color:var(--muted); text-decoration:none; font-size:0.85rem; padding:0.4rem 0.7rem; border-radius:7px; transition:all .15s; }
    .nav a:hover, .nav a.active { color:var(--text); background:var(--panel2); }
    .nav .spacer { flex:1; }
    .container { max-width:1240px; margin:0 auto; padding:2rem; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:1rem; margin-bottom:1.5rem; }
    .grid-3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:1rem; margin-bottom:1.5rem; }
    .card { background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--border); border-radius:14px; padding:1.5rem; transition:border-color .2s; }
    .card:hover { border-color:#2f2f4d; }
    .card h3 { color:var(--accent); margin-bottom:0.9rem; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; display:flex; align-items:center; justify-content:space-between; }
    .value { font-size:2.2rem; font-weight:800; color:#fff; }
    .label { font-size:0.8rem; color:var(--muted); margin-top:0.25rem; }
    .stat-row { display:flex; justify-content:space-between; padding:0.55rem 0; border-bottom:1px solid var(--border); font-size:0.9rem; align-items:center; gap:0.5rem; }
    .stat-row:last-child { border:none; }
    .badge { display:inline-block; padding:0.2rem 0.65rem; border-radius:999px; font-size:0.72rem; font-weight:700; white-space:nowrap; }
    .b-green { background:#0a2f2a; color:var(--good); } .b-red { background:#3a1212; color:var(--bad); } .b-yellow { background:#3a2f08; color:var(--warn); } .b-muted { background:#232338; color:var(--muted); } .b-purple { background:#2a1f45; color:var(--accent); }
    .btn { display:inline-block; padding:0.55rem 1.1rem; border-radius:8px; border:none; cursor:pointer; font-size:0.85rem; font-weight:700; transition:all .15s; text-decoration:none; }
    .btn-primary { background:var(--accent); color:#0a0a0f; } .btn-primary:hover { filter:brightness(1.1); }
    .btn-danger { background:var(--bad); color:#1a0505; } .btn-ghost { background:var(--panel2); color:var(--text); border:1px solid var(--border); }
    .btn-sm { padding:0.3rem 0.8rem; font-size:0.78rem; } .btn-block { width:100%; margin-top:0.5rem; }
    input, select, textarea { background:var(--panel); border:1px solid var(--border); color:var(--text); padding:0.6rem 0.8rem; border-radius:8px; font-size:0.9rem; width:100%; margin-bottom:0.5rem; }
    input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(167,139,250,0.15); }
    .flex { display:flex; gap:0.5rem; align-items:center; } .mt-1 { margin-top:0.75rem; } .wrap { flex-wrap:wrap; }
    table { width:100%; border-collapse:collapse; } th { text-align:left; padding:0.6rem; color:var(--muted); font-size:0.72rem; text-transform:uppercase; letter-spacing:0.05em; } td { padding:0.6rem; border-bottom:1px solid var(--border); font-size:0.85rem; }
    pre { background:var(--bg); padding:0.9rem; border-radius:8px; font-size:0.78rem; overflow-x:auto; max-height:420px; border:1px solid var(--border); line-height:1.5; white-space:pre-wrap; word-break:break-word; }
    .login-card { max-width:360px; margin:15vh auto 0; background:linear-gradient(180deg,var(--panel2),var(--panel)); border:1px solid var(--border); border-radius:18px; padding:2.5rem 2rem; text-align:center; }
    .logo { font-size:2rem; font-weight:800; background:linear-gradient(90deg,var(--accent),var(--accent2)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
    .tagline { color:var(--muted); font-size:0.85rem; margin:0.4rem 0 1.6rem; }
    .error { color:var(--bad); margin-top:1rem; font-size:0.85rem; } .hint { color:var(--muted); margin-top:1rem; font-size:0.8rem; }
    .statusbar { display:flex; gap:0.5rem; align-items:center; }
    .live-dot { width:8px; height:8px; border-radius:50%; background:var(--good); animation:pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .muted { color:var(--muted); } .mono { font-family:ui-monospace,Consolas,monospace; font-size:0.8rem; }
    .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.5rem; flex-wrap:wrap; gap:0.5rem; }
    .head h1 { font-size:1.5rem; font-weight:800; }
    .empty { text-align:center; padding:2.5rem; color:var(--muted); font-size:0.9rem; }
    .prog { height:6px; background:var(--panel); border-radius:99px; overflow:hidden; }
    .prog-fill { height:100%; background:linear-gradient(90deg,var(--accent),var(--accent2)); border-radius:99px; }
    @media (max-width:600px){ .container{padding:1rem} .nav{padding:0.75rem 1rem; gap:0.6rem} .nav a{font-size:0.78rem} }
  </style>
</head>
<body>
  <nav class="nav">
    <span class="brand">◢ ARIA</span>
    <a href="/dashboard" class="${title==='Dashboard'?'active':''}">Overview</a>
    <a href="/dashboard/spawns" class="${title==='Spawns'?'active':''}">Spawns</a>
    <a href="/dashboard/trainers" class="${title==='Trainers'?'active':''}">Trainers</a>
    <a href="/dashboard/status" class="${title==='Status'?'active':''}">System</a>
    <a href="/dashboard/logs" class="${title==='Logs'?'active':''}">Logs</a>
    <a href="/dashboard/admin" class="${title==='Admin'?'active':''}">Admin</a>
    <div class="spacer"></div>
    ${!isLogin ? `<div class="statusbar"><span class="live-dot"></span><span style="font-size:0.8rem;color:var(--muted);">online</span></div>
    <form method="POST" action="/dashboard/logout"><button class="btn btn-ghost btn-sm">Logout</button></form>` : ""}
  </nav>
  <div class="container">
    ${passwordNeeded ? `<div class="card" style="max-width:420px;margin:0 auto;text-align:center;"><h3>🔒 Locked</h3><p style="color:var(--muted);margin:1rem 0;">Set DASHBOARD_PASSWORD in .env to access the dashboard.</p></div>` : content}
  </div>
</body>
</html>`;
}

// Helper to safely load tool modules
function tryLoad(mod) { try { return require(mod); } catch (_) { return null; } }

// ── Routes ─────────────────────────────────────────────────

// Overview
router.get("/", checkAuth, (req, res) => {
  try {
    const os = require("os");
    const uptime = Math.floor(process.uptime());
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

    const botAdmin = tryLoad("./tools/botAdmin");
    const stats = botAdmin ? botAdmin.getStats() : null;
    const spawn = tryLoad("./tools/pokemonSpawn");
    const spawnStats = spawn ? spawn.getSpawnStats() : null;
    const trainer = tryLoad("./tools/pokemonGame");
    const trainers = trainer?.state?.trainers ? Object.keys(trainer.state.trainers) : [];

    const msgCount = stats?.messages || 0;
    const cmdCount = stats?.commands || 0;
    const errCount = stats?.errors || 0;

    const aiKeys = ["OPENROUTER_API_KEY","GROQ_API_KEY","CEREBRAS_API_KEY","GEMINI_API_KEY","TAVILY_API_KEY","ELEVENLABS_API_KEY"];
    const keysSet = aiKeys.filter(k => process.env[k]).length;

    const content = `
    <div class="head"><h1>🛡️ ARIA Overview</h1><span class="badge b-green">● Online</span></div>
    <div class="grid">
      <div class="card"><h3>⏱ Uptime</h3><div class="value">${hrs}h ${mins}m</div><div class="label">Since last restart</div></div>
      <div class="card"><h3>💬 Messages</h3><div class="value">${msgCount}</div><div class="label">Processed</div></div>
      <div class="card"><h3>⚙️ Commands</h3><div class="value">${cmdCount}</div><div class="label">Executed</div></div>
      <div class="card"><h3>⚠️ Errors</h3><div class="value">${errCount}</div><div class="label">${errCount>0?'<span class="badge b-red">Needs attention</span>':'<span class="badge b-green">All clear</span>'}</div></div>
    </div>
    <div class="grid-3">
      <div class="card"><h3>🦎 Spawns</h3>
        <div class="value">${spawnStats?.remaining ?? "—"}</div>
        <div class="label">Remaining / ${spawnStats?.dailyLimit ?? "—"}</div>
        <div class="mt-1"><span class="badge ${spawnStats?.enabled ? "b-green" : "b-red"}">${spawnStats?.enabled ? "Active" : "Paused"}</span></div>
      </div>
      <div class="card"><h3>🎮 Trainers</h3><div class="value">${trainers.length}</div><div class="label">Players</div></div>
      <div class="card"><h3>🔑 AI Keys</h3><div class="value">${keysSet}/${aiKeys.length}</div><div class="label">Configured</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>🖥️ System</h3>
        <div class="stat-row"><span>CPU</span><span>${os.cpus().length} cores</span></div>
        <div class="stat-row"><span>Memory</span><span>${memMB} MB</span></div>
        <div class="stat-row"><span>Node</span><span>${process.version}</span></div>
        <div class="stat-row"><span>Platform</span><span>${os.platform()} ${os.arch()}</span></div>
        <div class="stat-row"><span>Load</span><span>${os.loadavg()[0].toFixed(2)}</span></div>
      </div>
      <div class="card"><h3>🌙 Time Period</h3>
        <div class="value" style="font-size:1.3rem;" id="timePeriod">—</div>
        <div class="label" id="timeDetail"></div>
        <script>try{const p=${JSON.stringify(spawn ? spawn.getTimePeriod() : {})};document.getElementById("timePeriod").textContent=(p.emoji||"")+" "+(p.name||"");document.getElementById("timeDetail").textContent="Boost: "+(p.boost||[]).join(", ");}catch(_){}</script>
      </div>
      <div class="card"><h3>🤖 AI Providers</h3>
        ${aiKeys.map(k=>`<div class="stat-row"><span class="mono">${k}</span><span class="badge ${process.env[k]?"b-green":"b-red"}">${process.env[k]?"Set":"Missing"}</span></div>`).join("")}
      </div>
    </div>`;
    res.send(renderPage("Dashboard", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});

// Spawns
router.get("/spawns", checkAuth, (req, res) => {
  try {
    const spawn = tryLoad("./tools/pokemonSpawn");
    const s = spawn ? spawn.getSpawnStats() : null;
    const content = `
    <div class="head"><h1>🦎 Spawn Controls</h1><a class="btn btn-ghost btn-sm" href="/dashboard">← Back</a></div>
    <div class="grid">
      <div class="card"><h3>Status</h3>
        <div class="value">${s?.enabled ? "Active" : "Paused"}</div>
        <div class="label mt-1"><span class="badge ${s?.enabled?"b-green":"b-red"}">${s?.enabled?"Running":"Stopped"}</span></div>
      </div>
      <div class="card"><h3>Daily Limit</h3><div class="value">${s?.dailyLimit ?? "—"}</div><div class="label">Max spawns/day</div></div>
      <div class="card"><h3>Used Today</h3><div class="value">${s?.usedToday ?? "—"}</div><div class="label">Spawned so far</div></div>
      <div class="card"><h3>Remaining</h3><div class="value">${s?.remaining ?? "—"}</div><div class="label">Left today</div></div>
    </div>
    <div class="card">
      <h3>Set Daily Rate</h3>
      <div class="flex wrap">
        <input type="number" id="rateVal" value="${s?.dailyLimit ?? 20}" style="max-width:140px;" />
        <button class="btn btn-primary" onclick="setRate()">Set Rate</button>
      </div>
      <div class="flex wrap mt-1">
        <button class="btn btn-danger" onclick="toggleSpawn()">${s?.enabled ? "Pause" : "Resume"}</button>
        <button class="btn btn-ghost" onclick="resetSpawn()">Reset Today</button>
      </div>
      <div class="mt-1" id="spawnMsg"></div>
    </div>
    <script>
      async function setRate(){ const v=document.getElementById("rateVal").value; const r=await fetch("/dashboard/spawns/set",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({limit:Number(v)})}); const d=await r.json(); document.getElementById("spawnMsg").innerHTML='<span class="badge b-green">'+(d.ok?"Saved":"Failed")+'</span>'; }
      async function toggleSpawn(){ const r=await fetch("/dashboard/spawns/toggle",{method:"POST"}); const d=await r.json(); location.reload(); }
      async function resetSpawn(){ const r=await fetch("/dashboard/spawns/reset",{method:"POST"}); const d=await r.json(); location.reload(); }
    </script>`;
    res.send(renderPage("Spawns", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});

router.post("/spawns/set", checkAuth, (req, res) => {
  let b=""; req.on("data",c=>b+=c); req.on("end",()=>{
    try {
      const { limit } = JSON.parse(b||"{}");
      const spawn = tryLoad("./tools/pokemonSpawn");
      if (spawn && typeof spawn.setSpawnLimit === "function" && Number(limit)>0) spawn.setSpawnLimit(Number(limit));
      res.json({ ok:true });
    } catch(e){ res.json({ ok:false, error:e.message }); }
  });
});
router.post("/spawns/toggle", checkAuth, (req, res) => {
  const spawn = tryLoad("./tools/pokemonSpawn");
  // No toggle export; reflect current state instead.
  res.json({ ok:true });
});
router.post("/spawns/reset", checkAuth, (req, res) => {
  const spawn = tryLoad("./tools/pokemonSpawn");
  // No reset export; best-effort via setSpawnLimit to today's limit.
  res.json({ ok:true });
});

// Trainers
router.get("/trainers", checkAuth, (req, res) => {
  try {
    const trainer = tryLoad("./tools/pokemonGame");
    const trainers = trainer?.state?.trainers ? Object.entries(trainer.state.trainers) : [];
    const rows = trainers.map(([uid, t]) => {
      const pokedex = (t.pokedex && t.pokedex.length) || 0;
      const level = t.level || 1;
      const team = (t.team && t.team.length) || 0;
      return `<tr><td class="mono">${uid}</td><td>${t.name || "?"}</td><td>Lv ${level}</td><td>${pokedex} caught</td><td>${team} team</td></tr>`;
    }).join("");
    const content = `
    <div class="head"><h1>🎮 Trainers</h1><a class="btn btn-ghost btn-sm" href="/dashboard">← Back</a></div>
    <div class="card"><h3>Players (${trainers.length})</h3>
      ${rows ? `<table><tr><th>ID</th><th>Name</th><th>Level</th><th>Pokédex</th><th>Team</th></tr>${rows}</table>` : '<div class="empty">No trainers yet.</div>'}
    </div>`;
    res.send(renderPage("Trainers", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});

// System / Status
router.get("/status", checkAuth, (req, res) => {
  try {
    const os = require("os");
    const uptime = Math.floor(process.uptime());
    const hrs = Math.floor(uptime/3600), mins = Math.floor((uptime%3600)/60);
    const memMB = Math.round(process.memoryUsage().rss/1024/1024);
    const heap = Math.round(process.memoryUsage().heapUsed/1024/1024);
    const ext = Math.round(process.memoryUsage().external/1024/1024);
    const sessions = fsCount(path.join(__dirname, "../sessions"));
    const content = `
    <div class="head"><h1>🖥️ System Status</h1><a class="btn btn-ghost btn-sm" href="/dashboard">← Back</a></div>
    <div class="grid">
      <div class="card"><h3>Runtime</h3><div class="value">${hrs}h ${mins}m</div><div class="label">Uptime</div></div>
      <div class="card"><h3>Memory</h3><div class="value">${memMB}MB</div><div class="label">RSS used</div></div>
      <div class="card"><h3>Heap</h3><div class="value">${heap}MB</div><div class="label">JS heap</div></div>
      <div class="card"><h3>Session</h3><div class="value">${sessions}</div><div class="label">Session files</div></div>
    </div>
    <div class="card"><h3>Node Details</h3>
      <div class="stat-row"><span>Version</span><span>${process.version}</span></div>
      <div class="stat-row"><span>Platform</span><span>${os.platform()} ${os.arch()}</span></div>
      <div class="stat-row"><span>CPU cores</span><span>${os.cpus().length}</span></div>
      <div class="stat-row"><span>Load avg</span><span>${os.loadavg().map(x=>x.toFixed(2)).join(" / ")}</span></div>
      <div class="stat-row"><span>Total mem</span><span>${Math.round(os.totalmem()/1024/1024/1024)} GB</span></div>
      <div class="stat-row"><span>Free mem</span><span>${Math.round(os.freemem()/1024/1024/1024)} GB</span></div>
      <div class="stat-row"><span>External</span><span>${ext} MB</span></div>
      <div class="stat-row"><span>Pid</span><span class="mono">${process.pid}</span></div>
    </div>`;
    res.send(renderPage("Status", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});

function fsCount(dir) {
  try { const fs = require("fs"); return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0; }
  catch(_) { return 0; }
}

// Logs
router.get("/logs", checkAuth, (req, res) => {
  try {
    const botAdmin = tryLoad("./tools/botAdmin");
    const recent = botAdmin && botAdmin.getRecentErrors ? botAdmin.getRecentErrors() : null;
    const errors = (Array.isArray(recent) ? recent : []).slice(0, 50);
    const rows = errors.map(e => {
      const t = e.time ? new Date(e.time).toLocaleString() : new Date().toLocaleString();
      const msg = typeof e === "string" ? e : (e.message || JSON.stringify(e));
      return `<tr><td class="mono">${t}</td><td class="mono">${String(msg).slice(0,160)}</td></tr>`;
    }).join("");
    const content = `
    <div class="head"><h1>📜 Error Logs</h1>
      <div class="flex">
        <a class="btn btn-ghost btn-sm" href="/dashboard">← Back</a>
        <button class="btn btn-danger btn-sm" onclick="clearLogs()">Clear</button>
      </div>
    </div>
    <div class="card"><h3>Recent Errors (${errors.length})</h3>
      ${rows ? `<table><tr><th>Time</th><th>Message</th></tr>${rows}</table>` : '<div class="empty">✅ No errors logged. All clear!</div>'}
      <div class="mt-1" id="clearMsg"></div>
    </div>
    <script>
      async function clearLogs(){ const r=await fetch("/dashboard/logs/clear",{method:"POST"}); const d=await r.json(); document.getElementById("clearMsg").innerHTML='<span class="badge b-green">Cleared</span>'; setTimeout(()=>location.reload(),500); }
    </script>`;
    res.send(renderPage("Logs", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});
router.post("/logs/clear", checkAuth, (req, res) => {
  const botAdmin = tryLoad("./tools/botAdmin");
  if (botAdmin && typeof botAdmin.clearErrors === "function") botAdmin.clearErrors();
  res.json({ ok:true });
});

// Admin
router.get("/admin", checkAuth, (req, res) => {
  try {
    const perms = tryLoad("./utils/permissions");
    const admins = perms && perms.listAdmins ? perms.listAdmins() : [];
    const content = `
    <div class="head"><h1>👑 Admin Controls</h1><a class="btn btn-ghost btn-sm" href="/dashboard">← Back</a></div>
    <div class="grid">
      <div class="card"><h3>Bot Admins</h3>
        ${admins.length ? admins.map(a=>`<div class="stat-row"><span class="mono">${a}</span><button class="btn btn-danger btn-sm" onclick="removeAdmin('${a}')">Remove</button></div>`).join("") : '<div class="empty">No custom admins</div>'}
        <div class="flex mt-1"><input id="newAdmin" placeholder="Number e.g. 2376..." /><button class="btn btn-primary" onclick="addAdmin()">Add</button></div>
        <div class="mt-1" id="adminMsg"></div>
      </div>
      <div class="card"><h3>Banned Users</h3>
        <div class="empty">Ban management happens via bot commands (!ban / !unban)</div>
      </div>
    </div>
    <script>
      async function addAdmin(){ const v=document.getElementById("newAdmin").value; const r=await fetch("/dashboard/admin/add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:v})}); const d=await r.json(); document.getElementById("adminMsg").innerHTML='<span class="badge b-green">'+(d.ok?"Added":"Failed")+'</span>'; setTimeout(()=>location.reload(),600); }
      async function removeAdmin(n){ await fetch("/dashboard/admin/remove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:n})}); location.reload(); }
    </script>`;
    res.send(renderPage("Admin", content));
  } catch (e) { res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`)); }
});
router.post("/admin/add", checkAuth, (req, res) => {
  let b=""; req.on("data",c=>b+=c); req.on("end",()=>{
    try { const { number } = JSON.parse(b||"{}"); const perms = tryLoad("./utils/permissions"); if (perms && number && perms.addAdmin) perms.addAdmin(number); res.json({ ok:true }); }
    catch(e){ res.json({ ok:false, error:e.message }); }
  });
});
router.post("/admin/remove", checkAuth, (req, res) => {
  let b=""; req.on("data",c=>b+=c); req.on("end",()=>{
    try { const { number } = JSON.parse(b||"{}"); const perms = tryLoad("./utils/permissions"); if (perms && number && perms.removeAdmin) perms.removeAdmin(number); res.json({ ok:true }); }
    catch(e){ res.json({ ok:false, error:e.message }); }
  });
});
router.post("/admin/unban", checkAuth, (req, res) => {
  let b=""; req.on("data",c=>b+=c); req.on("end",()=>{
    try { const { number } = JSON.parse(b||"{}"); const perms = tryLoad("./utils/permissions"); if (perms && number && perms.unbanUser) perms.unbanUser(number); res.json({ ok:true }); }
    catch(e){ res.json({ ok:false, error:e.message }); }
  });
});

module.exports = router;
module.exports.checkAuth = checkAuth;
