// ARIA Home — personal intelligence cockpit
// Mounted on /dashboard in index.js
// A living interface for a persistent intelligence, not a stats grid.
// Auth: real login + signed cookie session, constant-time compare.

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const router = express.Router();

const SESSION_TTL = 12 * 60 * 60 * 1000;

// ── Cookie parsing middleware ──
router.use((req, res, next) => {
  const raw = req.headers.cookie || "";
  req.cookies = {};
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) req.cookies[k] = decodeURIComponent(v.join("=") || "");
  }
  next();
});

const sessions = new Map();

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
  if (token && sessions.get(token) && sessions.get(token) > Date.now()) return next();
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) {
    if (constantTimeEqual(auth.slice(7), pw)) {
      const t = crypto.randomBytes(24).toString("hex");
      sessions.set(t, Date.now() + SESSION_TTL);
      res.cookie("aria_session", t, { httpOnly: true, maxAge: SESSION_TTL, sameSite: "lax" });
      return next();
    }
  } else if (auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      if (constantTimeEqual(decoded.split(":")[1] || "", pw)) {
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
    <div class="logo"><span class="orb"></span> ARIA</div>
    <p class="tagline">personal intelligence cockpit</p>
    <form method="POST" action="/dashboard/login">
      <input type="password" name="password" placeholder="access key" autofocus required />
      <button type="submit" class="btn btn-primary btn-block">Enter</button>
    </form>
    ${process.env.DASHBOARD_PASSWORD ? "" : '<p class="hint">Set DASHBOARD_PASSWORD in env</p>'}
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
    return res.status(401).send(renderPage("Login", loginForm() + '<p class="error">Wrong key.</p>', false, true));
  });
});

router.post("/logout", (req, res) => {
  const token = req.cookies?.["aria_session"];
  if (token) sessions.delete(token);
  res.clearCookie("aria_session");
  res.redirect("/dashboard");
});

function tryLoad(mod) { try { return require(mod); } catch (_) { return null; } }

// Collect live data for the cockpit
function collectData() {
  const os = tryLoad("os") || {};
  const uptime = Math.floor(process.uptime());
  const hrs = Math.floor(uptime / 3600), mins = Math.floor((uptime % 3600) / 60);
  const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  const botAdmin = tryLoad("./tools/botAdmin");
  const stats = botAdmin ? botAdmin.getStats() : null;
  const errors = botAdmin ? (botAdmin.getRecentErrors ? botAdmin.getRecentErrors(8) : []) : [];

  const spawn = tryLoad("./tools/pokemonSpawn");
  const spawnStats = spawn ? spawn.getSpawnStats() : null;

  const durable = tryLoad("./tools/durableMissions");
  const missions = durable && durable.getAllMissions ? durable.getAllMissions() : (durable && durable.getMissions ? durable.getMissions("*") : []);
  const activeMissions = missions.filter((m) => m.status === "running" || m.status === "pending");

  const world = tryLoad("./utils/worldModel");
  let entities = [], goals = [], relations = [];
  if (world) {
    try { const m = world.getUserModel ? world.getUserModel("*") : null; entities = Object.values(m?.entities || {}); relations = m?.relations || []; } catch (_) {}
    try { goals = world.getActiveGoals ? world.getActiveGoals("*") : []; } catch (_) {}
  }

  const mem = tryLoad("./utils/semanticMemory");
  let memories = [];
  try { const store = mem && mem.getUserStore ? mem.getUserStore("*") : null; memories = store?.memories || []; } catch (_) {}

  const aiKeys = ["OPENROUTER_API_KEY","GROQ_API_KEY","CEREBRAS_API_KEY","GEMINI_API_KEY","TAVILY_API_KEY","ELEVENLABS_API_KEY"];
  const keysSet = aiKeys.filter((k) => process.env[k]).length;

  return { uptime, hrs, mins, memMB, heapMB, os, stats, errors, spawnStats, missions, activeMissions, entities, goals, relations, memories, aiKeys, keysSet };
}

