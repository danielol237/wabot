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
const linking = require("./portalLinking");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function inlineText(value) {
  return esc(value).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<code>$1</code>");
}
function portalCsrf(req) {
  const session = req.cookies?.aria_portal || "";
  return crypto.createHmac("sha256", SESSION_SECRET || "missing").update(session).digest("hex").slice(0, 32);
}
function portalCsrfOk(req) {
  return !!req.body?._csrf && safeEqual(req.body._csrf, portalCsrf(req));
}
function linkedUid(accountId) {
  return linking.getLinkedUid(accountId) || String(accountId || "");
}
function issuePortalToken(account) {
  return signToken({ sub: account.id, name: account.name, email: account.email, exp: Date.now() + 7 * 86400000 });
}

// Cookie reader (populates req.cookies) — must run before any route uses it.
router.use(express.urlencoded({ extended: false }));
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
// Strip any scheme/URL wrapper that may have been pasted around the values
// (e.g. someone pastes the full URL "https://5090...apps.googleusercontent.com"
// into the Client ID field). Google rejects an invalid_client otherwise.
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").replace(/^https?:\/\//i, "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").replace(/^https?:\/\//i, "").trim();
// An explicit PORTAL_SESSION_SECRET is recommended. If Render already has the
// Google secret configured, derive a stable HMAC key so email signup still works
// while the optional dedicated secret is added.
const SESSION_SECRET = process.env.PORTAL_SESSION_SECRET || process.env.DASHBOARD_CSRF_SECRET || (GOOGLE_CLIENT_SECRET ? crypto.createHash("sha256").update(GOOGLE_CLIENT_SECRET + "|aria-portal-session").digest("hex") : "");
// Public URL of this bot, used for the OAuth redirect URI.
const BASE_URL = String(process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
const OAUTH_COOKIE = "aria_oauth_state";
const AUTH_LIMIT = 12;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const authAttempts = new Map();

function authLimited(req) {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const rec = authAttempts.get(key);
  if (!rec || rec.resetAt <= now) { authAttempts.set(key, { count: 0, resetAt: now + AUTH_WINDOW_MS }); return false; }
  return rec.count >= AUTH_LIMIT;
}
function recordAuthAttempt(req) {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const rec = authAttempts.get(key) || { count: 0, resetAt: Date.now() + AUTH_WINDOW_MS };
  rec.count++;
  authAttempts.set(key, rec);
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

// ── Learner accounts store (JSON file) ──────────────────────────
const STATE_FILE = path.join(__dirname, "../../data/learnerAccounts.json");
let accounts = {}; // key: googleSub | email -> { id, name, email, googleSub, passwordHash, createdAt }

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) accounts = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || {};
  } catch (_) { accounts = {}; }
}
function save() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(accounts), { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE);
    try { fs.chmodSync(STATE_FILE, 0o600); } catch (_) {}
  } catch (_) {}
}
load();

function hashPw(pw, salt = crypto.randomBytes(16).toString("hex")) {
  const digest = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return `${salt}:${digest}`;
}
function verifyPw(pw, stored) {
  const value = String(stored || "");
  if (value.includes(":")) {
    const [salt, expected] = value.split(":");
    try {
      const actual = crypto.scryptSync(String(pw), salt, 32).toString("hex");
      return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
    } catch (_) { return false; }
  }
  // Backward compatibility for accounts created before the salted format.
  const legacy = crypto.createHash("sha256").update(String(pw) + "|aria").digest("hex");
  return value === legacy;
}
function signToken(payload) {
  if (!SESSION_SECRET) throw new Error("PORTAL_SESSION_SECRET is not configured");

  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!SESSION_SECRET) return null;
  try {
    const [body, sig] = String(token || "").split(".");
    const expect = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
    if (!safeEqual(sig, expect)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (_) { return null; }
}

// Auth middleware for portal pages.
function portalAuth(req, res, next) {
  const payload = verifyToken(req.cookies?.aria_portal);
  const account = payload?.sub ? accounts[payload.sub] : null;
  if (!payload || !account) return res.redirect("/portal/login?error=session-invalid");
  req.learner = { ...payload, uid: linkedUid(account.id), linked: !!linking.getLinkedUid(account.id) };
  next();
}

// ── Google OAuth ────────────────────────────────────────────────
router.get("/auth/google", (req, res) => {
  if (authLimited(req)) return res.redirect("/portal/login?error=auth-rate-limited");
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !BASE_URL) return res.redirect("/portal/login?error=google-not-configured");
  const nonce = crypto.randomBytes(24).toString("hex");
  const state = signToken({ r: nonce, exp: Date.now() + 10 * 60 * 1000 });
  res.cookie(OAUTH_COOKIE, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 10 * 60 * 1000, path: "/portal" });
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
  const state = verifyToken(req.query.state);
  const browserNonce = req.cookies?.[OAUTH_COOKIE] || "";
  res.clearCookie(OAUTH_COOKIE, { path: "/portal" });
  if (!state?.r || !safeEqual(state.r, browserNonce)) return res.redirect("/portal/login?error=oauth-state-invalid");
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
    const token = issuePortalToken(learner);
    res.cookie("aria_portal", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 7 * 86400000, path: "/portal" });
    return res.redirect("/portal");
  } catch (e) {
    return res.redirect("/portal/login?error=oauth-failed");
  }
});

