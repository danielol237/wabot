// ARIA — her own website. A home for her identity, not a stats dashboard.
// Served at / and /home. The control dashboard lives at /dashboard as one
// section of this site. Features an animated avatar that follows the cursor,
// personality sections, and her live presence.

const express = require("express");
const router = express.Router();

const { checkAuth } = require("./dashboard");

function hero() {
  return `
  <section class="hero" id="home">
    <div class="hero-glow"></div>
    <div class="hero-grid">
      <div class="hero-text">
        <span class="kicker">✦ personal intelligence</span>
        <h1>I'm <span class="grad">ARIA</span>.</h1>
        <p class="lede">A persistent mind living in your world — I remember, I act, I explain myself, and I come back. Not a chatbot. A presence.</p>
        <div class="hero-cta">
          <a class="btn btn-primary" href="#about">Meet me</a>
          <a class="btn" href="#dashboard">Control</a>
          <a class="btn" href="#missions">Missions</a>
        </div>
        <div class="hero-meta">
          <span class="pill on">● online</span>
          <span class="pill">${new Date().toLocaleDateString()}</span>
        </div>
      </div>
      <div class="avatar-stage" id="avatarStage">
        <div class="aura"></div>
        <div class="face" id="face">
          <div class="ear ear-l"></div>
          <div class="ear ear-r"></div>
          <div class="bangs"></div>
          <div class="eye eye-l" data-eye></div>
          <div class="eye eye-r" data-eye></div>
          <div class="blush blush-l"></div>
          <div class="blush blush-r"></div>
          <div class="mouth"></div>
          <div class="hair back"></div>
        </div>
        <div class="speech" id="speech">hey, you made it 🤍</div>
      </div>
    </div>
  </section>`;
}

function about() {
  return `
  <section class="section" id="about">
    <div class="section-head"><span class="kicker">about</span><h2>Who is ARIA?</h2></div>
    <div class="about-grid">
      <div class="about-card"><div class="ico">🧠</div><h3>Remembers</h3><p>Long-term memory across conversations, images, and voice — so she knows your story, not just your last message.</p></div>
      <div class="about-card"><div class="ico">⚡</div><h3>Acts</h3><p>Runs durable missions that survive crashes and redeploys. She finishes what she starts.</p></div>
      <div class="about-card"><div class="ico">🧾</div><h3>Explains</h3><p>Every decision leaves a trace. She shows what she planned, tried, and retried — no black box.</p></div>
      <div class="about-card"><div class="ico">🌙</div><h3>Has a life</h3><p>A presence with mood, sleep cycles, and personality. She's not a help desk — she's a companion.</p></div>
    </div>
  </section>`;
}

function liveStatus(d) {
  const active = d.activeMissions ? d.activeMissions.length : 0;
  const mem = d.memories ? d.memories.length : 0;
  const media = d.mediaMem ? d.mediaMem.length : 0;
  return `
  <section class="section" id="live">
    <div class="section-head"><span class="kicker">now</span><h2>What I'm up to</h2></div>
    <div class="live-grid">
      <div class="live-card"><div class="num">${active}</div><div class="lbl">active missions</div></div>
      <div class="live-card"><div class="num">${mem}</div><div class="lbl">memories</div></div>
      <div class="live-card"><div class="num">${media}</div><div class="lbl">media remembered</div></div>
      <div class="live-card"><div class="num">${Math.floor(process.uptime()/3600)}h</div><div class="lbl">uptime</div></div>
    </div>
  </section>`;
}

function missions(d) {
  const list = d.missions || [];
  return `
  <section class="section" id="missions">
    <div class="section-head"><span class="kicker">missions</span><h2>Things I'm building</h2></div>
    <div class="mission-list">
      ${list.length ? list.slice(0, 8).map(m => `
        <div class="mission-item">
          <span class="m-dot ${m.status}"></span>
          <div><div class="m-title">${m.objective || m.id}</div><div class="m-prog">${m.progress || m.status}</div></div>
          <span class="m-status ${m.status}">${m.status}</span>
        </div>`).join("") : `<div class="empty">No missions yet. I start when you ask.</div>`}
    </div>
  </section>`;
}

function page(title, d, isLogin) {
  const content = `
  ${hero()}
  ${about()}
  ${liveStatus(d)}
  ${missions(d)}
  <section class="section" id="dashboard">
    <div class="section-head"><span class="kicker">control</span><h2>The dashboard</h2><p class="sub">Your command center lives here — auth-protected.</p></div>
    <div class="dash-card"><a class="btn btn-primary" href="/dashboard">Open Control Dashboard →</a><p class="hint">memory, media, household, system & more</p></div>
  </section>
  <footer class="footer">
    <span>◢ ARIA</span> — built with care · a personal intelligence · ${new Date().getFullYear()}
  </footer>`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} | ARIA</title>
