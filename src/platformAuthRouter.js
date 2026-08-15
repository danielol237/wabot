const express = require("express");
const auth = require("./core/identity/auth");
const router = express.Router();

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
  try { return res.status(201).json({ ok: true, ...setSession(res, auth.register(req.body || {})) }); }
  catch (err) { return res.status(err.code === "ACCOUNT_EXISTS" ? 409 : 400).json({ ok: false, error: String(err.message || "Registration failed") }); }
});

router.post("/auth/login", (req, res) => {
  try { return res.json({ ok: true, ...setSession(res, auth.login(req.body || {})) }); }
  catch (err) { return res.status(401).json({ ok: false, error: String(err.message || "Login failed") }); }
});

router.post("/auth/logout", (req, res) => {
  res.append("Set-Cookie", serializeCookie("aria_platform_session", "", { path: "/", maxAge: 0 }));
  return res.json({ ok: true });
});

router.get("/auth/session", auth.middleware, (req, res) => res.json({ ok: true, context: { user: { id: req.platformContext.user.id, displayName: req.platformContext.user.displayName }, tenant: req.platformContext.tenant, role: req.platformContext.role }, csrf: req.platformCsrf }));

module.exports = router;