// ── Email signup / login ────────────────────────────────────────
router.post("/auth/email", express.json({ limit: "16kb" }), (req, res) => {
  if (authLimited(req)) return res.status(429).json({ error: "Too many sign-in attempts. Try again later." });
  if (!SESSION_SECRET) return res.status(503).json({ error: "Learner sign-in is not configured. Add PORTAL_SESSION_SECRET in Render." });
  const { email, password, name, mode } = req.body || {};
  const clean = String(email || "").toLowerCase().trim();
  if (!clean || !password) return res.status(400).json({ error: "email and password required" });
  if (clean.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return res.status(400).json({ error: "enter a valid email address" });
  if (String(password).length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });
  if (String(password).length > 256) return res.status(400).json({ error: "password is too long" });

  const existing = Object.values(accounts).find((a) => a.email === clean);
  if (mode === "signup") {
    if (existing) { recordAuthAttempt(req); return res.status(409).json({ error: "account already exists — log in" }); }
    const id = "em_" + crypto.randomBytes(6).toString("hex");
    accounts[id] = { id, name: String(name || clean.split("@")[0]).trim().slice(0, 80), email: clean, passwordHash: hashPw(password), createdAt: Date.now() };
    save();
    const learner = accounts[id];
    const token = issuePortalToken(learner);
    res.cookie("aria_portal", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 7 * 86400000, path: "/portal" });
    return res.json({ ok: true });
  }
  // login
  if (!existing) { recordAuthAttempt(req); return res.status(401).json({ error: "no account with that email" }); }
  if (!verifyPw(password, existing.passwordHash)) { recordAuthAttempt(req); return res.status(401).json({ error: "wrong password" }); }
  const token = issuePortalToken(existing);
  res.cookie("aria_portal", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 7 * 86400000, path: "/portal" });
  return res.json({ ok: true });
});

router.post("/link", portalAuth, (req, res) => {
  if (!portalCsrfOk(req)) return res.status(403).send("Invalid or missing form token.");
  const uid = linking.consumeCode(req.body.code, req.learner.sub, req.ip || req.socket?.remoteAddress || "unknown");
  if (!uid) return res.redirect("/portal?error=invalid-link-code");
  linking.linkAccount(req.learner.sub, uid);
  res.redirect("/portal?linked=1");
});

router.get("/logout", (req, res) => {
  res.clearCookie("aria_portal", { path: "/portal" });
  res.redirect("/portal/login?error=logged-out");
});

