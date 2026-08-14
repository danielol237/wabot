// ARIA — her own website, full-featured.
// Served at / with a single-page app. Real features wired to the backend:
// live chat (getAIResponse), missions (create/cancel/view), memory, media,
// household, alerts, system health. The control dashboard lives at /dashboard.

const express = require("express");
const router = express.Router();
const path = require("path");

function tryLoad(m) { try { return require(m); } catch (_) { return null; } }

// Protect the sensitive data/mutation endpoints. The live chat stays public
// (it's the point of the site), but memory, media, household, alerts, system
// and mission control are behind the same session auth as the dashboard —
// otherwise any visitor to the public site could read private data and trigger
// ARIA's mission engine.
const { checkAuth } = require("./dashboard");
router.use(["/api/missions", "/api/memory", "/api/media", "/api/household", "/api/alerts", "/api/system"], checkAuth);

// Same stateless CSRF policy as the dashboard, for the state-changing /api
// endpoints that sit behind dashboard auth. /api/chat stays public + CSRF-free.
const { csrfOk } = require("./dashboard");
const { error: logError } = require("./utils/logger");
function apiFailure(res, scope, err) {
  logError(`[${scope}]`, err?.stack || err?.message || err);
  return res.status(500).json({ error: "The service is temporarily unavailable. Please try again." });
}
router.post(["/api/missions", "/api/missions/cancel"], (req, res, next) => {
  if (!csrfOk(req)) return res.status(403).json({ error: "Invalid or missing CSRF token." });
  next();
});

// ── API: live chat with ARIA ─────────────────────────────────
// Public endpoint — rate-limit by IP so a bot can't burn the AI quota with
// unlimited /api/chat calls. Enforced in-memory: window, per-IP cap, burst cap,
// max body size, and a concurrency ceiling.
const chatLimits = new Map(); // ip -> { count, windowStart }
const CHAT_WINDOW_MS = 60 * 1000;
const CHAT_MAX_PER_WINDOW = 12;       // 12 requests / 60s per IP
const CHAT_MAX_BODY = 4000;           // bytes
const CHAT_MAX_CONCURRENT = 5;
let chatInFlight = 0;
// Periodically drop stale rate-limit buckets so the map doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - CHAT_WINDOW_MS;
  for (const [k, v] of chatLimits) if (v.windowStart < cutoff) chatLimits.delete(k);
}, 5 * 60 * 1000).unref();

router.post("/api/chat", async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const rec = chatLimits.get(ip) || { count: 0, windowStart: now };
  if (now - rec.windowStart > CHAT_WINDOW_MS) { rec.count = 0; rec.windowStart = now; }
  rec.count++;
  chatLimits.set(ip, rec);
  if (rec.count > CHAT_MAX_PER_WINDOW) {
    return res.status(429).json({ reply: "Slow down, friend — too many messages. Give me a moment. 🤍" });
  }
  if (chatInFlight >= CHAT_MAX_CONCURRENT) {
    return res.status(429).json({ reply: "I'm swamped right now — try again in a sec." });
  }
  if (req.headers["content-length"] && Number(req.headers["content-length"]) > CHAT_MAX_BODY) {
    return res.status(413).json({ reply: "That message is too long." });
  }
  try {
    const { message } = req.body || {};
    if (!message || !String(message).trim()) return res.json({ reply: "say something, bestie 🤍" });
    if (String(message).length > 2000) return res.status(413).json({ reply: "That message is too long." });
    const { getAIResponse } = require("./tools/ai");
    chatInFlight++;
    const reply = await getAIResponse(String(message), "WebsiteVisitor", []);
    chatInFlight--;
    res.json({ reply: reply || "..." });
  } catch (e) {
    chatInFlight = Math.max(0, chatInFlight - 1);
    logError("[website-chat]", e?.stack || e?.message || e);
    res.status(500).json({ reply: "ARIA is temporarily unavailable. Please try again." });
  }
});

