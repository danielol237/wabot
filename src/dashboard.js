// ARIA Web Dashboard — browser control panel
// Mounted on /dashboard in index.js

const express = require("express");
const router = express.Router();

// ── HTML template with dark theme ──────────────────────────
function renderPage(title, content, passwordNeeded = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | ARIA Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; min-height: 100vh; }
    .nav { background: #12121a; border-bottom: 1px solid #2a2a3a; padding: 1rem 2rem; display: flex; align-items: center; gap: 2rem; }
    .nav h1 { font-size: 1.3rem; color: #a78bfa; }
    .nav a { color: #888; text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }
    .nav a:hover { color: #a78bfa; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #16162a; border: 1px solid #2a2a3a; border-radius: 12px; padding: 1.5rem; }
    .card h3 { color: #a78bfa; margin-bottom: 0.75rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .card .value { font-size: 2rem; font-weight: 700; color: #fff; }
    .card .label { font-size: 0.8rem; color: #666; margin-top: 0.25rem; }
    .card .stat-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #1e1e2e; }
    .card .stat-row:last-child { border: none; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
    .badge-green { background: #065f46; color: #6ee7b7; }
    .badge-red { background: #5f0606; color: #fca5a5; }
    .badge-yellow { background: #5f4f06; color: #fde68a; }
    .btn { display: inline-block; padding: 0.5rem 1rem; border-radius: 6px; border: none; cursor: pointer; font-size: 0.85rem; font-weight: 600; transition: all 0.2s; }
    .btn-primary { background: #7c3aed; color: white; }
    .btn-primary:hover { background: #6d28d9; }
    .btn-danger { background: #dc2626; color: white; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-sm { padding: 0.3rem 0.8rem; font-size: 0.8rem; }
    input, select { background: #1e1e2e; border: 1px solid #2a2a3a; color: #e0e0e0; padding: 0.5rem; border-radius: 6px; font-size: 0.9rem; width: 100%; margin-bottom: 0.5rem; }
    input:focus { outline: none; border-color: #7c3aed; }
    .flex { display: flex; gap: 0.5rem; align-items: center; }
    .mt-1 { margin-top: 0.5rem; }
    .mb-1 { margin-bottom: 0.5rem; }
    pre { background: #0a0a0f; padding: 0.75rem; border-radius: 6px; font-size: 0.8rem; overflow-x: auto; max-height: 300px; border: 1px solid #1e1e2e; }
    .login-box { max-width: 400px; margin: 100px auto; text-align: center; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; animation: pulse 2s infinite; }
    .live-dot.green { background: #22c55e; }
    .live-dot.red { background: #ef4444; }
    @media (max-width: 600px) { .container { padding: 1rem; } .nav { padding: 0.75rem 1rem; } }
  </style>
</head>
<body>
  <nav class="nav">
    <h1>🛸 ARIA</h1>
    <a href="/dashboard">Dashboard</a>
    <a href="/dashboard/spawns">Spawns</a>
    <a href="/dashboard/trainers">Trainers</a>
    <a href="/dashboard/logs">Logs</a>
    <a href="/dashboard/admin">Admin</a>
    <span style="flex:1"></span>
    <span style="color:#666;font-size:0.8rem;" id="uptime">—</span>
  </nav>
  <div class="container">
    ${passwordNeeded ? `<div class="login-box"><div class="card"><h3>🔒 Dashboard Locked</h3><p style="color:#888;margin:1rem 0;">Set DASHBOARD_PASSWORD in .env to access the dashboard.</p></div></div>` : content}
  </div>
  <script>
    // Auto-refresh every 10s
    setTimeout(() => location.reload(), 10000);
  </script>
</body>
</html>`;
}

// ── Password check middleware ──────────────────────────────
function checkAuth(req, res, next) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return res.send(renderPage("Locked", "", true));
  
  const auth = req.headers.authorization;
  if (!auth || auth !== "Bearer " + pw) {
    res.setHeader("WWW-Authenticate", 'Basic realm="ARIA Dashboard"');
    return res.status(401).send(renderPage("Unauthorized", '<div class="card" style="max-width:400px;margin:100px auto;text-align:center;"><h3>🔒 Unauthorized</h3><p style="color:#888;margin:1rem 0;">Wrong password.</p></div>'));
  }
  next();
}

// ── Routes ─────────────────────────────────────────────────

// Main dashboard
router.get("/", checkAuth, (req, res) => {
  try {
    const os = require("os");
    const uptime = Math.floor(process.uptime());
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    
    // Try to get bot stats
    let botStats = { messages: 0, commands: 0, errors: 0 };
    let spawnStats = { dailyLimit: 20, remaining: 0, enabled: true };
    try {
      const { getStats } = require("./tools/botAdmin");
      botStats = getStats() || botStats;
    } catch (_) {}
    try {
      const { getSpawnStats } = require("./tools/pokemonSpawn");
      spawnStats = getSpawnStats();
    } catch (_) {}
    
    const content = `
    <div class="grid">
      <div class="card">
        <h3>⏱ Uptime</h3>
        <div class="value">${hrs}h ${mins}m</div>
        <div class="label">Since last restart</div>
      </div>
      <div class="card">
        <h3>💬 Messages</h3>
        <div class="value">${botStats.messages || "—"}</div>
        <div class="label">Processed</div>
      </div>
      <div class="card">
        <h3>🦎 Spawns</h3>
        <div class="value">${spawnStats.remaining}</div>
        <div class="label">Remaining today / ${spawnStats.dailyLimit}</div>
      </div>
      <div class="card">
        <h3>⚠️ Errors</h3>
        <div class="value">${botStats.errors || 0}</div>
        <div class="label">${botStats.errors > 0 ? '<span class="badge badge-red">Needs attention</span>' : '<span class="badge badge-green">All clear</span>'}</div>
      </div>
    </div>
    
    <div class="grid">
      <div class="card">
        <h3>🔧 System</h3>
        <div class="stat-row"><span>CPU</span><span>${os.cpus().length} cores</span></div>
        <div class="stat-row"><span>Memory</span><span>${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB</span></div>
        <div class="stat-row"><span>Node</span><span>${process.version}</span></div>
        <div class="stat-row"><span>Platform</span><span>${os.platform()}</span></div>
      </div>
      <div class="card">
        <h3>🌙 Time Period</h3>
        <div class="value" style="font-size:1.5rem;">
          <span id="timePeriod">—</span>
        </div>
        <div class="label" id="timeDetail"></div>
      </div>
      <div class="card">
        <h3>📡 API Keys</h3>
        ${["GROQ_API_KEY", "CEREBRAS_API_KEY", "GEMINI_API_KEY", "TAVILY_API_KEY", "ELEVENLABS_API_KEY"].map(k => `
          <div class="stat-row"><span>${k}</span><span class="badge ${process.env[k] ? "badge-green" : "badge-red"}">${process.env[k] ? "Set" : "Missing"}</span></div>
        `).join("")}
      </div>
    </div>
    <script>
      const period = ${JSON.stringify(require("./tools/pokemonSpawn").getTimePeriod())};
      document.getElementById("timePeriod").textContent = period.emoji + " " + period.name;
      document.getElementById("timeDetail").textContent = "Boost: " + period.boost.join(", ");
    </script>`;
    
    res.send(renderPage("Dashboard", content));
  } catch (e) {
    res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`));
  }
});

// Spawn controls
router.get("/spawns", checkAuth, (req, res) => {
  try {
    const { getSpawnStats, setSpawnLimit, getGlobalSpawnConfig } = require("./tools/pokemonSpawn");
    const { save } = require("./tools/pokemonGame");
    const stats = getSpawnStats();
    
    const content = `
    <div class="grid">
      <div class="card">
        <h3>🦎 Spawn Controls</h3>
        <form method="POST" action="/dashboard/spawns/set" class="flex" style="margin-bottom:1rem;">
          <input type="number" name="limit" value="${stats.dailyLimit}" min="0" max="100" style="width:80px;">
          <button type="submit" class="btn btn-primary btn-sm">Set Rate</button>
        </form>
        <div class="stat-row"><span>Status</span><span class="badge ${stats.enabled ? "badge-green" : "badge-red"}">${stats.enabled ? "Active" : "Paused"}</span></div>
        <div class="stat-row"><span>Daily Limit</span><span>${stats.dailyLimit}</span></div>
        <div class="stat-row"><span>Used Today</span><span>${stats.totalToday}</span></div>
        <div class="stat-row"><span>Remaining</span><span>${stats.remaining}</span></div>
        <div class="stat-row"><span>Interval</span><span>every ${stats.intervalMin} min</span></div>
        <div class="stat-row"><span>Next Spawn</span><span>~${stats.nextSpawnMinutes} min</span></div>
        <div class="flex mt-1">
          <form method="POST" action="/dashboard/spawns/toggle">
            <button type="submit" class="btn ${stats.enabled ? "btn-danger" : "btn-primary"} btn-sm">${stats.enabled ? "Pause" : "Resume"}</button>
          </form>
          <form method="POST" action="/dashboard/spawns/reset">
            <button type="submit" class="btn btn-sm" style="background:#333;">Reset to Default</button>
          </form>
        </div>
      </div>
      <div class="card">
        <h3>🎯 Rarity Weights</h3>
        ${["Common 50%", "Uncommon 25%", "Rare 15%", "Super Rare 7%", "Legendary 2.5%", "Mythical 0.5%"].map(r => `
          <div class="stat-row"><span>${r.split(" ")[0]}</span><span>${r.split(" ")[1]}</span></div>
        `).join("")}
      </div>
      <div class="card">
        <h3>🌙 Time Boosts</h3>
        ${["Dawn: Normal/Flying/Psychic", "Morning: Grass/Bug/Fairy", "Day: Fire/Fighting/Ground/Rock", "Evening: Psychic/Dark/Poison", "Night: Dark/Ghost/Water/Ice"].map(t => `
          <div class="stat-row"><span>${t.split(":")[0]}</span><span style="color:#888;font-size:0.8rem;">${t.split(":")[1]}</span></div>
        `).join("")}
      </div>
    </div>`;
    
    res.send(renderPage("Spawns", content));
  } catch (e) {
    res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`));
  }
});

// Spawn actions
router.post("/spawns/set", checkAuth, (req, res) => {
  try {
    const { setSpawnLimit } = require("./tools/pokemonSpawn");
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      const limit = parseInt(new URLSearchParams(body).get("limit"));
      if (!isNaN(limit)) setSpawnLimit(limit);
      res.redirect("/dashboard/spawns");
    });
  } catch (e) { res.redirect("/dashboard/spawns"); }
});

router.post("/spawns/toggle", checkAuth, (req, res) => {
  try {
    const { getGlobalSpawnConfig } = require("./tools/pokemonSpawn");
    const { save } = require("./tools/pokemonGame");
    const cfg = getGlobalSpawnConfig();
    cfg.enabled = !cfg.enabled;
    save();
  } catch (_) {}
  res.redirect("/dashboard/spawns");
});

router.post("/spawns/reset", checkAuth, (req, res) => {
  try {
    const { setSpawnLimit, DEFAULT_SPAWNS_PER_DAY } = require("./tools/pokemonSpawn");
    setSpawnLimit(DEFAULT_SPAWNS_PER_DAY);
  } catch (_) {}
  res.redirect("/dashboard/spawns");
});

// Trainers
router.get("/trainers", checkAuth, (req, res) => {
  try {
    const { getTrainer, state } = require("./tools/pokemonGame");
    const trainers = state.trainers || {};
    const entries = Object.entries(trainers).slice(0, 50);
    
    const content = `
    <div class="card">
      <h3>👤 Trainers (${Object.keys(trainers).length} total)</h3>
      ${entries.length === 0 ? '<p style="color:#666;">No trainers yet.</p>' : `
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
        <tr style="color:#888;border-bottom:1px solid #2a2a3a;">
          <th style="padding:0.5rem;text-align:left;">Name</th>
          <th style="padding:0.5rem;text-align:left;">Level</th>
          <th style="padding:0.5rem;text-align:left;">Team</th>
          <th style="padding:0.5rem;text-align:left;">PC</th>
          <th style="padding:0.5rem;text-align:left;">Coins</th>
          <th style="padding:0.5rem;text-align:left;">W/L</th>
        </tr>
        ${entries.map(([id, t]) => `
        <tr style="border-bottom:1px solid #1a1a2a;">
          <td style="padding:0.5rem;">${t.name || "—"}</td>
          <td style="padding:0.5rem;">${t.level}</td>
          <td style="padding:0.5rem;">${t.team.length}</td>
          <td style="padding:0.5rem;">${t.pc.length}</td>
          <td style="padding:0.5rem;">${t.coins}</td>
          <td style="padding:0.5rem;">${t.wins}/${t.losses}</td>
        </tr>`).join("")}
      </table>`}
    </div>`;
    
    res.send(renderPage("Trainers", content));
  } catch (e) {
    res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`));
  }
});

// Logs
router.get("/logs", checkAuth, (req, res) => {
  try {
    let errors = [];
    try {
      const { getRecentErrors } = require("./tools/botAdmin");
      errors = getRecentErrors() || [];
    } catch (_) {}
    
    const content = `
    <div class="card">
      <h3>📋 Recent Errors (${errors.length})</h3>
      ${errors.length === 0 ? '<p style="color:#666;">No errors logged. Clean run! 🎉</p>' : `
      <pre>${errors.map(e => `[${e.time}] [${e.context}] ${e.error}`).join("\\n")}</pre>`}
    </div>
    <div class="card mt-1">
      <h3>🔧 Quick Actions</h3>
      <div class="flex">
        <form method="POST" action="/dashboard/logs/clear">
          <button type="submit" class="btn btn-danger btn-sm">Clear Logs</button>
        </form>
      </div>
    </div>`;
    
    res.send(renderPage("Logs", content));
  } catch (e) {
    res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`));
  }
});

router.post("/logs/clear", checkAuth, (req, res) => {
  res.redirect("/dashboard/logs");
});

// Admin
router.get("/admin", checkAuth, (req, res) => {
  try {
    const { listAdmins } = require("./utils/permissions");
    const admins = listAdmins() || [];
    
    const content = `
    <div class="grid">
      <div class="card">
        <h3>👑 Admins</h3>
        ${admins.length === 0 ? '<p style="color:#666;">No admins set.</p>' : admins.map(a => `
          <div class="stat-row"><span>${a}</span><span class="badge badge-green">Admin</span></div>
        `).join("")}
      </div>
      <div class="card">
        <h3>📢 Broadcast</h3>
        <form method="POST" action="/dashboard/admin/broadcast">
          <textarea name="message" rows="3" placeholder="Message to send to all chats..." style="background:#1e1e2e;border:1px solid #2a2a3a;color:#e0e0e0;padding:0.5rem;border-radius:6px;width:100%;font-family:inherit;"></textarea>
          <button type="submit" class="btn btn-primary btn-sm mt-1">Send Broadcast</button>
        </form>
      </div>
      <div class="card">
        <h3>⚙️ Config</h3>
        <div class="stat-row"><span>Bot Name</span><span>${process.env.BOT_NAME || "aria"}</span></div>
        <div class="stat-row"><span>Prefix</span><span>${process.env.BOT_PREFIX || "!"}</span></div>
        <div class="stat-row"><span>Owner</span><span>${process.env.OWNER_NUMBER || "Not set"}</span></div>
        <div class="stat-row"><span>Port</span><span>${process.env.PORT || 3001}</span></div>
      </div>
    </div>`;
    
    res.send(renderPage("Admin", content));
  } catch (e) {
    res.send(renderPage("Error", `<div class="card"><h3>❌ Error</h3><pre>${e.message}</pre></div>`));
  }
});

router.post("/admin/broadcast", checkAuth, (req, res) => {
  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", () => {
    try {
      const message = new URLSearchParams(body).get("message");
      if (message) {
        const { broadcastToAll } = require("./tools/botAdmin");
        broadcastToAll(null, message);
      }
    } catch (_) {}
    res.redirect("/dashboard/admin");
  });
});

module.exports = router;