// ── Portal pages ────────────────────────────────────────────────
const PAGE = (title, body) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ARIA Academy</title>
<style>
:root{--bg:#071018;--panel:#0d1b28;--panel2:#102534;--line:#1e3a4b;--text:#eff8f6;--muted:#9db7b5;--faint:#6b8a87;--accent:#57e0c4;--accent2:#52a8ff;--danger:#ff8d9a;--shadow:0 24px 70px rgba(0,0,0,.28)}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5}a{color:inherit}.auth-shell{min-height:100vh;display:grid;place-items:center;padding:28px}.auth-layout{width:min(920px,100%);display:grid;grid-template-columns:1fr 1.05fr;overflow:hidden;border:1px solid var(--line);border-radius:26px;background:var(--panel);box-shadow:var(--shadow)}.auth-aside{padding:42px;background:#142331}.brand{display:flex;align-items:center;gap:10px;font-weight:850;letter-spacing:-.02em;font-size:18px}.brand-mark{display:block;width:38px;height:38px;object-fit:cover;overflow:hidden;border-radius:12px;background:#0b0d12;box-shadow:0 8px 22px rgba(85,214,190,.14)}.brand-accent{color:var(--accent)}.eyebrow{text-transform:uppercase;letter-spacing:.16em;color:var(--accent);font-size:11px;font-weight:800}.auth-aside h1{font-size:32px;line-height:1.08;letter-spacing:-.04em;margin:54px 0 14px}.auth-aside p{color:var(--muted);max-width:330px}.benefits{display:grid;gap:12px;margin-top:32px}.benefit{display:flex;gap:10px;align-items:flex-start;color:var(--muted);font-size:13px}.benefit b{display:block;color:var(--text);font-size:13px}.auth-form{padding:42px;background:rgba(7,16,24,.36)}.auth-form h2{font-size:26px;letter-spacing:-.03em;margin:28px 0 5px}.sub{color:var(--muted);font-size:14px;margin:0 0 22px}.gbtn,.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;border-radius:12px;padding:12px 16px;font-size:14px;font-weight:750;cursor:pointer;text-decoration:none;transition:transform .15s,border-color .15s,background .15s}.gbtn{width:100%;background:#fff;color:#14202a;border:1px solid #fff}.gbtn:hover,.btn:hover{transform:translateY(-1px)}.gbtn svg{width:19px;height:19px}.or{display:flex;align-items:center;gap:12px;color:var(--faint);font-size:10px;letter-spacing:.13em;margin:22px 0 14px}.or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}.field{display:grid;gap:6px;margin:14px 0}.field label{font-size:12px;color:var(--muted);font-weight:700}.field input,.link-input{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:11px;padding:12px 13px;color:var(--text);font-size:14px;outline:none}.field input:focus,.link-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(87,224,196,.12)}.hint{color:var(--faint);font-size:11px}.btn{border:1px solid transparent;background:linear-gradient(100deg,var(--accent),var(--accent2));color:#06211d;width:100%;margin-top:10px}.foot{color:var(--muted);font-size:13px;text-align:center;margin-top:20px}.foot a{color:var(--accent);font-weight:700;text-decoration:none}.err{background:rgba(255,80,100,.1);border:1px solid rgba(255,141,154,.35);color:#ffc0c7;font-size:13px;padding:11px 12px;border-radius:11px;margin-bottom:15px}.ok{background:rgba(87,224,196,.1);border:1px solid rgba(87,224,196,.3);color:#b8ffed;font-size:13px;padding:11px 12px;border-radius:11px;margin-bottom:15px}.portal-shell{width:min(1080px,100%);margin:0 auto;padding:28px 20px 64px}.portal-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:30px}.portal-top .actions{display:flex;gap:8px;flex-wrap:wrap}.portal-top .btn{width:auto;margin:0;padding:9px 13px;font-size:12px;background:var(--panel);border-color:var(--line);color:var(--text)}.portal-top .btn.primary{background:linear-gradient(100deg,var(--accent),var(--accent2));color:#06211d;border-color:transparent}.portal-title{font-size:clamp(28px,4vw,42px);letter-spacing:-.045em;line-height:1.05;margin:0 0 6px}.portal-sub{color:var(--muted);font-size:14px}.portal-card{background:rgba(13,27,40,.86);border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.16)}.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.metric{padding:18px;border-radius:15px;background:linear-gradient(145deg,var(--panel2),rgba(16,37,52,.55));border:1px solid var(--line)}.metric .value{font-size:27px;font-weight:850;letter-spacing:-.04em;color:var(--accent)}.metric .label{font-size:11px;color:var(--muted);margin-top:3px}.portal-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:14px}.portal-section{margin-top:14px}.section-title{font-size:13px;font-weight:800;margin-bottom:12px}.section-title span{color:var(--accent)}.note{padding:11px 0;border-bottom:1px solid var(--line);color:var(--muted);font-size:13px}.note:last-child{border-bottom:0}.notice{display:flex;gap:12px;align-items:flex-start;padding:15px;border-radius:14px;background:rgba(87,224,196,.08);border:1px solid rgba(87,224,196,.22);color:var(--muted);font-size:13px}.notice strong{display:block;color:var(--text);margin-bottom:3px}.link-card{margin-top:14px}.link-form{display:flex;gap:8px;flex-wrap:wrap}.link-form .link-input{flex:1;min-width:190px}.link-form .btn{width:auto;margin:0}.empty{color:var(--faint);padding:24px;text-align:center;font-size:13px}.leaderboard{display:grid;gap:8px}.leader-row{display:grid;grid-template-columns:38px 1fr auto auto;gap:10px;align-items:center;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}.leader-row .rank{color:var(--accent);font-weight:800}.leader-row .name{font-weight:700}.leader-row .muted{color:var(--muted);font-size:12px}.tag{display:inline-flex;background:rgba(87,224,196,.1);color:var(--accent);border:1px solid rgba(87,224,196,.2);border-radius:99px;padding:4px 10px;font-size:11px;font-weight:700}
@media(max-width:760px){.auth-shell{display:block;padding:0}.auth-layout{display:block;min-height:100vh;border:0;border-radius:0}.auth-aside{padding:20px}.auth-aside h1{font-size:28px;margin:22px 0 10px}.auth-aside p{font-size:13px}.auth-aside .benefits{display:none}.auth-form{padding:22px 20px 36px}.portal-grid{grid-template-columns:1fr}.metric-grid{grid-template-columns:1fr 1fr}.portal-top{align-items:flex-start;flex-direction:column}.portal-top .actions{width:100%}.portal-top .actions .btn{flex:1}.leader-row{grid-template-columns:30px 1fr auto}.leader-row .muted{display:none}}
@media(max-width:430px){.benefits{grid-template-columns:1fr}.metric-grid{grid-template-columns:1fr}.portal-shell{padding:20px 14px 40px}}
</style></head><body>${body}</body></html>`;

function googleSvg() { return `<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98-.66-2.23-1.06-3.71-1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`; }

// ── Login / Signup page (matches the CoreRipper-style screen) ──
router.get("/login", (req, res) => {
  const err = req.query.error || "";
  const errMsg = err === "portal-not-configured" ? "Learner sign-in is not configured. Add PORTAL_SESSION_SECRET in Render, or keep GOOGLE_CLIENT_SECRET set for the secure fallback." :
    err === "google-not-configured" ? "Google sign-in isn't set up yet — create an account with email below, or ask ARIA to enable it." :
    err === "no-code" || err === "oauth-failed" || err === "oauth-state-invalid" ? "Google sign-in didn't complete securely. Please try again." :
    err === "logged-out" ? "You've been logged out." : err === "auth-rate-limited" ? "Too many sign-in attempts. Please wait a few minutes and try again." : "";
  const body = `
  <div class="auth-shell"><div class="auth-layout">
    <section class="auth-aside">
      <div class="brand"><img class="brand-mark" src="/aria-mark.png" alt="" width="38" height="38" /><span>ARIA <span class="brand-accent">Academy</span></span></div>
      <div class="eyebrow" style="margin-top:42px">Learner account</div>
      <h1>A learning space that remembers your progress.</h1>
      <p>Connect the portal to your WhatsApp academy identity and turn every lesson, challenge, and project into a clear next step.</p>
      <div class="benefits">
        <div class="benefit"><span class="tag">01</span><span><b>One progress view</b>XP, streaks, mastery, and recommendations in one place.</span></div>
        <div class="benefit"><span class="tag">02</span><span><b>Private by default</b>Your learner space is protected by your own session.</span></div>
        <div class="benefit"><span class="tag">03</span><span><b>Link when ready</b>Use <b>!portal</b> in WhatsApp to connect existing progress.</span></div>
      </div>
    </section>
    <section class="auth-form">
      <div class="eyebrow">ARIA Academy</div>
      <h2 id="auth-title">Create your account</h2>
      <p class="sub" id="auth-sub">Start with email, then link your WhatsApp learning history.</p>
      ${errMsg ? `<div class="err" role="alert">${esc(errMsg)}</div>` : ""}
      <a class="gbtn" href="/portal/auth/google" aria-label="Continue with Google">${googleSvg()} Continue with Google</a>
      <div class="or">OR USE EMAIL</div>
      <div id="emsg" role="status" aria-live="polite"></div>
      <div class="field" id="name-field"><label for="nm">Name</label><input id="nm" name="name" autocomplete="name" placeholder="Alex"></div>
      <div class="field"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" required><div class="hint">Use at least 8 characters.</div></div>
      <button id="submitBtn" class="btn" type="button" onclick="submitEmail()">Create account</button>
      <div class="foot"><span id="toggle-copy">Already have an account?</span> <a id="toggle-link" href="#" onclick="toggleMode();return false">Log in</a></div>
    </section>
  </div></div>
  <script>
    let mode='signup';
    const nameField=document.getElementById('name-field'), nameInput=document.getElementById('nm'), titleEl=document.getElementById('auth-title'), subEl=document.getElementById('auth-sub'), buttonEl=document.getElementById('submitBtn'), toggleCopy=document.getElementById('toggle-copy'), toggleLink=document.getElementById('toggle-link'), msgEl=document.getElementById('emsg');
    function showError(text){msgEl.className='err';msgEl.textContent=text;}
    function toggleMode(){mode=mode==='signup'?'login':'signup';const signup=mode==='signup';nameField.style.display=signup?'grid':'none';nameInput.disabled=!signup;nameInput.required=signup;titleEl.textContent=signup?'Create your account':'Welcome back';subEl.textContent=signup?'Start with email, then link your WhatsApp learning history.':'Continue where you left off in your learner space.';buttonEl.textContent=signup?'Create account':'Log in';toggleCopy.textContent=signup?'Already have an account?':'New to ARIA Academy?';toggleLink.textContent=signup?'Log in':'Create an account';msgEl.textContent='';msgEl.className='';}
    async function submitEmail(){const email=document.getElementById('em').value.trim();const password=document.getElementById('pw').value;if(!email||!password){showError('Enter your email and password.');return;}if(password.length<8){showError('Your password must be at least 8 characters.');return;}buttonEl.disabled=true;buttonEl.textContent=mode==='signup'?'Creating…':'Signing in…';try{const r=await fetch('/portal/auth/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,name:nameInput.value.trim(),mode})});const j=await r.json().catch(()=>({error:'The server returned an invalid response.'}));if(r.ok){location.href='/portal';return;}showError(j.error||'Unable to complete this request.');}catch(e){showError('Network error. Check your connection and try again.');}finally{buttonEl.disabled=false;buttonEl.textContent=mode==='signup'?'Create account':'Log in';}}
  </script>`;
  res.send(PAGE("Create your account", body));
});

// ── Learner home — their OWN Learner Space ──────────────────────
router.get("/", portalAuth, (req, res) => {
  let space = null;
  try {
    const ls = require("./academy/learnerSpace");
    space = ls.buildLearnerSpace(req.learner.uid);
  } catch (_) {}
  const name = String(req.learner.name || space?.identity?.name || "Learner").trim() || "Learner";
  const stats = space?.identity || { xp: 0, streak: 0, tier: "beginner" };
  const sessions = space?.engagement?.totalSessions || 0;
  const notes = space?.ariaNotes || [];
  const linkedNotice = req.query.linked === "1" ? `<div class="ok" role="status">Your WhatsApp academy progress is now connected to this learner space.</div>` : "";
  const linkError = req.query.error === "invalid-link-code" ? `<div class="err" role="alert">That link code is invalid or expired. Send <code>!portal</code> in WhatsApp to create a new one.</div>` : "";
  const linkPanel = req.learner.linked ? `<div class="notice"><span class="tag">Linked</span><div><strong>WhatsApp progress connected</strong>Your XP, lessons, streaks, and ARIA notes are sourced from learner ID <code>${esc(req.learner.uid)}</code>.</div></div>` : `
    <div class="portal-card link-card"><div class="section-title">Connect your WhatsApp progress <span>recommended</span></div><p class="portal-sub">Open WhatsApp, send <code>!portal</code> to ARIA, then paste the one-time code here. This keeps your account separate while connecting your existing academy history.</p><form class="link-form" method="post" action="/portal/link"><input type="hidden" name="_csrf" value="${portalCsrf(req)}"><input class="link-input" name="code" inputmode="text" autocomplete="one-time-code" placeholder="e.g. 4F8A2C19D7B6C0EF" maxlength="16" required><button class="btn" type="submit">Link progress</button></form></div>`;
  const card = (title, content) => `<section class="portal-card portal-section"><div class="section-title">${esc(title)}</div>${content}</section>`;
  const notesHtml = notes.length ? notes.slice(0, 6).map((n) => `<div class="note">${inlineText(n.text)}<div class="hint">${esc(new Date(n.ts).toLocaleDateString())}</div></div>`).join("") : `<div class="empty">No notes yet. ARIA will add observations as you study.</div>`;
  const strengths = space?.skills?.strong?.length ? space.skills.strong.map((s) => `<span class="tag">${esc(s.skill)} · ${Math.round(s.confidence)}%</span>`).join(" ") : `<div class="empty">Your strengths appear after a few attempts.</div>`;
  const focus = space?.skills?.focus?.length ? space.skills.focus.map((s) => `<span class="tag">${esc(s.skill)} · ${Math.round(s.confidence)}%</span>`).join(" ") : `<div class="empty">No focus areas yet.</div>`;
  const next = space?.next?.text ? inlineText(space.next.text) : "Start with your first academy track.";
  const body = `<div class="portal-shell">
    <header class="portal-top"><div><div class="brand"><img class="brand-mark" src="/aria-mark.png" alt="" width="38" height="38" /><span>ARIA <span class="brand-accent">Academy</span></span></div><div class="eyebrow" style="margin-top:24px">Learner space</div><h1 class="portal-title">Welcome, ${esc(name)}.</h1><p class="portal-sub">A private view of your learning rhythm, evidence, and next move.</p></div><div class="actions"><a class="btn primary" href="/portal/leaderboard">Leaderboard</a><a class="btn" href="/portal/logout">Log out</a></div></header>
    ${linkedNotice}${linkError}${linkPanel}
    <div class="metric-grid"><div class="metric"><div class="value">${Number(stats.xp) || 0}</div><div class="label">XP earned</div></div><div class="metric"><div class="value">${Number(stats.streak) || 0}d</div><div class="label">Current streak</div></div><div class="metric"><div class="value">${Number(sessions) || 0}</div><div class="label">Study attempts</div></div></div>
    <div class="portal-grid">
      <div>${card("What’s next", `<div class="notice"><div><strong>${req.learner.linked ? "A recommendation based on your activity" : "Start with a connected learner profile"}</strong>${next}</div></div>`)}${card("ARIA’s notes", notesHtml)}</div>
      <div>${card("Strengths", strengths)}${card("Needs focus", focus)}${card("How you learn", `<div class="note"><b>Pace</b><br>${esc(space?.pace?.label || "New")}${space?.pace?.detail ? ` — ${esc(space.pace.detail)}` : ""}</div><div class="note"><b>Best study time</b><br>${esc(space?.bestTime?.time || "Not enough data yet")}</div>`)}</div>
    </div>
  </div>`;
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
  const body = `<div class="portal-shell">
    <header class="portal-top"><div><div class="eyebrow">Community progress</div><h1 class="portal-title">Academy leaderboard</h1><p class="portal-sub">A lightweight view of learners who have started building momentum.</p></div><div class="actions"><a class="btn primary" href="/portal">My learner space</a><a class="btn" href="/portal/logout">Log out</a></div></header>
    <section class="portal-card">${rows.length ? `<div class="leaderboard">${rows.map((r, i) => `<div class="leader-row"><div class="rank">${i + 1}</div><div class="name">${esc(r.name)}${r.uid === req.learner.uid ? ' <span class="tag">you</span>' : ""}</div><div class="muted">${Number(r.streak) || 0}d streak</div><strong>${Number(r.xp) || 0} XP</strong></div>`).join("")}</div>` : `<div class="empty">No learners have earned XP yet. Start with <code>!academy</code> in WhatsApp, then return here to see progress appear.</div>`}</section>
  </div>`;
  res.send(PAGE("Leaderboard", body));
});

module.exports = { router, portalAuth, verifyToken, accounts };