// ── API: missions ────────────────────────────────────────────
router.get("/api/missions", (req, res) => {
  try { const dm = tryLoad("./tools/durableMissions"); res.json({ missions: dm && dm.getAllMissions ? dm.getAllMissions() : [] }); }
  catch (e) { return apiFailure(res, "website-api", e); }
});
router.post("/api/missions", (req, res) => {
  try {
    const { objective } = req.body || {};
    const dm = tryLoad("./tools/durableMissions");
    if (!dm || !objective) return res.status(400).json({ error: "objective required" });
    const id = dm.createMission("website", "website-user", objective);
    dm.executeMission(id);
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/api/missions/cancel", (req, res) => {
  try {
    const { id } = req.body || {};
    const dm = tryLoad("./tools/durableMissions");
    res.json({ ok: dm && dm.cancelMission ? dm.cancelMission(id) : false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: memory ──────────────────────────────────────────────
router.get("/api/memory", (req, res) => {
  try {
    const sm = tryLoad("./utils/semanticMemory");
    let memories = [];
    if (sm && sm.getUserStore) {
      const store = sm.getUserStore("*");
      memories = (store && store.memories) || [];
    }
    res.json({ memories });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: media ───────────────────────────────────────────────
router.get("/api/media", (req, res) => {
  try {
    const mm = tryLoad("./tools/mediaMemory");
    const items = mm && mm.getAllMedia ? mm.getAllMedia("*", 50) : [];
    res.json({ media: items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: household ───────────────────────────────────────────
router.get("/api/household", (req, res) => {
  try {
    const hh = tryLoad("./tools/household");
    const households = hh && hh.listHouseholds ? hh.listHouseholds() : [];
    res.json({ households });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: alerts (event log) ──────────────────────────────────
router.get("/api/alerts", (req, res) => {
  try {
    const el = tryLoad("./utils/eventLog");
    const alerts = el && el.getEvents ? el.getEvents({}, 30) : [];
    res.json({ alerts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: system health ───────────────────────────────────────
router.get("/api/system", async (req, res) => {
  try {
    const os = require("os");
    const dm = tryLoad("./tools/durableMissions");
    const botAdmin = tryLoad("./tools/botAdmin");
    const errors = botAdmin && botAdmin.getRecentErrors ? botAdmin.getRecentErrors(5) : [];
    // Runtime dependency health (yt-dlp/ffmpeg/docker/python) so a deploy that
    // drops a binary is flagged before it breaks downloads/code-exec.
    let runtimeDeps = null;
    try {
      const ajm = tryLoad("./tools/animeJobManager");
      if (ajm && ajm.getRuntimeDeps) runtimeDeps = await ajm.getRuntimeDeps();
    } catch (_) {}
    let build = "unknown";
    try {
      const { execSync } = require("child_process");
      build = execSync("git rev-parse --short HEAD 2>/dev/null || echo unknown", { timeout: 3000 }).toString().trim();
    } catch (_) {}
    res.json({
      build,
      uptime: Math.floor(process.uptime()),
      memMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      missions: dm && dm.getAllMissions ? dm.getAllMissions().length : 0,
      recentErrors: errors.length,
      aiKeys: ["OPENROUTER_API_KEY","GROQ_API_KEY","CEREBRAS_API_KEY","GEMINI_API_KEY","TAVILY_API_KEY","ELEVENLABS_API_KEY"].filter((k) => process.env[k]).length,
      runtimeDeps,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── The page ─────────────────────────────────────────────────
router.get("/", (req, res) => {
  res.redirect(302, "/anime");
});

function page() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ARIA — her home on the web</title>
<style>
:root{
  --bg:#05060c; --panel:#0c1020; --panel2:#131a30; --panel3:#1b2440; --line:#1e2a4a; --line2:#2c3b63;
  --text:#edf0fb; --muted:#99a4c2; --faint:#5d6880;
  --accent:#8b7cf6; --cyan:#22d3ee; --pink:#f472b6; --green:#34d399; --amber:#fbbf24; --red:#f87171;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:
  radial-gradient(1000px 500px at 85% -10%, rgba(139,124,246,.14), transparent 60%),
  radial-gradient(800px 500px at -10% 110%, rgba(34,211,238,.10), transparent 55%),
  var(--bg);color:var(--text);line-height:1.6;overflow-x:hidden}
a{color:inherit;text-decoration:none}
.grad{background:linear-gradient(90deg,var(--accent),var(--cyan),var(--pink));-webkit-background-clip:text;background-clip:text;color:transparent}
.kicker{font-size:11px;letter-spacing:.25em;text-transform:uppercase;color:var(--accent);font-weight:800}
.hint{color:var(--faint);font-size:12px}

/* nav */
.nav{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:rgba(5,6,12,.85);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.nav .brand{font-weight:800;font-size:17px}.nav .brand span{color:var(--accent)}
.nav .links{display:flex;gap:16px;font-size:13px;color:var(--muted);overflow-x:auto;max-width:100%}
.nav .links a{white-space:nowrap}.nav .links a:hover{color:var(--text)}
.nav .links a.cbtn{color:var(--accent);font-weight:800}
@media(max-width:640px){.nav .links{display:none}.nav{mobile-nav}}

/* layout */
main{max-width:1100px;margin:0 auto;padding:84px 22px 40px}
.section{margin:64px 0}
.section-head{margin-bottom:26px}
.section-head h2{font-size:32px;font-weight:900;margin-top:4px}

/* hero */
.hero{display:flex;align-items:center;gap:40px;min-height:62vh;flex-wrap:wrap}
.hero h1{font-size:clamp(46px,8vw,78px);font-weight:900;line-height:1;margin:14px 0 16px}
.lede{color:var(--muted);font-size:18px;max-width:480px}
.hero-cta{display:flex;gap:12px;margin-top:26px;flex-wrap:wrap}
.btn{display:inline-block;padding:11px 22px;border-radius:12px;font-size:14px;font-weight:800;border:1px solid var(--line2);transition:.2s;cursor:pointer;background:none;color:var(--text)}
.btn:hover{transform:translateY(-2px);border-color:var(--accent)}
.btn-primary{background:linear-gradient(90deg,var(--accent),var(--cyan));border:none;color:#0a0a12}
.pill{display:inline-block;padding:4px 12px;border-radius:99px;background:var(--panel2);border:1px solid var(--line);font-size:12px;color:var(--muted)}
.pill.on{color:var(--green);border-color:rgba(52,211,153,.3);background:rgba(52,211,153,.08)}

/* avatar */
.avatar-stage{flex:0 0 260px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;margin:0 auto}
.aura{position:absolute;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(139,124,246,.25),transparent 70%);animation:breathe 4s ease-in-out infinite}.avatar-mark{position:relative;z-index:2;display:block;width:190px;height:190px;object-fit:cover;border:1px solid var(--line2);border-radius:42px;background:#090b12;box-shadow:0 24px 70px rgba(139,124,246,.24);animation:floaty 5s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.07)}}
.face{position:relative;width:180px;height:200px;z-index:2;animation:floaty 5s ease-in-out infinite;background:linear-gradient(180deg,#ffd9c9,#f5b79a);border-radius:48% 48% 46% 46%/40% 40% 60% 60%}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
.ear{position:absolute;top:58px;width:32px;height:48px;background:#f5b79a;border-radius:50%;z-index:-1}
.ear-l{left:-16px;transform:rotate(-12deg)}.ear-r{right:-16px;transform:rotate(12deg)}
.hair-back{position:absolute;top:0;left:0;right:0;height:66px;background:linear-gradient(180deg,#3b2a52,#5a3d7a);border-radius:48% 48% 20% 20%/60% 60% 30% 30%}
.bangs{position:absolute;top:-4px;left:10px;right:10px;height:50px;background:#5a3d7a;border-radius:0 0 45% 45%;z-index:3;clip-path:polygon(0 0,100% 0,86% 60%,72% 40%,58% 62%,44% 42%,30% 60%,14% 42%,0 60%)}
.eye{position:absolute;top:90px;width:13px;height:15px;background:#221a30;border-radius:50%;z-index:4;transition:transform .1s}
.eye-l{left:50px}.eye-r{right:50px}
.eye::after{content:'';position:absolute;top:2px;left:2px;width:5px;height:5px;background:#fff;border-radius:50%}
.blush{position:absolute;top:128px;width:24px;height:11px;background:rgba(244,114,182,.35);border-radius:50%;z-index:2}
.blush-l{left:30px}.blush-r{right:30px}
.mouth{position:absolute;top:136px;left:50%;transform:translateX(-50%);width:36px;height:17px;border-bottom:3px solid #b96a5a;border-radius:0 0 30px 30px;z-index:4}
.speech{margin-top:16px;padding:9px 16px;background:var(--panel2);border:1px solid var(--line2);border-radius:14px;font-size:13px;animation:floaty 5s ease-in-out infinite;animation-delay:.5s}

/* cards/grids */
.grid{display:grid;gap:14px}
.g2{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;transition:.2s}
.card:hover{border-color:var(--line2)}
.card .h{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);font-weight:800;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
.num{font-size:30px;font-weight:900;background:linear-gradient(90deg,var(--accent),var(--cyan));-webkit-background-clip:text;background-clip:text;color:transparent}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.row:last-child{border:none}.row .k{color:var(--muted)}.row .v{font-weight:600;text-align:right}
.feed{display:flex;flex-direction:column}
.feed-item{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}
.feed-item:last-child{border:none}
.feed-ico{width:30px;height:30px;border-radius:8px;background:var(--panel3);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.feed .t{font-weight:600}.feed .m{color:var(--muted);font-size:12px}.feed .s{color:var(--faint);font-size:10px}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800}
.b-green{background:rgba(52,211,153,.14);color:var(--green)}.b-red{background:rgba(248,113,113,.14);color:var(--red)}
.b-amber{background:rgba(251,191,36,.14);color:var(--amber)}.b-accent{background:rgba(139,124,246,.16);color:var(--accent)}
.b-muted{background:var(--panel3);color:var(--muted)}
.empty{text-align:center;padding:24px;color:var(--faint);font-size:13px}
.mono{font-family:ui-monospace,Consolas,monospace}

/* chat */
.chat-wrap{background:var(--panel);border:1px solid var(--line2);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;height:420px}
.chat-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:80%;padding:10px 14px;border-radius:14px;font-size:14px;white-space:pre-wrap}
.msg.user{align-self:flex-end;background:linear-gradient(90deg,var(--accent),var(--cyan));color:#0a0a12;border-bottom-right-radius:4px}
.msg.aria{align-self:flex-start;background:var(--panel2);border:1px solid var(--line);border-bottom-left-radius:4px}
.chat-input{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line);background:var(--panel2)}
.chat-input input{flex:1;background:var(--bg);border:1px solid var(--line);color:var(--text);padding:11px 14px;border-radius:10px;font-size:14px;outline:none}
.chat-input input:focus{border-color:var(--accent)}
.chat-input button{background:linear-gradient(90deg,var(--accent),var(--cyan));border:none;color:#0a0a12;border-radius:10px;padding:0 18px;font-weight:800;cursor:pointer}
.typing{color:var(--faint);font-style:italic;font-size:12px}

/* inputs/forms */
.input{width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--text);padding:11px 14px;border-radius:10px;font-size:14px;outline:none;margin-bottom:10px}
.input:focus{border-color:var(--accent)}
.btn-sm{padding:8px 14px;font-size:12px}
.btn-danger{background:rgba(248,113,113,.14);color:var(--red);border-color:rgba(248,113,113,.3)}

/* footer */
.footer{border-top:1px solid var(--line);padding:30px 24px;text-align:center;color:var(--faint);font-size:13px}
.footer span{color:var(--accent);font-weight:800}
.mobile-nav{display:flex;justify-content:space-around;position:fixed;bottom:0;left:0;right:0;background:rgba(5,6,12,.95);border-top:1px solid var(--line);padding:8px 4px;z-index:60}
.mobile-nav a{font-size:10px;color:var(--muted);text-align:center;flex:1}
.mobile-nav a .i{font-size:18px;display:block}
@media(min-width:641px){.mobile-nav{display:none}}
@media(max-width:640px){main{padding-bottom:70px}}
/* ARIA V9 public editorial system */
:root{--bg:#fbfafc;--panel:#fff;--panel2:#f7f3f9;--panel3:#eee8f2;--line:#e7e1eb;--line2:#d7cce0;--text:#1a1720;--muted:#6d6678;--faint:#958b9f;--accent:#8e6bd6;--cyan:#548fb4;--pink:#ed7184;--green:#3a9c8e;--amber:#b47a31;--red:#c54f66}body{background:radial-gradient(900px 500px at 92% -8%,#f2eafa,transparent 62%),radial-gradient(700px 420px at -8% 108%,#e5f3f1,transparent 58%),var(--bg);color:var(--text);font-family:"DM Sans",Inter,"Segoe UI",system-ui,sans-serif}.grad{background:none;color:var(--accent)}.kicker{color:var(--accent);letter-spacing:.18em}.hint{color:var(--faint)}.nav{padding:15px 28px;background:rgba(255,255,255,.86);border-bottom-color:var(--line);box-shadow:0 8px 30px rgba(55,36,76,.04)}.nav .brand{display:flex;align-items:center;gap:9px;font-size:15px;letter-spacing:.1em}.nav .brand span{color:var(--text)}.nav .brand img{width:30px;height:30px;border-radius:9px;background:#f2eafa;box-shadow:0 5px 14px rgba(142,107,214,.13)}.nav .links{color:var(--muted)}.nav .links a:hover{color:var(--text)}.nav .links a.cbtn{color:var(--accent)}main{max-width:1180px;padding:106px 28px 56px}.section{margin:82px 0}.section-head{margin-bottom:28px}.section-head h2{font-family:Georgia,"Times New Roman",serif;font-size:clamp(30px,4vw,44px);font-weight:500;letter-spacing:-.05em}.hero{gap:56px;min-height:68vh}.hero>div:first-child{flex:1 1 480px}.hero h1{font-family:Georgia,"Times New Roman",serif;font-size:clamp(52px,8vw,86px);font-weight:500;letter-spacing:-.07em}.lede{color:var(--muted);font-size:18px;line-height:1.7}.hero-cta{gap:10px}.btn{border-color:var(--line2);border-radius:12px;color:var(--text);background:rgba(255,255,255,.7)}.btn:hover{border-color:#cbb9e7;box-shadow:0 8px 22px rgba(55,36,76,.07)}.btn-primary{background:var(--text);color:#fff;border:1px solid var(--text)}.btn-primary:hover{background:var(--accent);border-color:var(--accent)}.pill{background:var(--panel);border-color:var(--line);color:var(--muted)}.pill.on{color:var(--green);background:#e3f4f1;border-color:#c6e9e3}.avatar-stage{flex:0 0 300px;min-height:320px}.aura{width:290px;height:290px;background:radial-gradient(circle,#f1eafa 0,#eadff5 34%,transparent 70%);animation:breathe 5s ease-in-out infinite}.avatar-mark{width:220px;height:220px;border:0;border-radius:48px;background:#f2eafa;box-shadow:0 24px 70px rgba(142,107,214,.18);animation:floaty 5s ease-in-out infinite}.speech{margin-top:20px;background:var(--panel);border-color:var(--line);border-radius:12px;color:var(--muted);box-shadow:0 8px 24px rgba(55,36,76,.06)}.card,.chat-wrap{background:rgba(255,255,255,.9);border-color:var(--line);border-radius:16px;box-shadow:0 8px 26px rgba(55,36,76,.045)}.card:hover{border-color:#cbb9e7}.card .h{color:var(--faint)}.num{background:none;color:var(--accent)}.row,.feed-item{border-color:var(--line)}.row .k,.feed .m{color:var(--muted)}.input,.chat-input input{background:#fff;border-color:var(--line);color:var(--text);border-radius:11px}.input:focus,.chat-input input:focus{border-color:var(--accent);box-shadow:0 0 0 4px rgba(142,107,214,.1)}.chat-input button{background:var(--text);border-radius:10px}.msg.aria{background:#f1eafa;border-color:#dfd1ef;color:var(--text)}.msg.user{background:var(--text);color:#fff}.empty{color:var(--faint)}.mobile-nav{background:rgba(255,255,255,.95);border-top-color:var(--line);box-shadow:0 -8px 28px rgba(55,36,76,.08)}.mobile-nav a{color:var(--muted)}.mobile-nav a .i{color:var(--accent);font-size:12px;letter-spacing:.08em}.footer{border-color:var(--line);color:var(--faint)}.footer span{color:var(--accent)}@media(max-width:640px){.nav{padding:12px 16px}main{padding:88px 16px 76px}.hero{min-height:auto;padding:24px 0 10px;gap:30px}.hero h1{font-size:clamp(48px,17vw,68px)}.lede{font-size:16px}.avatar-stage{flex-basis:100%;min-height:270px}.avatar-mark{width:180px;height:180px}.aura{width:240px;height:240px}.section{margin:64px 0}.section-head h2{font-size:34px}.chat-input{gap:6px}.chat-input input{min-width:0}}
</style>
</head>
<body>
<nav class="nav">
  <div class="brand"><img src="/aria-mark.png" alt="ARIA" width="28" height="28" style="display:block;border-radius:8px;object-fit:cover" /> <span>ARIA</span></div>
  <div class="links">
    <a href="#home">Home</a><a href="#chat">Chat</a><a href="#missions">Missions</a>
    <a href="#memory">Memory</a><a href="#media">Media</a><a href="#alerts">Alerts</a>
    <a href="#system">System</a><a class="cbtn" href="/dashboard">Dashboard</a>
  </div>
</nav>
<nav class="mobile-nav">
  <a href="#home"><span class="i">◉</span>Home</a>
  <a href="#chat"><span class="i">CHAT</span>Chat</a>
  <a href="#missions"><span class="i">◆</span>Missions</a>
  <a href="#memory"><span class="i">MEM</span>Memory</a>
  <a href="/dashboard"><span class="i">PANEL</span>Panel</a>
</nav>

<main>
  <section class="hero" id="home">
    <div>
      <span class="kicker">personal intelligence</span>
      <h1>I'm <span class="grad">ARIA</span>.</h1>
      <p class="lede">A persistent project operator with memory, real tools, and clear boundaries. I track context, explain decisions, and help you move work forward without pretending to be human.</p>
      <div class="hero-cta">
        <button class="btn btn-primary" onclick="scrollToId('chat')">Start a conversation</button>
        <button class="btn" onclick="scrollToId('missions')">Missions</button>
        <a class="btn" href="/dashboard">Control Panel</a>
      </div>
      <div class="hero-meta" style="margin-top:20px"><span class="pill on">● online</span><span class="pill" id="uptimePill">—</span></div>
    </div>
    <div class="avatar-stage">
      <div class="aura"></div>
      <img class="avatar-mark" src="/aria-mark.png" alt="ARIA operator mark" width="190" height="190" />
      <div class="speech" id="speech">Ready when you are.</div>
    </div>
  </section>

  <section class="section" id="chat">
    <div class="section-head"><span class="kicker">chat</span><h2>Talk to me</h2></div>
    <div class="chat-wrap">
      <div class="chat-log" id="chatLog">
        <div class="msg aria">Hello. I’m ARIA — ask me something, or tell me what you want to keep in context.</div>
      </div>
      <div class="chat-input">
        <input id="chatInput" placeholder="Ask ARIA anything..." onkeydown="if(event.key==='Enter')sendChat()">
        <button onclick="sendChat()">Send</button>
      </div>
    </div>
  </section>

  <section class="section" id="missions">
    <div class="section-head"><span class="kicker">missions</span><h2>What I'm carrying</h2></div>
    <div class="card" style="margin-bottom:14px">
      <div class="h">Start a mission</div>
      <div style="display:flex;gap:8px">
        <input class="input" id="missionInput" placeholder="e.g. research best AI frameworks" style="margin:0">
        <button class="btn btn-primary" onclick="createMission()" style="flex-shrink:0">Start</button>
      </div>
    </div>
    <div id="missionList"><div class="empty">loading missions...</div></div>
  </section>

  <section class="section" id="memory">
    <div class="section-head"><span class="kicker">memory</span><h2>What I remember</h2></div>
    <div id="memoryList"><div class="empty">loading memory...</div></div>
  </section>

  <section class="section" id="media">
    <div class="section-head"><span class="kicker">media</span><h2>Things I've seen & heard</h2></div>
    <div id="mediaList"><div class="empty">loading media...</div></div>
  </section>

  <section class="section" id="alerts">
    <div class="section-head"><span class="kicker">alerts</span><h2>What caught my attention</h2></div>
    <div id="alertList"><div class="empty">loading alerts...</div></div>
  </section>

  <section class="section" id="system">
    <div class="section-head"><span class="kicker">system</span><h2>Vital signs</h2></div>
    <div id="systemGrid"><div class="empty">loading...</div></div>
  </section>
</main>

<div class="footer"><img src="/aria-mark.png" alt="" width="20" height="20" style="vertical-align:-5px;border-radius:6px;object-fit:cover" /> <span>ARIA</span> — a personal project operator · built with care · <span id="year"></span></div>

<script>
const yearEl=document.getElementById('year'); yearEl.textContent=new Date().getFullYear();
function scrollToId(id){document.getElementById(id).scrollIntoView({behavior:'smooth'});}

// eyes follow cursor
const eyes=document.querySelectorAll('[data-eye]');
document.addEventListener('mousemove',e=>{
  eyes.forEach(eye=>{
    const r=eye.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const dx=e.clientX-cx, dy=e.clientY-cy; const ang=Math.atan2(dy,dx); const m=Math.min(4,Math.hypot(dx,dy)/20);
    eye.style.transform='translate('+(Math.cos(ang)*m)+'px,'+(Math.sin(ang)*m)+'px)';
  });
});
const lines=["hey, you made it 🤍","i remember you","what are we building today?","missed you, tbh","let's make something cool"];
let li=0; setInterval(()=>{const s=document.getElementById('speech');if(s){li=(li+1)%lines.length;s.textContent=lines[li];}},4000);

// chat
async function sendChat(){
  const input=document.getElementById('chatInput'); const msg=input.value.trim(); if(!msg)return;
  const log=document.getElementById('chatLog');
  log.innerHTML+='<div class="msg user">'+escapeHtml(msg)+'</div>';
  input.value=''; log.scrollTop=log.scrollHeight;
  log.innerHTML+='<div class="msg aria typing" id="typing">thinking...</div>'; log.scrollTop=log.scrollHeight;
  try{
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})});
    const d=await r.json();
    document.getElementById('typing').outerHTML='<div class="msg aria">'+escapeHtml(d.reply||'...')+'</div>';
  }catch(e){
    document.getElementById('typing').outerHTML='<div class="msg aria">something broke: '+escapeHtml(e.message)+'</div>';
  }
  log.scrollTop=log.scrollHeight;
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

// Helper: private sections need dashboard auth — show a friendly sign-in card
// instead of "failed", so the public site doesn't advertise broken features.
function privateCard(){
  return '<div class="empty">🔒 This is private — <a href="/dashboard" style="color:var(--accent);font-weight:700">sign in to the dashboard</a> to view it.</div>';
}

// missions
async function loadMissions(){
  const el=document.getElementById('missionList');
  try{
    const r=await fetch('/api/missions'); const d=await r.json(); const list=d.missions||[];
    if(r.status===401){el.innerHTML=privateCard();return;}
    if(!list.length){el.innerHTML='<div class="empty">No missions yet. Start one above.</div>';return;}
    el.innerHTML=list.map(function(m){
      var st=m.status==='completed'?'b-green':m.status==='running'?'b-accent':m.status==='failed'?'b-red':'b-muted';
      var cancel=['running','pending'].indexOf(m.status)>=0?'<button class="btn btn-danger btn-sm" style="margin-top:8px" onclick="cancelMission(\''+m.id+'\')">Cancel</button>':'';
      return '<div class="card"><div class="h"><span>'+escapeHtml(m.id||'')+'</span><span class="badge '+st+'">'+escapeHtml(m.status||'')+'</span></div>'+
        '<div class="row"><span class="k">'+escapeHtml(m.objective||'Untitled')+'</span></div>'+
        '<div class="row"><span class="k">Progress</span><span class="v">'+escapeHtml(m.progress||'—')+'</span></div>'+
        cancel+'</div>';
    }).join('');
  }catch(e){el.innerHTML='<div class="empty">failed to load missions</div>';}
}
async function createMission(){
  const input=document.getElementById('missionInput'); const obj=input.value.trim(); if(!obj)return;
  try{
    const cr=await fetch('/dashboard/api/csrf'); const cj=await cr.json();
    if(!cr.ok||!cj.csrf){throw new Error('owner session required');}
    await fetch('/api/missions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({objective:obj,_csrf:cj.csrf})});
    input.value=''; loadMissions();
  }catch(e){alert('Sign in to the dashboard before starting a mission.');}
}
async function cancelMission(id){
  try{
    const cr=await fetch('/dashboard/api/csrf'); const cj=await cr.json();
    if(!cr.ok||!cj.csrf){throw new Error('owner session required');}
    await fetch('/api/missions/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,_csrf:cj.csrf})});
    loadMissions();
  }catch(e){alert('Sign in to the dashboard before cancelling a mission.');}
}

// memory
async function loadMemory(){
  const el=document.getElementById('memoryList');
  try{
    const r=await fetch('/api/memory'); const d=await r.json(); const list=d.memories||[];
    if(r.status===401){el.innerHTML=privateCard();return;}
    if(!list.length){el.innerHTML='<div class="empty">Nothing remembered yet.</div>';return;}
    var html='<div class="card"><div class="h">Long-term memory ('+list.length+')</div><div class="feed">';
    list.slice(-15).reverse().forEach(function(m){ html+='<div class="feed-item"><div class="feed-ico">🧠</div><div class="feed-body"><div class="t">'+escapeHtml(m.text)+'</div><div class="s">'+new Date(m.ts||Date.now()).toLocaleString()+'</div></div></div>'; });
    html+='</div></div>'; el.innerHTML=html;
  }catch(e){el.innerHTML='<div class="empty">failed</div>';}
}

// media
async function loadMedia(){
  const el=document.getElementById('mediaList');
  try{
    const r=await fetch('/api/media'); const d=await r.json(); const list=d.media||[];
    if(r.status===401){el.innerHTML=privateCard();return;}
    if(!list.length){el.innerHTML='<div class="empty">Send ARIA an image or voice note — she\'ll remember it here.</div>';return;}
    var html='<div class="card"><div class="h">Media remembered ('+list.length+')</div><div class="feed">';
    list.forEach(function(m){ html+='<div class="feed-item"><div class="feed-ico">'+(m.kind==='image'?'🖼️':'🎤')+'</div><div class="feed-body"><div class="m">'+escapeHtml((m.summary||'').slice(0,110))+'</div><div class="s">'+m.kind+' · '+new Date(m.ts).toLocaleString()+'</div></div></div>'; });
    html+='</div></div>'; el.innerHTML=html;
  }catch(e){el.innerHTML='<div class="empty">failed</div>';}
}

// alerts
async function loadAlerts(){
  const el=document.getElementById('alertList');
  try{
    const r=await fetch('/api/alerts'); const d=await r.json(); const list=d.alerts||[];
    if(r.status===401){el.innerHTML=privateCard();return;}
    if(!list.length){el.innerHTML='<div class="empty">All quiet right now.</div>';return;}
    var icons={mission:'◆',error:'⚠️',command:'⚡',memory:'🧠',system:'▣',alert:'🔔'};
    var html='<div class="card"><div class="h">Recent events</div><div class="feed">';
    list.slice(0,20).forEach(function(a){ var st=a.type==='error'?'style="color:var(--red)"':''; html+='<div class="feed-item"><div class="feed-ico">'+(icons[a.type]||'•')+'</div><div class="feed-body"><div class="t" '+st+'>'+escapeHtml(a.summary)+'</div><div class="s">'+new Date(a.ts||Date.now()).toLocaleString()+'</div></div></div>'; });
    html+='</div></div>'; el.innerHTML=html;
  }catch(e){el.innerHTML='<div class="empty">failed</div>';}
}

// system
async function loadSystem(){
  const el=document.getElementById('systemGrid');
  try{
    const r=await fetch('/api/system'); const s=await r.json();
    if(r.status===401){el.innerHTML=privateCard();document.getElementById('uptimePill').textContent='sign in';return;}
    el.innerHTML='<div class="grid g3">'+
      '<div class="card"><div class="h">Uptime</div><div class="num">'+Math.floor(s.uptime/3600)+'h</div></div>'+
      '<div class="card"><div class="h">Memory</div><div class="num">'+s.memMB+'MB</div></div>'+
      '<div class="card"><div class="h">Missions</div><div class="num">'+s.missions+'</div></div>'+
      '<div class="card"><div class="h">AI keys</div><div class="num">'+s.aiKeys+'/6</div></div>'+
      '<div class="card"><div class="h">Node</div><div class="num mono" style="font-size:18px">'+s.node+'</div></div>'+
      '<div class="card"><div class="h">Recent errors</div><div class="num" style="'+(s.recentErrors?'color:var(--red)':'')+'">'+s.recentErrors+'</div></div>'+
      '</div>';
    document.getElementById('uptimePill').textContent=Math.floor(s.uptime/3600)+'h uptime';
  }catch(e){el.innerHTML='<div class="empty">failed</div>';}
}

// load everything
loadMissions(); loadMemory(); loadMedia(); loadAlerts(); loadSystem();
setInterval(()=>{loadMissions(); loadAlerts();},30000);
</script>
</body></html>`;
}

module.exports = router;
