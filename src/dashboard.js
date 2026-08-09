// ARIA Home — rebuilt from scratch, mobile-first control panel
// Mounted on /dashboard in index.js
// Clean, functional, polished. Real auth + session.

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const router = express.Router();

const SESSION_TTL = 12 * 60 * 60 * 1000;

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
  return `<div class="login">
    <div class="login-logo">◢ ARIA</div>
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

function collectData() {
  const os = require("os");
  const uptime = Math.floor(process.uptime());
  const hrs = Math.floor(uptime / 3600), mins = Math.floor((uptime % 3600) / 60);
  const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

  const botAdmin = tryLoad("./tools/botAdmin");
  const stats = botAdmin ? botAdmin.getStats() : null;
  const errors = botAdmin ? (botAdmin.getRecentErrors ? botAdmin.getRecentErrors(6) : []) : [];
  const spawn = tryLoad("./tools/pokemonSpawn");
  const spawnStats = spawn ? spawn.getSpawnStats() : null;
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
  let trainers = [];
  try { const pg = tryLoad("./tools/pokemonGame"); trainers = pg?.state?.trainers ? Object.entries(pg.state.trainers) : []; } catch (_) {}

  return { os, hrs, mins, memMB, stats, errors, spawnStats, missions, activeMissions, memories, mediaMem, households, keysSet, aiKeys, trainers };
}

function renderPage(title, content, passwordNeeded = false, isLogin = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${title} | ARIA</title>
<style>
:root{
  --bg:#05070c; --panel:#0d1117; --panel2:#131926; --panel3:#1b2333; --line:#1f2937; --line2:#2b3a52;
  --text:#e8edf7; --muted:#8b96b0; --faint:#5c6880;
  --accent:#7c8cff; --cyan:#22d3ee; --green:#34d399; --amber:#fbbf24; --red:#f87171;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.mono{font-family:ui-monospace,Consolas,monospace}

/* Header */
.topbar{position:sticky;top:0;z-index:30;background:rgba(5,7,12,.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:14px 18px;display:flex;align-items:center;justify-content:space-between}
.topbar .brand{font-size:19px;font-weight:800;letter-spacing:.5px}
.topbar .brand span{color:var(--accent)}
.topbar .right{display:flex;align-items:center;gap:10px}
.pill{background:var(--panel2);border:1px solid var(--line);border-radius:99px;padding:6px 12px;font-size:12px;color:var(--muted)}
.pill.on{color:var(--green);border-color:rgba(52,211,153,.3);background:rgba(52,211,153,.08)}
.logout{background:none;border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer}
.logout:hover{color:var(--text)}

/* Content */
.main{max-width:760px;margin:0 auto;padding:18px 18px 90px}
.page-title{font-size:20px;font-weight:800;margin-bottom:4px}
.page-sub{color:var(--muted);font-size:13px;margin-bottom:18px}

/* Hero */
.hero{background:linear-gradient(135deg,rgba(124,140,255,.14),rgba(34,211,238,.07));border:1px solid var(--line2);border-radius:16px;padding:18px;margin-bottom:16px}
.hero .hrow{display:flex;align-items:center;gap:12px}
.hero .avatar{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,var(--accent),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0}
.hero h2{font-size:17px;font-weight:800;display:flex;align-items:center;gap:8px}
.hero .sub{color:var(--muted);font-size:12px;margin-top:2px}

/* Stat grid */
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.stat .n{font-size:24px;font-weight:800}
.stat .l{color:var(--muted);font-size:11px;margin-top:2px}

/* Cards */
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px}
.card .h{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);font-weight:700;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
.card .h .badge{font-size:10px;padding:2px 8px;border-radius:99px;background:var(--panel3)}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.row:last-child{border:none}
.row .k{color:var(--muted)}
.row .v{font-weight:600;text-align:right}
.feed{display:flex;flex-direction:column}
.feed-item{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}
.feed-item:last-child{border:none}
.feed-ico{width:30px;height:30px;border-radius:8px;background:var(--panel3);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.feed .t{font-weight:600}
.feed .m{color:var(--muted);font-size:12px}
.feed .s{color:var(--faint);font-size:10px}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700}
.b-green{background:rgba(52,211,153,.14);color:var(--green)}
.b-red{background:rgba(248,113,113,.14);color:var(--red)}
.b-amber{background:rgba(251,191,36,.14);color:var(--amber)}
.b-accent{background:rgba(124,140,255,.16);color:var(--accent)}
.b-muted{background:var(--panel3);color:var(--muted)}
.empty{text-align:center;padding:20px;color:var(--faint);font-size:12px}

/* Bottom nav */
.bottomnav{position:fixed;bottom:0;left:0;right:0;z-index:40;background:rgba(10,13,20,.97);border-top:1px solid var(--line);display:flex;overflow-x:auto;padding:4px;backdrop-filter:blur(12px);-webkit-overflow-scrolling:touch;scrollbar-width:none}
.bottomnav::-webkit-scrollbar{display:none}
.tab{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:64px;padding:8px 10px;border-radius:10px;color:var(--muted);font-size:10px;cursor:pointer;transition:.15s;border:1px solid transparent}
.tab .ico{font-size:18px}
.tab.active{color:var(--text);background:var(--panel2);border-color:var(--line2)}
.tab.active .ico{color:var(--accent)}

/* panes */
.pane{display:none}
.pane.show{display:block;animation:fade .25s}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* login */
.login{max-width:340px;margin:16vh auto 0;background:var(--panel);border:1px solid var(--line2);border-radius:20px;padding:34px 26px;text-align:center}
.login-logo{font-size:30px;font-weight:800;color:var(--accent)}
.login p{color:var(--muted);font-size:13px;margin:8px 0 22px}
.login input{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);padding:13px;border-radius:10px;font-size:15px;outline:none;margin-bottom:12px}
.login input:focus{border-color:var(--accent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 18px;border-radius:10px;border:none;font-size:14px;font-weight:700;cursor:pointer;background:var(--panel2);color:var(--text)}
.btn-primary{background:linear-gradient(90deg,var(--accent),var(--cyan));color:#0a0a12}
.btn-block{width:100%}
.error{color:var(--red);margin-top:12px;font-size:13px}
.hint{color:var(--faint);margin-top:12px;font-size:11px}
</style>
</head>
<body>
<div class="topbar">
  <div class="brand">◢ <span>ARIA</span></div>
  <div class="right">
    <span class="pill on">● online</span>
    ${!isLogin ? `<form method="POST" action="/dashboard/logout"><button class="logout">Leave</button></form>` : ""}
  </div>
</div>
<main class="main">
  ${passwordNeeded ? `<div class="card"><div class="empty">Set DASHBOARD_PASSWORD in env to access.</div></div>` : content}
</main>
<nav class="bottomnav" id="nav">
  <div class="tab active" data-pane="home"><span class="ico">◉</span>Home</div>
  <div class="tab" data-pane="missions"><span class="ico">◆</span>Missions</div>
  <div class="tab" data-pane="memory"><span class="ico">🧠</span>Memory</div>
  <div class="tab" data-pane="media"><span class="ico">🖼️</span>Media</div>
  <div class="tab" data-pane="household"><span class="ico">🏠</span>Home</div>
  <div class="tab" data-pane="spawns"><span class="ico">⚡</span>Spawns</div>
  <div class="tab" data-pane="trainers"><span class="ico">🎮</span>Trainers</div>
  <div class="tab" data-pane="activity"><span class="ico">≋</span>Activity</div>
  <div class="tab" data-pane="system"><span class="ico">▣</span>System</div>
  <div class="tab" data-pane="admin"><span class="ico">👑</span>Admin</div>
</nav>
<script>
const titles={home:['Home','what\'s she up to'],missions:['Missions','what ARIA is building'],memory:['Memory','what she remembers'],media:['Media','images & voice'],household:['Household','shared space'],spawns:['Spawns','wild pokemon'],trainers:['Trainers','players'],activity:['Activity','what she did'],system:['System','health'],admin:['Admin','access']};
const navs=document.querySelectorAll('.tab');
function showPane(p){
  navs.forEach(n=>n.classList.toggle('active',n.dataset.pane===p));
  document.querySelectorAll('.pane').forEach(x=>x.classList.remove('show'));
  const el=document.getElementById('pane-'+p); if(el)el.classList.add('show');
  const t=titles[p]||['','']; document.querySelector('.page-title').textContent=t[0]; document.querySelector('.page-sub').textContent=t[1];
}
navs.forEach(n=>n.addEventListener('click',()=>showPane(n.dataset.pane)));
showPane('home');
setInterval(()=>{ location.reload(); }, 30000);
</script>
</body>
</html>`;
}

