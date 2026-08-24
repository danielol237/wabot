const express = require("express");
const auth = require("./core/identity/auth");
const router = express.Router();
const authAttempts = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 8;
const REGISTER_LIMIT = 5;

function authKeys(req, action) {
  const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 180);
  return [`${action}:ip:${ip}`, `${action}:account:${ip}:${email || "-"}`];
}
function isThrottled(key, limit) {
  const now = Date.now();
  const record = authAttempts.get(key);
  if (!record || now >= record.resetAt) {
    if (record) authAttempts.delete(key);
    return false;
  }
  return record.count >= limit;
}
function anyThrottled(keys, limit) { return keys.some((key) => isThrottled(key, limit)); }
function recordAttempts(keys) {
  const now = Date.now();
  for (const key of keys) {
    const record = authAttempts.get(key);
    if (!record || now >= record.resetAt) authAttempts.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    else { record.count += 1; authAttempts.set(key, record); }
  }
}
function clearAttempts(keys) { for (const key of keys) authAttempts.delete(key); }

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value || "")}`, `Path=${options.path || "/"}`, "SameSite=Lax"];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(Number(options.maxAge) / 1000))}`);
  return parts.join("; ");
}
function setSession(res, result) {
  res.append("Set-Cookie", serializeCookie("aria_platform_session", result.token, auth.cookieOptions()));
  return { user: { id: result.user.id, displayName: result.user.displayName }, tenant: result.tenant, csrf: result.csrf };
}

router.post("/auth/register", (req, res) => {
  const keys = authKeys(req, "register");
  if (anyThrottled(keys, REGISTER_LIMIT)) return res.status(429).json({ ok: false, error: "Too many registration attempts. Try again later." });
  recordAttempts(keys);
  try {
    const result = auth.register(req.body || {});
    clearAttempts(keys);
    return res.status(201).json({ ok: true, ...setSession(res, result) });
  } catch (_) {
    return res.status(400).json({ ok: false, error: "Unable to create account with those details." });
  }
});

router.post("/auth/login", (req, res) => {
  const keys = authKeys(req, "login");
  if (anyThrottled(keys, LOGIN_LIMIT)) return res.status(429).json({ ok: false, error: "Too many login attempts. Try again later." });
  recordAttempts(keys);
  try {
    const result = auth.login(req.body || {});
    clearAttempts(keys);
    return res.json({ ok: true, ...setSession(res, result) });
  } catch (_) {
    return res.status(401).json({ ok: false, error: "Invalid email or password." });
  }
});

router.post("/auth/logout", (req, res) => {
  const found = auth.readRequestContext(req);
  if (found) auth.revokeSession(found.token);
  res.append("Set-Cookie", serializeCookie("aria_platform_session", "", { ...auth.cookieOptions(), maxAge: 0 }));
  return res.json({ ok: true });
});

router.get("/auth/session", auth.middleware, (req, res) => res.json({ ok: true, context: { user: { id: req.platformContext.user.id, displayName: req.platformContext.user.displayName }, tenant: req.platformContext.tenant, role: req.platformContext.role }, csrf: req.platformCsrf }));

module.exports = router;
