const crypto = require("crypto");
const path = require("path");
const { createJsonRepository } = require("../storage/jsonRepository");
const identities = require("./index");
const tenants = require("./tenants");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../../data");
const STORE = createJsonRepository(path.join(DATA_DIR, "platformAuth.json"), () => ({ credentials: {}, revokedSessions: {} }));
const SESSION_TTL_MS = 7 * 86400000;
const MAX_REVOKED_SESSIONS = 10000;

function secret() {
  return String(process.env.PLATFORM_SESSION_SECRET || process.env.PORTAL_SESSION_SECRET || "");
}
function clean(value, max = 240) { return String(value == null ? "" : value).trim().slice(0, max); }
function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString("hex") };
}
function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  const computed = Buffer.from(passwordHash(password, record.salt).hash, "hex");
  const expected = Buffer.from(record.hash, "hex");
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}
function b64(value) { return Buffer.from(value).toString("base64url"); }
function unb64(value) { return Buffer.from(value, "base64url").toString("utf8"); }
function sign(value) { return crypto.createHmac("sha256", secret()).update(value).digest("base64url"); }
function pruneRevoked(state, now = Date.now()) {
  state.revokedSessions = state.revokedSessions || {};
  for (const [sid, expiresAt] of Object.entries(state.revokedSessions)) {
    if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) <= now) delete state.revokedSessions[sid];
  }
  const entries = Object.entries(state.revokedSessions);
  if (entries.length > MAX_REVOKED_SESSIONS) {
    entries.sort((a, b) => Number(a[1]) - Number(b[1]));
    for (const [sid] of entries.slice(0, entries.length - MAX_REVOKED_SESSIONS)) delete state.revokedSessions[sid];
  }
}
function issueSession({ userId, tenantId }) {
  if (!secret()) throw new Error("PLATFORM_SESSION_SECRET is not configured");
  const state = STORE.read();
  const version = Number(state.credentials?.[userId]?.sessionVersion || 1);
  const payload = b64(JSON.stringify({ sid: crypto.randomBytes(18).toString("hex"), sub: userId, tid: tenantId, ver: version, exp: Date.now() + SESSION_TTL_MS }));
  return `${payload}.${sign(payload)}`;
}
function verifySession(token) {
  if (!token || !secret()) return null;
  const [payload, signature] = String(token).split(".");
  const expected = payload ? sign(payload) : "";
  if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(unb64(payload));
    if (!parsed.exp || parsed.exp <= Date.now() || !parsed.sid || !parsed.sub || !parsed.tid) return null;
    const state = STORE.read();
    pruneRevoked(state);
    const credential = state.credentials?.[parsed.sub];
    if (state.revokedSessions?.[parsed.sid] || (credential && Number(parsed.ver || 1) !== Number(credential.sessionVersion || 1))) return null;
    return parsed;
  } catch (_) { return null; }
}
function revokeSession(token) {
  if (!token || !secret()) return false;
  const [payload, signature] = String(token).split(".");
  const expected = payload ? sign(payload) : "";
  if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const parsed = JSON.parse(unb64(payload));
    if (!parsed.sid || !parsed.exp) return false;
    const state = STORE.read();
    pruneRevoked(state);
    state.revokedSessions[parsed.sid] = Number(parsed.exp);
    STORE.write(state);
    return true;
  } catch (_) { return false; }
}
function revokeUserSessions(userId) {
  const state = STORE.read();
  state.credentials = state.credentials || {};
  const credential = state.credentials[userId];
  if (!credential) return false;
  credential.sessionVersion = Number(credential.sessionVersion || 1) + 1;
  credential.updatedAt = new Date().toISOString();
  STORE.write(state);
  return true;
}
function csrfToken(sessionToken) { return sessionToken && secret() ? sign(`csrf:${sessionToken}`) : ""; }
function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(rest.join("=") || "");
  }
  return cookies;
}
function sessionContext(session) {
  const user = session?.sub ? identities.getUser(session.sub) : null;
  const tenant = session?.tid ? tenants.getTenant(session.tid) : null;
  const membership = user && tenant ? tenants.getMembership(tenant.id, user.id) : null;
  if (!user || !tenant || !membership || membership.status !== "active") return null;
  return { userId: user.id, tenantId: tenant.id, role: membership.role, source: "platform-session", user, tenant, membership };
}
function register({ email, password, name, tenantName } = {}) {
  const address = clean(email, 180).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new Error("valid email is required");
  if (String(password || "").length < 8) throw new Error("password must be at least 8 characters");
  const state = STORE.read();
  const existing = identities.findByIdentity("email", address);
  if (existing && state.credentials[existing.id]) { const error = new Error("account already exists"); error.code = "ACCOUNT_EXISTS"; throw error; }
  const user = existing || identities.ensureUser({ displayName: name || address.split("@")[0], identity: { provider: "email", value: address } });
  const workspace = tenants.ensureTenant({ name: tenantName || `${user.displayName}'s ARIA Workspace`, ownerUserId: user.id });
  state.credentials[user.id] = { userId: user.id, email: address, ...passwordHash(password), sessionVersion: Number(state.credentials[user.id]?.sessionVersion || 1), createdAt: state.credentials[user.id]?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  STORE.write(state);
  const token = issueSession({ userId: user.id, tenantId: workspace.id });
  return { user, tenant: workspace, token, csrf: csrfToken(token) };
}
function login({ email, password } = {}) {
  const user = identities.findByIdentity("email", clean(email, 180).toLowerCase());
  const state = STORE.read();
  if (!user || !verifyPassword(password, state.credentials[user.id])) { const error = new Error("invalid email or password"); error.code = "INVALID_CREDENTIALS"; throw error; }
  const tenant = tenants.listTenantsForUser(user.id)[0]?.tenant;
  if (!tenant) { const error = new Error("account has no workspace"); error.code = "WORKSPACE_MISSING"; throw error; }
  const token = issueSession({ userId: user.id, tenantId: tenant.id });
  return { user, tenant, token, csrf: csrfToken(token) };
}
function readRequestContext(req) {
  const cookies = parseCookies(req);
  const token = cookies.aria_platform_session || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = verifySession(token);
  const context = sessionContext(session);
  return context ? { context, token, csrf: csrfToken(token) } : null;
}
function middleware(req, res, next) {
  const found = readRequestContext(req);
  if (!found) return res.status(401).json({ ok: false, error: "Platform sign-in required." });
  req.platformContext = found.context;
  req.platformSessionToken = found.token;
  req.platformCsrf = found.csrf;
  next();
}
function csrfOk(req) {
  const found = readRequestContext(req);
  if (!found) return false;
  const supplied = req.headers["x-csrf-token"] || req.body?._csrf || "";
  return !!supplied && supplied === found.csrf;
}
function cookieOptions() {
  return { httpOnly: true, secure: String(process.env.NODE_ENV || "").toLowerCase() === "production", sameSite: "lax", maxAge: SESSION_TTL_MS, path: "/" };
}

module.exports = { STORE, register, login, issueSession, verifySession, revokeSession, revokeUserSessions, csrfToken, readRequestContext, middleware, csrfOk, cookieOptions };