function renderPage(title, content, passwordNeeded = false, isLogin = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} | ARIA</title>
<style>
:root{
  --bg:#05060a; --bg2:#0a0c14; --panel:#0e111c; --panel2:#141827; --panel3:#1a2033;
  --border:#1e2440; --border2:#2a3355; --text:#e9edf7; --muted:#8b93b8; --faint:#5a6288;
  --violet:#8b7cf6; --cyan:#22d3ee; --teal:#2dd4bf; --green:#34d399; --amber:#fbbf24;
  --red:#f87171; --pink:#f472b6; --glow:0 0 24px rgba(139,124,246,.25);
  --r:16px; --sh:0 10px 40px rgba(0,0,0,.5);
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:
  radial-gradient(1100px 500px at 85% -10%, rgba(139,124,246,.14), transparent 60%),
  radial-gradient(900px 500px at -10% 110%, rgba(34,211,238,.10), transparent 55%),
  var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}
a{color:inherit;text-decoration:none}
.mono{font-family:ui-monospace,'JetBrains Mono',Consolas,monospace}

/* ── Layout shell ── */
.app{display:grid;grid-template-columns:240px 1fr;min-height:100vh}
.sidebar{background:linear-gradient(180deg,var(--bg2),var(--bg));border-right:1px solid var(--border);padding:22px 16px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;z-index:20}
.main{padding:26px 30px;max-width:1400px;width:100%}
@media(max-width:900px){.app{grid-template-columns:1fr}.sidebar{position:fixed;bottom:0;top:auto;width:100%;height:auto;flex-direction:row;justify-content:space-around;padding:8px 10px;border-top:1px solid var(--border);border-right:none;z-index:100}.sidebar .brand,.sidebar .presence-mini{display:none}.main{padding-bottom:70px}}

/* ── Sidebar ── */
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;padding:6px 8px 20px}
.brand .logo{font-size:24px}
.side-nav{display:flex;flex-direction:column;gap:4px;flex:1}
.nav-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;color:var(--muted);font-size:14px;font-weight:500;transition:.18s;cursor:pointer;border:1px solid transparent}
.nav-item:hover{color:var(--text);background:var(--panel2)}
.nav-item.active{color:#fff;background:linear-gradient(90deg,rgba(139,124,246,.18),rgba(34,211,238,.08));border-color:var(--border2)}
.nav-item .ico{width:18px;text-align:center}
.nav-item .count{margin-left:auto;font-size:11px;background:var(--panel3);padding:1px 7px;border-radius:99px;color:var(--cyan)}
.presence-mini{margin-top:14px;padding:12px;background:var(--panel);border:1px solid var(--border);border-radius:12px}
.presence-mini .prow{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}

/* ── Header ── */
.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;gap:14px;flex-wrap:wrap}
.topbar h1{font-size:22px;font-weight:800}
.topbar .sub{color:var(--muted);font-size:13px;margin-top:3px}
.search{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:9px 14px;display:flex;align-items:center;gap:9px;min-width:220px;color:var(--faint);font-size:13px}
.search input{background:none;border:none;color:var(--text);outline:none;width:100%;font-size:13px}
.action-row{display:flex;gap:8px}

/* ── Cards & grids ── */
.grid{display:grid;gap:16px}
.g4{grid-template-columns:repeat(4,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g2{grid-template-columns:repeat(2,1fr)}
.g-hero{grid-template-columns:1.4fr 1fr}
@media(max-width:1000px){.g4{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:1fr}.g2{grid-template-columns:1fr}.g-hero{grid-template-columns:1fr}}
@media(max-width:560px){.g4{grid-template-columns:1fr}}
.card{background:linear-gradient(180deg,var(--panel),var(--bg2));border:1px solid var(--border);border-radius:var(--r);padding:18px;transition:.2s;position:relative;overflow:hidden}
.card:hover{border-color:var(--border2)}
.card .c-title{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);font-weight:700;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between}
.card .c-title .dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.stat-value{font-size:30px;font-weight:800;letter-spacing:-.5px}
.stat-label{color:var(--muted);font-size:12px;margin-top:3px}
.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700}
.b-green{background:rgba(52,211,153,.14);color:var(--green)}.b-red{background:rgba(248,113,113,.14);color:var(--red)}.b-amber{background:rgba(251,191,36,.14);color:var(--amber)}.b-violet{background:rgba(139,124,246,.16);color:var(--violet)}.b-cyan{background:rgba(34,211,238,.14);color:var(--cyan)}.b-muted{background:var(--panel3);color:var(--muted)}
.row{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);gap:8px}
.row:last-child{border:none}
.row .k{color:var(--muted);font-size:13px}
.row .v{font-weight:600;font-size:13px;text-align:right}

