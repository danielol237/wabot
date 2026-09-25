const express = require("express");
const path = require("path");
const auth = require("../utils/dashboardAuth");
const { sendSecurityError } = require("../utils/securityErrors");

const router = express.Router();

function ensureCookies(req) {
  if (req.cookies) return req.cookies;
  const cookies = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(value.join("=") || ""); } catch (_) { cookies[key] = value.join("=") || ""; }
  }
  req.cookies = cookies;
  return cookies;
}

function checkAuth(req, res, next) {
  ensureCookies(req);
  const token = req.cookies?.["aria_session"];

  // Backward-compatibility: Check Authorization header with process.env.DASHBOARD_PASSWORD if account system has no owner yet
  if (process.env.DASHBOARD_PASSWORD) {
    const authHeader = req.headers.authorization || "";
    const legacyCredential = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader.startsWith("Basic ")
        ? (() => {
          try {
            const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
            return decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : "";
          } catch (_) { return ""; }
        })()
        : "";
    if (legacyCredential === process.env.DASHBOARD_PASSWORD) {
      req.user = { username: "owner", role: "owner" };
      req.legacyDashboardAuth = true;
      return next();
    }
  }

  if (token) {
    const session = auth.validateSessionToken(token);
    if (session) {
      req.user = { username: session.username, role: session.role };
      req.session = session;
      return next();
    }
  }

  // Check if API request
  if (req.path.startsWith("/api/") || String(req.headers.accept || "").includes("application/json")) {
    if (String(req.originalUrl || "").startsWith("/api/platform")) {
      return res.status(401).json({ ok: false, error: "Authentication required.", code: "auth_required" });
    }
    return res.status(401).json({ code: "auth_required", error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication is required." } });
  }

  // Redirect browser to setup if no owner account exists, else to login
  if (!auth.hasOwnerAccount()) {
    return res.redirect("/dashboard/setup");
  }
  return res.redirect("/dashboard/login");
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return sendSecurityError(res, req, "AUTHENTICATION_REQUIRED");
    if (!auth.hasPermission(req.user.role, permission)) {
      return sendSecurityError(res, req, "AUTHORIZATION_REQUIRED");
    }
    next();
  };
}

function csrfGuard(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  ensureCookies(req);
  const token = req.cookies?.["aria_session"];
  const given = req.body?._csrf || req.headers["x-csrf-token"] || req.query?._csrf || "";

  const legacyToken = process.env.DASHBOARD_PASSWORD || "";
  const validLegacyCsrf = req.legacyDashboardAuth && legacyToken && auth.validateCsrfToken(legacyToken, given);
  if ((!token && !validLegacyCsrf) || !given || (!validLegacyCsrf && !auth.validateCsrfToken(token, given))) {
    if (req.legacyDashboardAuth) return res.status(403).json({ code: "csrf_invalid", error: { code: "csrf_invalid", message: "CSRF token is invalid." } });
    return sendSecurityError(res, req, "CSRF_VALIDATION_FAILED");
  }
  next();
}

module.exports = {
  checkAuth,
  requirePermission,
  csrfGuard
};
