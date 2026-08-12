// ── ARIA Learner Portal ─────────────────────────────────────────
// A per-learner web portal: each student signs in (Continue with Google, or
// email) and gets their OWN Learner Space page — the interactive side of the
// ARIA Academy. Includes a competition leaderboard.
//
// Auth: Google OAuth 2.0 (manual, axios) + email/password fallback. Sessions
// are HMAC-signed cookies (no external session store needed). All routes are
// mounted under /portal in dashboard.js.
//
// This is intentionally self-contained so it can be wired in without touching
// the existing dashboard auth.

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Cookie reader (populates req.cookies) — must run before any route uses it.
router.use((req, res, next) => {
  const raw = req.headers.cookie || "";
  req.cookies = req.cookies || {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) req.cookies[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  next();
});

// ── Config (env) ────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const SESSION_SECRET = process.env.PORTAL_SESSION_SECRET || process.env.DASHBOARD_CSRF_SECRET || "aria-portal-secret";
// Public URL of this bot, used for the OAuth redirect URI.
const BASE_URL = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || "";

// ── Learner accounts store (JSON file) ──────────────────────────
const STATE_FILE = path.join(__dirname, "../../data/learnerAccounts.json");
let accounts = {}; // key: googleSub | email -> { id, name, email, googleSub, passwordHash, createdAt }

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) accounts = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || {};
  } catch (_) { accounts = {}; }
}
function save() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(accounts)); } catch (_) {}
}
load();

function hashPw(pw) { return crypto.createHash("sha256").update(pw + "|aria").digest("hex"); }
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  try {
    const [body, sig] = String(token || "").split(".");
    const expect = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
    if (sig !== expect) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (_) { return null; }
}

// Auth middleware for portal pages.
function portalAuth(req, res, next) {
  const payload = verifyToken(req.cookies?.aria_portal);
  if (!payload) return res.redirect("/portal/login");
  req.learner = payload;
  next();
}

// ── Google OAuth ────────────────────────────────────────────────
router.get("/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.redirect("/portal/login?error=google-not-configured");
  const state = signToken({ r: crypto.randomBytes(8).toString("hex"), exp: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: BASE_URL + "/portal/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    state,
  });
  res.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
});

router.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/portal/login?error=no-code");
  try {
    const tok = await axios.post("https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: BASE_URL + "/portal/auth/google/callback",
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 }
    );
    const info = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tok.data.access_token}` }, timeout: 20000,
    });
    const p = info.data; // { id, email, name, picture }
    const sub = String(p.id);
    if (!accounts[sub]) {
      accounts[sub] = { id: sub, name: p.name || p.email, email: p.email, googleSub: sub, createdAt: Date.now() };
      save();
    }
    const learner = accounts[sub];
    const token = signToken({ sub, name: learner.name, email: learner.email, exp: Date.now() + 7 * 86400000 });
    res.cookie("aria_portal", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400000 * 1000, path: "/portal" });
    return res.redirect("/portal");
  } catch (e) {
    return res.redirect("/portal/login?error=oauth-failed");
  }
});

// ── Email signup / login ────────────────────────────────────────
router.post("/auth/email", express.json(), (req, res) => {
  const { email, password, name, mode } = req.body || {};
  const clean = String(email || "").toLowerCase().trim();
  if (!clean || !password) return res.status(400).json({ error: "email and password required" });
  if (String(password).length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });

  const existing = Object.values(accounts).find((a) => a.email === clean);
  if (mode === "signup") {
    if (existing) return res.status(409).json({ error: "account already exists — log in" });
    const id = "em_" + crypto.randomBytes(6).toString("hex");
    accounts[id] = { id, name: name || clean.split("@")[0], email: clean, passwordHash: hashPw(password), createdAt: Date.now() };
    save();
    const learner = accounts[id];
    const token = signToken({ sub: id, name: learner.name, email: learner.email, exp: Date.now() + 7 * 86400000 });
    res.cookie("aria_portal", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400000 * 1000, path: "/portal" });
    return res.json({ ok: true });
  }
  // login
  if (!existing) return res.status(401).json({ error: "no account with that email" });
  if (existing.passwordHash !== hashPw(password)) return res.status(401).json({ error: "wrong password" });
  const token = signToken({ sub: existing.id, name: existing.name, email: existing.email, exp: Date.now() + 7 * 86400000 });
  res.cookie("aria_portal", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400000 * 1000, path: "/portal" });
  return res.json({ ok: true });
});

router.get("/logout", (req, res) => {
  res.clearCookie("aria_portal", { path: "/portal" });
  res.redirect("/portal/login");
});

// ── Portal pages ────────────────────────────────────────────────
const PAGE = (title, body) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ARIA Academy</title>
<style>
  *{box-sizing:border-box;margin:0}
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:linear-gradient(160deg,#0a1628,#0f3a3f 60%,#135d5d);min-height:100vh;color:#e8f1f0;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#0d1b2bcc;backdrop-filter:blur(10px);border:1px solid #2a4a5a;border-radius:20px;padding:32px;width:100%;max-width:420px;box-shadow:0 20px 60px #0009}
  h1{font-size:26px;margin-bottom:4px}
  .sub{color:#8fb3b0;font-size:14px;margin-bottom:22px}
  .gbtn{width:100%;display:flex;align-items:center;justify-content:center;gap:12px;background:#fff;color:#1a1a1a;border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none}
  .gbtn svg{width:20px;height:20px}
  .or{display:flex;align-items:center;gap:12px;color:#6b8a87;font-size:11px;letter-spacing:1px;margin:22px 0 18px}
  .or::before,.or::after{content:"";flex:1;height:1px;background:#26434a}
  label{display:block;font-size:13px;color:#bcd0cd;margin:14px 0 6px}
  input{width:100%;background:#122433;border:1px solid #2c4c58;border-radius:12px;padding:12px 14px;color:#eef6f5;font-size:14px;outline:none}
  input:focus{border-color:#37b7a3}
  .hint{color:#6b8a87;font-size:11px;margin-top:6px}
  .btn{width:100%;background:#2dd4bf;color:#06211d;border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;margin-top:20px}
  .foot{color:#8fb3b0;font-size:13px;text-align:center;margin-top:20px}
  .foot a{color:#4fd6c3;text-decoration:none}
  .err{background:#3a1218;border:1px solid #7a2633;color:#ffb3bd;font-size:13px;padding:10px 12px;border-radius:10px;margin-bottom:16px}
  .tag{display:inline-block;background:#123a36;color:#6fe3cf;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:600;margin-top:10px}
</style></head><body>${body}</body></html>`;