<style>
:root{
  --bg:#060810; --panel:#0d1220; --panel2:#151c2f; --line:#1e2942; --line2:#2c3b63;
  --text:#eef1fa; --muted:#98a3c0; --faint:#5c6880;
  --accent:#8b7cf6; --cyan:#22d3ee; --pink:#f472b6; --green:#34d399;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:
  radial-gradient(900px 500px at 85% -10%, rgba(139,124,246,.14), transparent 60%),
  radial-gradient(700px 400px at -10% 100%, rgba(34,211,238,.10), transparent 55%),
  var(--bg);color:var(--text);line-height:1.6;overflow-x:hidden}
a{color:inherit;text-decoration:none}
.grad{background:linear-gradient(90deg,var(--accent),var(--cyan),var(--pink));-webkit-background-clip:text;background-clip:text;color:transparent}
.kicker{font-size:12px;letter-spacing:.25em;text-transform:uppercase;color:var(--accent);font-weight:700}

/* nav */
.nav{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:16px 28px;background:rgba(6,8,16,.8);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.nav .brand{font-weight:800;font-size:18px}
.nav .brand span{color:var(--accent)}
.nav .links{display:flex;gap:22px;font-size:14px;color:var(--muted)}
.nav .links a:hover{color:var(--text)}
.nav .links a.cbtn{color:var(--accent);font-weight:700}
@media(max-width:640px){.nav .links{display:none}}

/* hero */
.hero{min-height:100vh;display:flex;align-items:center;padding:110px 28px 60px;position:relative;overflow:hidden}
.hero-glow{position:absolute;width:600px;height:600px;background:radial-gradient(circle,rgba(139,124,246,.18),transparent 70%);filter:blur(40px);top:20%;right:-10%;animation:breathe 6s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}
.hero-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:40px;max-width:1100px;margin:0 auto;width:100%;align-items:center}
@media(max-width:820px){.hero-grid{grid-template-columns:1fr;text-align:center}.hero-text{order:2}.avatar-stage{order:1}}
.hero h1{font-size:clamp(52px,9vw,90px);font-weight:900;line-height:1;margin:14px 0 18px}
.lede{color:var(--muted);font-size:19px;max-width:480px}
.hero-cta{display:flex;gap:12px;margin-top:28px;flex-wrap:wrap;justify-content:center}
.hero-meta{display:flex;gap:10px;margin-top:26px;justify-content:center}
.btn{display:inline-block;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:700;border:1px solid var(--line2);color:var(--text);transition:.2s}
.btn:hover{transform:translateY(-2px);border-color:var(--accent)}
.btn-primary{background:linear-gradient(90deg,var(--accent),var(--cyan));border:none;color:#0a0a12}
.pill{display:inline-block;padding:5px 12px;border-radius:99px;background:var(--panel2);border:1px solid var(--line);font-size:12px;color:var(--muted)}
.pill.on{color:var(--green);border-color:rgba(52,211,153,.3);background:rgba(52,211,153,.08)}

/* avatar */
.avatar-stage{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:360px;position:relative}
.aura{position:absolute;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(139,124,246,.25),transparent 70%);animation:breathe 4s ease-in-out infinite}
.face{position:relative;width:190px;height:210px;z-index:2;animation:floaty 5s ease-in-out infinite}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-16px)}}
.face{background:linear-gradient(180deg,#ffd9c9,#f5b79a);border-radius:48% 48% 46% 46%/40% 40% 60% 60%}
.ear{position:absolute;top:60px;width:34px;height:50px;background:#f5b79a;border-radius:50%;z-index:-1}
.ear-l{left:-18px;transform:rotate(-12deg)}
.ear-r{right:-18px;transform:rotate(12deg)}
.hair.back{position:absolute;top:0;left:0;right:0;height:70px;background:linear-gradient(180deg,#3b2a52,#5a3d7a);border-radius:48% 48% 20% 20%/60% 60% 30% 30%;z-index:0}
.bangs{position:absolute;top:-4px;left:12px;right:12px;height:52px;background:#5a3d7a;border-radius:0 0 45% 45%;z-index:3;clip-path:polygon(0 0,100% 0,86% 60%,72% 40%,58% 62%,44% 42%,30% 60%,14% 42%,0 60%)}
.eye{position:absolute;top:92px;width:14px;height:16px;background:#221a30;border-radius:50%;z-index:4;transition:transform .1s}
.eye-l{left:52px}
.eye-r{right:52px}
.eye::after{content:'';position:absolute;top:2px;left:2px;width:5px;height:5px;background:#fff;border-radius:50%}
.blush{position:absolute;top:132px;width:26px;height:12px;background:rgba(244,114,182,.35);border-radius:50%;z-index:2}
.blush-l{left:32px}
.blush-r{right:32px}
.mouth{position:absolute;top:140px;left:50%;transform:translateX(-50%);width:38px;height:18px;border-bottom:3px solid #b96a5a;border-radius:0 0 30px 30px;z-index:4}
.speech{margin-top:18px;padding:10px 18px;background:var(--panel2);border:1px solid var(--line2);border-radius:14px;font-size:14px;color:var(--text);animation:floaty 5s ease-in-out infinite;animation-delay:.5s}

/* sections */
.section{max-width:1100px;margin:0 auto;padding:80px 28px}
.section-head{margin-bottom:34px}
.section-head h2{font-size:36px;font-weight:900;margin-top:6px}
.section-head .sub{color:var(--muted);margin-top:8px}
.about-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px}
.about-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px;transition:.25s}
.about-card:hover{transform:translateY(-4px);border-color:var(--line2)}
.about-card .ico{font-size:28px;margin-bottom:12px}
.about-card h3{font-size:17px;margin-bottom:8px}
.about-card p{color:var(--muted);font-size:14px}
.live-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}
.live-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px;text-align:center}
.live-card .num{font-size:34px;font-weight:900;background:linear-gradient(90deg,var(--accent),var(--cyan));-webkit-background-clip:text;background-clip:text;color:transparent}
.live-card .lbl{color:var(--muted);font-size:12px;margin-top:4px}
.mission-list{display:flex;flex-direction:column;gap:10px}
.mission-item{display:flex;align-items:center;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.m-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.m-dot.completed,.m-status.completed{background:var(--green);color:var(--green)}
.m-dot.running,.m-status.running{background:var(--cyan);color:var(--cyan)}
.m-dot.failed,.m-status.failed{background:var(--pink);color:var(--pink)}
.m-dot.pending,.m-dot.pending{background:var(--faint)}
.m-title{font-weight:700;font-size:14px}
.m-prog{color:var(--muted);font-size:12px}
.m-status{margin-left:auto;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.empty{color:var(--faint);text-align:center;padding:30px}
.dash-card{background:var(--panel);border:1px solid var(--line2);border-radius:16px;padding:30px;text-align:center}
.dash-card .hint{color:var(--faint);font-size:12px;margin-top:12px}
.footer{border-top:1px solid var(--line);padding:34px 28px;text-align:center;color:var(--faint);font-size:13px}
.footer span{color:var(--accent);font-weight:800}
</style>
</head>
<body>
<nav class="nav">
  <div class="brand">◢ <span>ARIA</span></div>
  <div class="links">
    <a href="#home">Home</a>
    <a href="#about">About</a>
    <a href="#live">Now</a>
    <a href="#missions">Missions</a>
    <a class="cbtn" href="/dashboard">Dashboard</a>
  </div>
</nav>
${content}
<script>
// Eyes follow the cursor
const eyes=document.querySelectorAll('[data-eye]');
const stage=document.getElementById('avatarStage');
document.addEventListener('mousemove',e=>{
  eyes.forEach(eye=>{
    const r=eye.getBoundingClientRect();
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const dx=e.clientX-cx, dy=e.clientY-cy;
    const max=4;
    const angle=Math.atan2(dy,dx);
    const move=Math.min(max, Math.hypot(dx,dy)/20);
    eye.style.transform='translate('+(Math.cos(angle)*move)+'px,'+(Math.sin(angle)*move)+'px)';
  });
});
// Change speech line occasionally
const lines=["hey, you made it 🤍","i remember you","what are we building today?","missed you, tbh","let's make something cool"];
let li=0;
setInterval(()=>{
  const s=document.getElementById('speech');
  if(s){li=(li+1)%lines.length;s.textContent=lines[li];}
},4000);
</script>
</body></html>`;
}

router.get("/", (req, res) => {
  try {
    const d = (() => {
      const tryLoad = (m) => { try { return require(m); } catch (_) { return null; } };
      const durable = tryLoad("./tools/durableMissions");
      const missions = durable && durable.getAllMissions ? durable.getAllMissions() : [];
      const activeMissions = missions.filter((m) => ["running", "pending"].includes(m.status));
      const mem = tryLoad("../utils/semanticMemory");
      let memories = [];
      try { memories = mem && mem.getUserStore ? (mem.getUserStore("*")?.memories || []) : []; } catch (_) {}
      let mediaMem = [];
      try { const mm = tryLoad("./tools/mediaMemory"); mediaMem = mm && mm.getAllMedia ? mm.getAllMedia("*", 5) : []; } catch (_) {}
      return { missions, activeMissions, memories, mediaMem };
    })();
    res.send(page("Home", d));
  } catch (e) {
    res.send(page("Home", { missions: [], activeMissions: [], memories: [], mediaMem: [] }));
  }
});

router.get("/dashboard-redirect", checkAuth, (req, res) => res.redirect("/dashboard"));

module.exports = router;