// ── Routes ───────────────────────────────────────────────────

router.get("/", checkAuth, (req, res) => {
  try {
    const d = collectData();
    const active = d.activeMissions[0] || d.missions[0];
    let content = `
    <div class="pane show" id="pane-home"><div class="page-title">Home</div><div class="page-sub">what's she up to</div>

    <div class="hero">
      <div class="hrow">
        <div class="avatar">◢</div>
        <div><h2>ARIA <span class="badge b-green">online</span></h2><div class="sub">${d.activeMissions.length ? "Working on " + d.activeMissions.length + " mission(s)." : "Idle — waiting for you."}</div></div>
      </div>
    </div></div>

    <div class="stats">
      <div class="stat"><div class="n">${d.activeMissions.length}</div><div class="l">active missions</div></div>
      <div class="stat"><div class="n">${d.missions.length}</div><div class="l">total missions</div></div>
      <div class="stat"><div class="n">${d.memories.length}</div><div class="l">memories</div></div>
      <div class="stat"><div class="n">${d.keysSet}/${d.aiKeys.length}</div><div class="l">AI keys</div></div>
    </div>

    <div class="card"><div class="h">Mission Spotlight ${active ? `<span class="badge b-accent">${active.status}</span>` : ""}</div>
      ${active ? `<div class="row"><span class="k">${active.objective || "Untitled"}</span></div><div class="row"><span class="k">Progress</span><span class="v">${active.progress || "—"}</span></div>${active.trace && active.trace.length ? `<div class="feed" style="margin-top:8px">${active.trace.slice(-3).map(t=>`<div class="feed-item"><div class="feed-ico">🧾</div><div class="feed-body"><div class="m">${t.detail}</div><div class="s">${new Date(t.ts).toLocaleTimeString()}</div></div></div>`).join("")}</div>`:""}` : `<div class="empty">No active mission. Use !delegate or !mission in chat.</div>`}
    </div>

    <div class="card"><div class="h">Attention ${d.errors.length ? `<span class="badge b-red">${d.errors.length}</span>` : `<span class="badge b-green">clear</span>`}</div>
      ${d.errors.length ? d.errors.slice(0,4).map(e=>`<div class="feed-item"><div class="feed-ico">⚠️</div><div class="feed-body"><div class="t" style="color:var(--red)">${(e.message||String(e)).slice(0,70)}</div><div class="s">${new Date(e.time||Date.now()).toLocaleTimeString()}</div></div></div>`).join("") : `<div class="empty">All clear.</div>`}
    </div>
    </div>
    `;

    // Missions pane
    content += `
    <div class="pane" id="pane-missions"><div class="page-title">Missions</div><div class="page-sub">what ARIA is building</div>
      ${d.missions.length ? d.missions.slice(0,12).map(m=>`
        <div class="card"><div class="h"><span>${m.id||"mission"}</span><span class="badge ${m.status==='completed'?'b-green':m.status==='running'?'b-cyan':m.status==='failed'?'b-red':'b-muted'}">${m.status}</span></div>
          <div class="row"><span class="k">${m.objective||"Untitled"}</span></div>
          <div class="row"><span class="k">Progress</span><span class="v">${m.progress||"—"}</span></div>
        </div>`).join("") : `<div class="card"><div class="empty">No missions yet.</div></div>`}
    </div>`;

    // Memory pane
    content += `
    <div class="pane" id="pane-memory"><div class="page-title">Memory</div><div class="page-sub">what she remembers</div>
      <div class="card"><div class="h">Long-term memories (${d.memories.length})</div>
        ${d.memories.length ? d.memories.slice(-12).reverse().map(m=>`<div class="feed-item"><div class="feed-ico">🧠</div><div class="feed-body"><div class="t">${m.text}</div><div class="s">${new Date(m.ts||Date.now()).toLocaleString()}</div></div></div>`).join("") : `<div class="empty">No memories yet.</div>`}
      </div>
    </div>`;

    // Media pane
    content += `
    <div class="pane" id="pane-media"><div class="page-title">Media</div><div class="page-sub">images & voice</div>
      <div class="card"><div class="h">Media remembered (${d.mediaMem.length})</div>
        ${d.mediaMem.length ? d.mediaMem.map(m=>`<div class="feed-item"><div class="feed-ico">${m.kind==='image'?'🖼️':'🎤'}</div><div class="feed-body"><div class="m">${(m.summary||"").slice(0,110)}</div><div class="s">${m.kind} · ${new Date(m.ts).toLocaleString()}</div></div></div>`).join("") : `<div class="empty">Send ARIA an image or voice note.</div>`}
      </div>
    </div>`;

    // Household pane
    content += `
    <div class="pane" id="pane-household"><div class="page-title">Household</div><div class="page-sub">shared space</div>
      ${d.households.length ? d.households.map(h=>`<div class="card"><div class="h">🏠 ${h.name}</div>
        <div class="row"><span class="k">Members</span><span class="v">${h.members.length}</span></div>
        <div class="row"><span class="k">Tasks</span><span class="v">${h.sharedTasks.length}</span></div>
        ${h.sharedTasks.length ? h.sharedTasks.slice(-5).map(t=>`<div class="feed-item"><div class="feed-ico">${t.done?'✅':'⬜'}</div><div class="feed-body"><div class="m">${t.text}</div></div></div>`).join("") : ""}
      </div>`).join("") : `<div class="card"><div class="empty">No households. In a group: !household create</div></div>`}
    </div>`;

    // Spawns pane
    content += `
    <div class="pane" id="pane-spawns"><div class="page-title">Spawns</div><div class="page-sub">wild pokemon</div>
      <div class="stats">
        <div class="stat"><div class="n">${d.spawnStats?.enabled?"Active":"Paused"}</div><div class="l">status</div></div>
        <div class="stat"><div class="n">${d.spawnStats?.remaining||"—"}</div><div class="l">remaining today</div></div>
        <div class="stat"><div class="n">${d.spawnStats?.usedToday||0}</div><div class="l">used today</div></div>
        <div class="stat"><div class="n">${d.spawnStats?.dailyLimit||"—"}</div><div class="l">daily limit</div></div>
      </div>
    </div>`;

    // Trainers pane
    content += `
    <div class="pane" id="pane-trainers"><div class="page-title">Trainers</div><div class="page-sub">players</div>
      <div class="card"><div class="h">Trainers (${d.trainers.length})</div>
        ${d.trainers.length ? d.trainers.slice(0,15).map(([uid,t])=>`<div class="feed-item"><div class="feed-ico">🎮</div><div class="feed-body"><div class="t">${t.name||uid}</div><div class="m">Lv ${t.level||1} · ${(t.pokedex||[]).length} caught</div></div></div>`).join("") : `<div class="empty">No trainers yet.</div>`}
      </div>
    </div>`;

    // Activity pane
    content += `
    <div class="pane" id="pane-activity"><div class="page-title">Activity</div><div class="page-sub">what she did</div>
      <div class="card"><div class="h">Session</div>
        <div class="row"><span class="k">Uptime</span><span class="v">${d.hrs}h ${d.mins}m</span></div>
        <div class="row"><span class="k">Messages</span><span class="v">${d.stats?.messages||0}</span></div>
        <div class="row"><span class="k">Commands</span><span class="v">${d.stats?.commands||0}</span></div>
        <div class="row"><span class="k">Started</span><span class="v">${new Date(Date.now()-process.uptime()*1000).toLocaleString()}</span></div>
      </div>
    </div>`;

    // System pane
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

    // Admin pane
    content += `
    <div class="pane" id="pane-admin"><div class="page-title">Admin</div><div class="page-sub">access</div>
      <div class="card"><div class="h">Access</div>
        <div class="row"><span class="k">Owner</span><span class="v mono">${process.env.OWNER_NUMBER||"built-in"}</span></div>
        <div class="row"><span class="k">Dashboard</span><span class="badge b-green">secured</span></div>
      </div>
    </div>`;

    res.send(renderPage("Home", content));
  } catch (e) {
    res.send(renderPage("Error", `<div class="card"><div class="empty">${e.message}</div></div>`));
  }
});

module.exports = router;
module.exports.checkAuth = checkAuth;