/* ── Presence hero ── */
.hero{background:linear-gradient(135deg,rgba(139,124,246,.16),rgba(34,211,238,.08) 50%,rgba(45,212,191,.06)),var(--panel);border:1px solid var(--border2);border-radius:20px;padding:24px;position:relative;overflow:hidden;margin-bottom:16px}
.hero::before{content:'';position:absolute;top:-60%;right:-20%;width:340px;height:340px;background:radial-gradient(circle,rgba(139,124,246,.25),transparent 70%);filter:blur(30px);animation:float 8s ease-in-out infinite}
.hero-inner{position:relative;display:flex;gap:22px;align-items:center;flex-wrap:wrap}
.avatar{width:78px;height:78px;border-radius:22px;background:linear-gradient(135deg,var(--violet),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:36px;box-shadow:var(--glow);position:relative;flex-shrink:0}
.avatar::after{content:'';position:absolute;inset:-6px;border-radius:26px;border:1px solid rgba(139,124,246,.35);animation:pulse 3s ease-in-out infinite}
.hero h2{font-size:24px;font-weight:800;display:flex;align-items:center;gap:10px}
.hero .one-liner{color:var(--muted);font-size:14px;margin-top:6px;max-width:600px}
.hero .h-actions{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-16px)}}
@keyframes pulse{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}
.live-dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green);animation:pulse 2s infinite;display:inline-block}

/* ── Mission spotlight ── */
.mission-card{border-left:3px solid var(--violet)}
.mission-name{font-size:17px;font-weight:800;margin-bottom:6px}
.mission-desc{color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:14px}
.progress{height:8px;background:var(--panel3);border-radius:99px;overflow:hidden;margin-bottom:6px}
.progress-fill{height:100%;background:linear-gradient(90deg,var(--violet),var(--cyan));border-radius:99px;transition:width .6s}
.progress-label{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}