function googleSvg() { return `<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`; }

// ── Login / Signup page (matches the CoreRipper-style screen) ──
router.get("/login", (req, res) => {
  const err = req.query.error || "";
  const errMsg = err === "google-not-configured" ? "Google sign-in isn't set up yet — create an account with email below, or ask ARIA to enable it." :
    err === "no-code" || err === "oauth-failed" ? "Google sign-in didn't complete. Please try again." :
    err === "logged-out" ? "You've been logged out." : "";
  const body = `
  <div class="card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#2dd4bf,#0e7490);display:flex;align-items:center;justify-content:center;font-weight:800;color:#042">A</div>
      <div style="font-size:20px;font-weight:800"><span style="color:#fff">ARIA</span> <span style="color:#2dd4bf">Academy</span></div>
    </div>
    <h1>Create your account</h1>
    <div class="sub">Get started free. No credit card required.</div>
    ${errMsg ? `<div class="err">${errMsg}</div>` : ""}
    <a class="gbtn" href="/portal/auth/google">${googleSvg()} Continue with Google</a>
    <div class="or">OR SIGN UP WITH EMAIL</div>
    <div id="emsg"></div>
    <label>Email</label>
    <input id="em" type="email" placeholder="you@example.com">
    <label>Password</label>
    <input id="pw" type="password" placeholder="••••••••">
    <div class="hint">At least 8 characters.</div>
    <button class="btn" onclick="submit('signup')">Create account →</button>
    <div class="foot">Already have an account? <a href="#" onclick="submit('login');return false">Log in</a></div>
  </div>
  <script>
    async function submit(mode){
      const email=document.getElementById('em').value.trim();
      const password=document.getElementById('pw').value;
      const el=document.getElementById('emsg');
      if(!email||!password){el.innerHTML='<div class="err">Fill in both fields.</div>';return;}
      if(password.length<8){el.innerHTML='<div class="err">Password must be at least 8 characters.</div>';return;}
      try{
        const r=await fetch('/portal/auth/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,mode})});
        const j=await r.json();
        if(r.ok){location.href='/portal';}
        else{el.innerHTML='<div class="err">'+j.error+'</div>';}
      }catch(e){el.innerHTML='<div class="err">'+e.message+'</div>';}
    }
  </script>`;
  res.send(PAGE("Create your account", body));
});

