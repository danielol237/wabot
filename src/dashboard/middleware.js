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
  if (!auth.hasOwnerAccount() && process.env.DASHBOARD_PASSWORD) {
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === process.env.DASHBOARD_PASSWORD) {
      req.user = { username: "owner", role: "owner" };
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
    return sendSecurityError(res, req, "AUTHENTICATION_REQUIRED");
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

  if (!token || !given || !auth.validateCsrfToken(token, given)) {
    return sendSecurityError(res, req, "CSRF_VALIDATION_FAILED");
  }
  next();
}

module.exports = {
  checkAuth,
  requirePermission,
  csrfGuard
};