/* ── Timeline / feed ── */
.feed{display:flex;flex-direction:column;gap:0}
.feed-item{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);font-size:13px}
.feed-item:last-child{border:none}
.feed-ico{width:30px;height:30px;border-radius:8px;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.feed-body .t{color:var(--text);font-weight:500}
.feed-body .s{color:var(--faint);font-size:11px;margin-top:2px}
.feed-body .m{color:var(--muted);font-size:12px;margin-top:2px;line-height:1.4}

/* ── Buttons ── */
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:10px;border:none;cursor:pointer;font-size:13px;font-weight:700;transition:.18s;background:var(--panel2);color:var(--text);border:1px solid var(--border)}
.btn:hover{transform:translateY(-1px);border-color:var(--border2)}
.btn-primary{background:linear-gradient(90deg,var(--violet),var(--cyan));color:#0a0a12;border:none}
.btn-primary:hover{filter:brightness(1.1)}
.btn-ghost{background:transparent;border:1px solid var(--border2)}
.btn-sm{padding:6px 11px;font-size:12px}
.btn-block{width:100%;justify-content:center;margin-top:8px}

/* ── Logs / mono ── */
pre.log{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:12px;overflow:auto;max-height:340px;color:#c6cdf0;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.err{color:var(--red)}
.ok{color:var(--green)}

/* ── Tabs inside cards ── */
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.chip{padding:5px 11px;border-radius:99px;font-size:12px;cursor:pointer;background:var(--panel2);border:1px solid var(--border);color:var(--muted);transition:.15s}
.chip.active{background:linear-gradient(90deg,var(--violet),var(--cyan));color:#0a0a12;border:none;font-weight:700}
.pane{display:none}
.pane.show{display:block;animation:fade .3s}
@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ── Login ── */
.login-card{max-width:360px;margin:18vh auto 0;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--border2);border-radius:22px;padding:38px 30px;text-align:center;box-shadow:var(--sh)}
.login-card .logo{font-size:30px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:10px}
.login-card .orb{width:14px;height:14px;border-radius:50%;background:var(--cyan);box-shadow:0 0 14px var(--cyan);animation:pulse 2s infinite}
.login-card .tagline{color:var(--muted);font-size:13px;margin:8px 0 24px}
.login-card input{background:var(--bg);border:1px solid var(--border);color:var(--text);padding:13px 16px;border-radius:11px;font-size:15px;width:100%;outline:none}
.login-card input:focus{border-color:var(--violet);box-shadow:0 0 0 3px rgba(139,124,246,.15)}
.error{color:var(--red);margin-top:14px;font-size:13px}
.hint{color:var(--faint);margin-top:14px;font-size:12px}
.empty{text-align:center;padding:26px;color:var(--faint);font-size:13px}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><span class="logo">◢</span> ARIA</div>
    <nav class="side-nav" id="nav">
      <a class="nav-item active" data-pane="home"><span class="ico">◉</span> Home</a>
      <a class="nav-item" data-pane="missions"><span class="ico">◆</span> Missions <span class="count" id="missionCount">0</span></a>
      <a class="nav-item" data-pane="memory"><span class="ico">✎</span> Memory</a>
      <a class="nav-item" data-pane="spawns"><span class="ico">⚡</span> Spawns</a>
      <a class="nav-item" data-pane="trainers"><span class="ico">🎮</span> Trainers</a>
      <a class="nav-item" data-pane="activity"><span class="ico">≋</span> Activity</a>
      <a class="nav-item" data-pane="system"><span class="ico">▣</span> System</a>
      <a class="nav-item" data-pane="admin"><span class="ico">👑</span> Admin</a>
    </nav>
    <div class="presence-mini">
      <div class="prow"><span class="live-dot"></span> <span>online</span></div>
      <div class="prow" style="margin-top:6px;color:var(--faint)">ARIA · ${process.env.BOT_NAME || "v2"}</div>
    </div>
  </aside>

  <main class="main">
    <div class="topbar">
      <div><h1 id="pageTitle">ARIA Home</h1><div class="sub" id="pageSub">what's she up to right now</div></div>
      <div class="action-row">
        <div class="search"><span>⌕</span><input placeholder="search commands, memory, missions..." /></div>
        <form method="POST" action="/dashboard/logout"><button class="btn btn-ghost btn-sm">Leave</button></form>
      </div>
    </div>
    ${passwordNeeded ? `<div class="card" style="max-width:420px;margin:0 auto;text-align:center"><h3>🔒 Locked</h3><p style="color:var(--muted);margin:12px 0">Set DASHBOARD_PASSWORD in env.</p></div>` : content}
  </main>
</div>
<script>
// Nav switching
const navs=document.querySelectorAll('.nav-item');
const titles={home:['ARIA Home','what\'s she up to right now'],missions:['Missions','what ARIA is building and tracking'],memory:['Memory','what ARIA remembers about you'],spawns:['Spawns','wild pokemon control'],trainers:['Trainers','all the players'],activity:['Activity','timeline of what ARIA did'],system:['System','health and ecosystem'],admin:['Admin','access control']};
function showPane(p){
  navs.forEach(n=>n.classList.toggle('active',n.dataset.pane===p));
  document.querySelectorAll('.pane').forEach(x=>x.classList.remove('show'));
  const el=document.getElementById('pane-'+p); if(el)el.classList.add('show');
  const t=titles[p]||['','']; document.getElementById('pageTitle').textContent=t[0]; document.getElementById('pageSub').textContent=t[1];
}
navs.forEach(n=>n.addEventListener('click',()=>showPane(n.dataset.pane)));
showPane('home');
</script>
</body>
</html>`;
}

// ── Panes ───────────────────────────────────────────────────

router.get("/", checkAuth, (req, res) => {
  try {
    const d = collectData();
    const errBadge = d.errors.length ? `<span class="badge b-red">${d.errors.length} incidents</span>` : `<span class="badge b-green">all clear</span>`;
    const missionCount = d.missions.length;
    const activeMission = d.activeMissions[0] || d.missions[0];

    const content = `
    <!-- HOME -->
    <section class="pane show" id="pane-home">
      <div class="hero">
        <div class="hero-inner">
          <div class="avatar">◢</div>
          <div>
            <h2>ARIA <span class="badge b-green"><span class="live-dot" style="width:6px;height:6px"></span> online</span></h2>
            <div class="one-liner">I'm monitoring your projects and waiting on ${d.activeMissions.length} active mission${d.activeMissions.length===1?"":"s"}. ${d.errors.length ? "There are ${d.errors.length} things that need your attention." : "Everything's running smooth."}</div>
          </div>
          <div class="h-actions">
            <button class="btn" onclick="showPane('missions')">◆ Missions</button>
            <button class="btn btn-primary" onclick="showPane('memory')">✎ Memory</button>
          </div>
        </div>
      </div>

      <div class="grid g4" style="margin-bottom:16px">
        <div class="card"><div class="c-title"><span><span class="dot" style="background:var(--violet)"></span>Core Health</span> ${d.errors.length?`<span class="badge b-amber">attention</span>`:`<span class="badge b-green">ok</span>`}</div><div class="stat-value">${d.errors.length?"⚠":"✓"}</div><div class="stat-label">${d.errors.length?`${d.errors.length} incident(s)`: "all systems normal"}</div></div>
        <div class="card"><div class="c-title"><span><span class="dot" style="background:var(--cyan)"></span>Missions</div><div class="stat-value">${missionCount}</div><div class="stat-label">${d.activeMissions.length} active</div></div>
        <div class="card"><div class="c-title"><span><span class="dot" style="background:var(--green)"></span>Memory</div><div class="stat-value">${d.memories.length}</div><div class="stat-label">remembered facts</div></div>
        <div class="card"><div class="c-title"><span><span class="dot" style="background:var(--amber)"></span>Uptime</div><div class="stat-value">${d.hrs}h</div><div class="stat-label">${d.mins}m since restart</div></div>
      </div>

      <div class="grid g-hero">
        <div class="card mission-card">
          <div class="c-title"><span><span class="dot" style="background:var(--violet)"></span>Mission Spotlight</span> <span class="badge b-violet">spotlight</span></div>
          ${activeMission ? `
            <div class="mission-name">${activeMission.objective || activeMission.goal || "Untitled mission"}</div>
            <div class="mission-desc">${(activeMission.progress || "").slice(0,140) || "No progress recorded yet."}</div>
            <div class="progress"><div class="progress-fill" style="width:${activeMission.status==='completed'?100:activeMission.status==='running'?55:20}%"></div></div>
            <div class="progress-label"><span>${activeMission.status||"pending"}</span><span>${activeMission.id||""}</span></div>
          ` : `<div class="empty">No active missions. Launch one with <b>!delegate</b>.</div>`}
        </div>
        <div class="card">
          <div class="c-title"><span><span class="dot" style="background:var(--amber)"></span>Attention Feed</span> ${errBadge}</div>
          ${d.errors.length ? d.errors.slice(0,5).map(e=>`
            <div class="feed-item"><div class="feed-ico">⚠️</div><div class="feed-body"><div class="t err">${(e.message||String(e)).slice(0,60)}</div><div class="s">${e.time?new Date(e.time).toLocaleTimeString():""}</div></div></div>
          `).join("") : `<div class="empty">Nothing needs you right now.</div>`}
        </div>
      </div>
    </section>

    <!-- MISSIONS -->
    <section class="pane" id="pane-missions">
      <div class="grid g2">
        ${d.missions.length ? d.missions.slice(0,10).map(m=>`
          <div class="card mission-card">
            <div class="c-title"><span><span class="dot" style="background:${m.status==='completed'?'var(--green)':m.status==='running'?'var(--cyan)':'var(--muted)'}"></span>${m.id||"mission"}</span> <span class="badge ${m.status==='completed'?'b-green':m.status==='running'?'b-cyan':'b-muted'}">${m.status||"pending"}</span></div>
            <div class="mission-name">${m.objective||m.goal||"Untitled"}</div>
            <div class="mission-desc">${(m.progress||"").slice(0,100)}</div>
            <div class="progress"><div class="progress-fill" style="width:${m.status==='completed'?100:m.status==='running'?55:20}%"></div></div>
          </div>
        `).join("") : `<div class="card"><div class="empty">No missions yet. Run <b>!delegate &lt;objective&gt;</b> in chat to start one.</div></div>`}
      </div>
    </section>

    <!-- MEMORY -->
    <section class="pane" id="pane-memory">
      <div class="grid g2">
        <div class="card"><div class="c-title"><span><span class="dot" style="background:var(--green)"></span>Memories</span></div>
          ${d.memories.length ? d.memories.slice(-15).reverse().map(m=>`
            <div class="feed-item"><div class="feed-ico">✎</div><div class="feed-body"><div class="t">${m.text||m.content||"memory"}</div><div class="s">${new Date(m.ts||m.timestamp||Date.now()).toLocaleString()}</div></div></div>
          `).join("") : `<div class="empty">No memories stored yet.</div>`}
        </div>
        <div class="card"><div class="c-title"><span><span class="dot" style="background:var(--violet)"></span>World Model</span></div>
          <div class="row"><span class="k">Entities</span><span class="v">${d.entities.length}</span></div>
          <div class="row"><span class="k">Relations</span><span class="v">${d.relations.length}</span></div>
          <div class="row"><span class="k">Active goals</span><span class="v">${d.goals.length}</span></div>
          ${d.entities.slice(-8).map(e=>`<div class="feed-item"><div class="feed-ico">◈</div><div class="feed-body"><div class="t">${e.name}</div><div class="s">${e.type||"entity"}</div></div></div>`).join("")}
        </div>
      </div>
    </section>

    <!-- SPAWNS -->
    <section class="pane" id="pane-spawns">
      <div class="grid g4">
        <div class="card"><div class="c-title">Status</div><div class="stat-value">${d.spawnStats?.enabled?"Active":"Paused"}</div><div class="stat-label">wild spawn system</div></div>
        <div class="card"><div class="c-title">Daily Limit</div><div class="stat-value">${d.spawnStats?.dailyLimit||"—"}</div><div class="stat-label">max spawns/day</div></div>
        <div class="card"><div class="c-title">Used</div><div class="stat-value">${d.spawnStats?.usedToday||0}</div><div class="stat-label">today</div></div>
        <div class="card"><div class="c-title">Remaining</div><div class="stat-value">${d.spawnStats?.remaining||"—"}</div><div class="stat-label">left today</div></div>
      </div>
    </section>

    <!-- TRAINERS -->
    <section class="pane" id="pane-trainers">
      ${(() => { try { const t=tryLoad("./tools/pokemonGame"); const ts=t?.state?.trainers?Object.entries(t.state.trainers):[]; return `<div class="card"><div class="c-title">Trainers (${ts.length})</div>${ts.length?`<div class="feed">${ts.slice(0,15).map(([uid,tr])=>`<div class="feed-item"><div class="feed-ico">🎮</div><div class="feed-body"><div class="t">${tr.name||uid}</div><div class="s">Lv ${tr.level||1} · ${(tr.pokedex||[]).length} caught · ${(tr.team||[]).length} in team</div></div></div>`).join("")}</div>`:'<div class="empty">No trainers yet.</div>'}</div>`; } catch(_){ return '<div class="card"><div class="empty">Game offline.</div></div>'; } })()}
    </section>

    <!-- ACTIVITY -->
    <section class="pane" id="pane-activity">
      <div class="card"><div class="c-title">Activity Timeline</div>
        <div class="feed">
          ${(() => { try { const el = tryLoad("./utils/eventLog"); const evs = el && el.getEvents ? el.getEvents({}, 20) : []; if (!evs.length) return ""; return evs.map(e=>{ const ico = {mission:"◆",command:"⚡",error:"⚠️",memory:"✎",system:"▣",chat:"💬",alert:"🔔",decision:"🎯"}[e.type]||"•"; const col = e.type==="error"?"err":e.type==="mission"?"ok":""; return `<div class="feed-item"><div class="feed-ico">${ico}</div><div class="feed-body"><div class="t ${col}">${e.summary||""}</div><div class="s">${new Date(e.ts||Date.now()).toLocaleString()}</div></div></div>`; }).join(""); } catch(_){ return ""; } })()}
          <div class="feed-item"><div class="feed-ico">⚙️</div><div class="feed-body"><div class="t">Bot started</div><div class="s">${new Date(Date.now()-process.uptime()*1000).toLocaleString()}</div></div></div>
          <div class="feed-item"><div class="feed-ico">💬</div><div class="feed-body"><div class="t">${d.stats?.messages||0} messages processed</div><div class="s">session lifetime</div></div></div>
          <div class="feed-item"><div class="feed-ico">⚡</div><div class="feed-body"><div class="t">${d.stats?.commands||0} commands executed</div><div class="s">session lifetime</div></div></div>
          <div class="feed-item"><div class="feed-ico">🔑</div><div class="feed-body"><div class="t">${d.keysSet}/${d.aiKeys.length} AI providers configured</div><div class="s">${d.aiKeys.filter(k=>process.env[k]).join(", ")||"none"}</div></div></div>
        </div>
      </div>
    </section>

    <!-- SYSTEM -->
    <section class="pane" id="pane-system">
      <div class="grid g2">
        <div class="card"><div class="c-title">System</div>
          <div class="row"><span class="k">Uptime</span><span class="v">${d.hrs}h ${d.mins}m</span></div>
          <div class="row"><span class="k">Memory (RSS)</span><span class="v">${d.memMB} MB</span></div>
          <div class="row"><span class="k">Heap</span><span class="v">${d.heapMB} MB</span></div>
          <div class="row"><span class="k">Node</span><span class="v mono">${process.version}</span></div>
          <div class="row"><span class="k">Platform</span><span class="v">${d.os.platform?.()||"?"} ${d.os.arch?.()||""}</span></div>
          <div class="row"><span class="k">CPU cores</span><span class="v">${d.os.cpus?.().length||"?"}</span></div>
          <div class="row"><span class="k">Load</span><span class="v">${d.os.loadavg?.()[0].toFixed(2)||"?"}</span></div>
          <div class="row"><span class="k">PID</span><span class="v mono">${process.pid}</span></div>
        </div>
        <div class="card"><div class="c-title">Ecosystem</div>
          ${d.aiKeys.map(k=>`<div class="row"><span class="k mono">${k}</span><span class="badge ${process.env[k]?"b-green":"b-red"}">${process.env[k]?"on":"off"}</span></div>`).join("")}
          <div class="row"><span class="k">Session persistence</span><span class="badge ${process.env.SESSION_GIT_REPO?"b-green":"b-amber"}">${process.env.SESSION_GIT_REPO?"git-synced":"not set"}</span></div>
        </div>
      </div>
    </section>

    <!-- ADMIN -->
    <section class="pane" id="pane-admin">
      <div class="grid g2">
        <div class="card"><div class="c-title">Bot Admins</div>
          ${(() => { try { const p=tryLoad("./utils/permissions"); const a=p?.listAdmins?p.listAdmins():[]; return a.length?a.map(x=>`<div class="row"><span class="k mono">${x}</span></div>`).join(""):'<div class="empty">No custom admins</div>'; } catch(_){ return '<div class="empty">—</div>'; } })()}
        </div>
        <div class="card"><div class="c-title">Access</div>
          <div class="row"><span class="k">Owner</span><span class="v mono">${process.env.OWNER_NUMBER||"built-in"}</span></div>
          <div class="row"><span class="k">Dashboard</span><span class="badge b-green">secured</span></div>
        </div>
      </div>
    </section>
    `;

    res.send(renderPage("Home", content));
  } catch (e) {
    res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre class="log err">${e.message}</pre></div>`));
  }
});

// /spawns API
router.post("/spawns/set", checkAuth, (req, res) => {
  let b=""; req.on("data",c=>b+=c); req.on("end",()=>{
    try { const {limit}=JSON.parse(b||"{}"); const s=tryLoad("./tools/pokemonSpawn"); if(s&&s.setSpawnLimit&&Number(limit)>0)s.setSpawnLimit(Number(limit)); res.json({ok:true}); } catch(e){ res.json({ok:false,error:e.message}); }
  });
});

module.exports = router;
module.exports.checkAuth = checkAuth;
