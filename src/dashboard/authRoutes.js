const express = require("express");
const auth = require("../utils/dashboardAuth");
const { sendSecurityError } = require("../utils/securityErrors");
const { checkAuth, csrfGuard } = require("./middleware");

const router = express.Router();

// Public: GET /dashboard/setup - render setup page
router.get("/setup", (req, res, next) => {
  if (auth.hasOwnerAccount()) {
    return res.redirect("/dashboard/login");
  }
  next();
});

// Public: POST /api/auth/setup - create first owner account
router.post("/api/auth/setup", async (req, res) => {
  if (auth.hasOwnerAccount()) {
    return sendSecurityError(res, req, "SECURITY_POLICY_VIOLATION", "Owner account already setup.");
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Username and password are required." } });
  }

  try {
    const account = await auth.createAccount(username, password, "owner");
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const userAgent = req.headers["user-agent"] || "";
    const sessionRes = auth.createSession(account.username, account.role, { ip, userAgent });

    res.cookie("aria_session", sessionRes.rawToken, {
      httpOnly: true,
      maxAge: sessionRes.ttlMs,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    return res.json({
      ok: true,
      user: {
        username: account.username,
        role: account.role
      },
      csrfToken: auth.generateCsrfToken(sessionRes.rawToken)
    });
  } catch (err) {
    return res.status(400).json({ error: { code: "SETUP_FAILED", message: err.message } });
  }
});

// Public: GET /dashboard/login - render login page
router.get("/login", (req, res, next) => {
  if (!auth.hasOwnerAccount()) {
    return res.redirect("/dashboard/setup");
  }
  next();
});

// Public: POST /api/auth/login - authenticate user
router.post("/api/auth/login", async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const { username, password, rememberMe } = req.body || {};

  const throttle = auth.checkLoginThrottled(ip, username);
  if (throttle.throttled) {
    return sendSecurityError(res, req, "ACCOUNT_LOCKED", `Too many failed attempts. Try again in ${throttle.secondsLeft} seconds.`);
  }

  if (!username || !password) {
    auth.recordLoginFailure(ip, username);
    return sendSecurityError(res, req, "INVALID_CREDENTIALS");
  }

  try {
    const verified = await auth.verifyCredentials(username, password);
    if (!verified) {
      auth.recordLoginFailure(ip, username);
      return sendSecurityError(res, req, "INVALID_CREDENTIALS");
    }

    auth.clearLoginFailures(ip, username);
    const userAgent = req.headers["user-agent"] || "";
    const sessionRes = auth.createSession(verified.username, verified.role, { ip, userAgent, rememberMe: !!rememberMe });

    res.cookie("aria_session", sessionRes.rawToken, {
      httpOnly: true,
      maxAge: sessionRes.ttlMs,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });

    return res.json({
      ok: true,
      user: verified,
      csrfToken: auth.generateCsrfToken(sessionRes.rawToken)
    });
  } catch (err) {
    return sendSecurityError(res, req, "SECURITY_SERVICE_UNAVAILABLE", err.message);
  }
});

// Protected session endpoints
router.get("/api/auth/session", checkAuth, (req, res) => {
  const token = req.cookies?.["aria_session"];
  const csrfToken = auth.generateCsrfToken(token);
  return res.json({
    authenticated: true,
    user: {
      username: req.user.username,
      role: req.user.role
    },
    permissions: auth.getPermissionsForRole(req.user.role),
    expiresAt: req.session ? new Date(req.session.expiresAt).toISOString() : null,
    csrfToken
  });
});

router.post("/api/auth/logout", checkAuth, csrfGuard, (req, res) => {
  const token = req.cookies?.["aria_session"];
  if (token) {
    auth.revokeSessionByToken(token);
  }
  res.clearCookie("aria_session");
  if (req.path.startsWith("/api/")) {
    return res.json({ ok: true });
  }
  return res.redirect("/dashboard/login");
});

router.get("/api/auth/sessions", checkAuth, (req, res) => {
  const list = auth.listActiveSessionsForUser(req.user.username);
  return res.json({ sessions: list });
});

router.post("/api/auth/sessions/:id/revoke", checkAuth, csrfGuard, (req, res) => {
  const idHash = req.params.id;
  const revoked = auth.revokeSessionByHash(idHash);
  if (!revoked) {
    return res.status(404).json({ error: { code: "SESSION_NOT_FOUND", message: "Session not found or already revoked." } });
  }
  return res.json({ ok: true, revokedIdHash: idHash });
});

module.exports = router;