// ── Learner home — their OWN Learner Space ──────────────────────
router.get("/", portalAuth, (req, res) => {
  let space;
  try {
    const ls = require("./academy/learnerSpace");
    space = ls.buildLearnerSpace(req.learner.sub);
  } catch (_) {
    space = null;
  }
  const name = req.learner.name || "Learner";
  const card = (t, b) => `<div class="card" style="margin-top:14px"><div style="font-weight:700;margin-bottom:8px;font-size:13px;color:#6fe3cf">${t}</div><div style="font-size:14px;color:#e8f1f0">${b}</div></div>`;
  const stat = (k, v) => `<div style="flex:1;min-width:120px;background:#10283a;border:1px solid #1e4650;border-radius:14px;padding:14px;text-align:center"><div style="font-size:24px;font-weight:800;color:#2dd4bf">${v}</div><div style="color:#8fb3b0;font-size:12px;margin-top:4px">${k}</div></div>`;
  const body = `
  <div class="card" style="max-width:720px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#2dd4bf,#0e7490);display:flex;align-items:center;justify-content:center;font-weight:800;color:#042;font-size:18px">${name[0]||"A"}</div>
        <div>
          <div style="font-size:18px;font-weight:800">Hi, ${name} 👋</div>
          <div class="tag">${req.learner.email}</div>
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <a class="gbtn" style="padding:8px 14px;font-size:13px;width:auto" href="/portal/leaderboard">🏆 Leaderboard</a>
        <a class="gbtn" style="padding:8px 14px;font-size:13px;width:auto;background:#1a3040;color:#cfe0dd" href="/portal/logout">Log out</a>
      </div>
    </div>
    ${space ? `
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:24px">
        ${stat("XP", space.identity.xp)}${stat("Streak", space.identity.streak+"d")}${stat("Tier", space.identity.tier)}
      </div>
      ${space.bestTime ? card("Best time to study", `${space.bestTime.time} — ${space.bestTime.share}% of sessions`) : ""}
      ${space.skills?.strong?.length ? card("Your strengths", space.skills.strong.map(s=>s.skill).join(" · ")) : ""}
      ${space.skills?.focus?.length ? card("Keep an eye on", space.skills.focus.map(s=>s.skill).join(" · ")) : ""}
      ${space.next?.text ? card("What's next", space.next.text) : ""}
      <div class="card" style="background:#10283a;border-color:#1e4650;margin-top:14px"><div style="font-weight:700;margin-bottom:10px">💭 ARIA's notes for you</div>
        ${space.ariaNotes?.length ? space.ariaNotes.slice(0,5).map(n=>`<div style="padding:8px 0;border-bottom:1px solid #1a3a44;font-size:13px;color:#cfe0dd">${n.text}</div>`).join("") : '<div style="color:#8fb3b0;font-size:13px">Start a lesson in WhatsApp with <b>!academy</b> and ARIA will start building your space.</div>'}
      </div>
    ` : `<div class="card" style="margin-top:20px"><div class="empty">No learning data yet. Reply <b>!academy</b> in WhatsApp to start.</div></div>`}
  </div>
  `;
  res.send(PAGE("My Learner Space", body));
});

// ── Competition leaderboard ─────────────────────────────────────
router.get("/leaderboard", portalAuth, (req, res) => {
  let rows = [];
  try {
    const lm = require("./academy/learnerModel");
    const all = lm.getAllLearners ? lm.getAllLearners() : [];
    rows = (all || [])
      .map((u) => {
        const stats = u.stats || u || {};
        const acct = Object.values(accounts).find((a) => a.id === u.uid) || {};
        return { uid: u.uid, name: acct.name || u.profile?.name || u.uid.slice(0, 6), xp: stats.xp || 0, streak: stats.streak || 0 };
      })
      .filter((r) => r.xp > 0)
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 20);
  } catch (_) { rows = []; }
  const medals = ["🥇", "🥈", "🥉"];
  const body = `
  <div class="card" style="max-width:680px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:22px;font-weight:800">🏆 Academy Leaderboard</div>
        <div class="sub">Top learners by XP this season</div>
      </div>
      <a class="gbtn" style="padding:8px 14px;font-size:13px;width:auto" href="/portal">← My Space</a>
    </div>
    ${rows.length ? `<div style="margin-top:20px">
      ${rows.map((r, i) => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:#10283a;border:1px solid #1e4650;margin-bottom:8px">
          <div style="width:30px;text-align:center;font-size:18px">${medals[i] || i + 1}</div>
          <div style="flex:1;font-weight:600">${r.name}${r.uid === req.learner.sub ? ' <span style="color:#2dd4bf;font-size:11px">(you)</span>' : ""}</div>
          <div style="color:#6fe3cf;font-weight:700">${r.xp} XP</div>
          <div style="color:#8fb3b0;font-size:12px">🔥 ${r.streak}d</div>
        </div>`).join("")}
    </div>` : '<div class="card" style="margin-top:20px"><div class="empty">No learners with XP yet. The competition starts when the first lessons are done!</div></div>'}
  </div>`;
  res.send(PAGE("Leaderboard", body));
});

module.exports = { router, portalAuth, verifyToken, accounts };
