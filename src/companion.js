const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const { getAIResponse } = require("./tools/ai");
const platform = require("./core");
const { ownerContext, recordProductActivity } = require("./core/productBridge");
const {
  issueCompanionSession,
  verifyCompanionSession,
  verifySupabaseAccessToken,
  supabaseConfig,
  syncRow,
  SESSION_TTL_MS,
} = require("./companionSupabase");

const attempts = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 20;

function clean(value, max = 4000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function sameSecret(received, expected) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.replace(/^Bearer\s+/i, "").trim();
}

function legacyAuthorized(req) {
  const expected = String(process.env.COMPANION_API_KEY || "");
  if (!expected) return false;
  return sameSecret(req.headers["x-companion-key"] || bearerToken(req), expected);
}

function limited(req) {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const previous = attempts.get(key);
  if (!previous || now >= previous.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  previous.count += 1;
  return previous.count > MAX_REQUESTS;
}

function companionWorkspaceName(user) {
  const suffix = clean(user.email || user.id, 80).replace(/[^a-zA-Z0-9._@+-]/g, "-");
  return `ARIA Companion · ${suffix}`;
}

async function exchangeSupabase(req) {
  const accessToken = bearerToken(req);
  const user = await verifySupabaseAccessToken(accessToken);
  const identity = platform.identity.ensureUser({
    displayName: user.displayName,
    identity: { provider: "supabase", value: user.id },
    metadata: { email: user.email, source: "android-companion" },
  });
  if (user.email) platform.identity.addIdentity(identity.id, "email", user.email);
  const tenant = platform.tenants.ensureTenant({ name: companionWorkspaceName(user), ownerUserId: identity.id });
  const context = platform.contextFor({ userId: identity.id, tenantId: tenant.id, source: "android-companion" });
  const deviceId = clean(req.body?.deviceId, 160) || `android_${crypto.randomBytes(8).toString("hex")}`;
  const token = issueCompanionSession({ userId: identity.id, tenantId: tenant.id, supabaseSubject: user.id, email: user.email });
  const now = new Date().toISOString();
  await syncRow("companion_devices", {
    device_id: deviceId,
    supabase_user_id: user.id,
    aria_user_id: identity.id,
    tenant_id: tenant.id,
    platform: "android",
    last_seen_at: now,
    metadata: { displayName: user.displayName },
  });
  try {
    recordProductActivity({
      product: "companion",
      action: "session.exchanged",
      context,
      aggregateType: "device",
      aggregateId: deviceId,
      metadata: { supabaseSubject: user.id },
      usage: { category: "companion", metric: "sessions", units: 1 },
      idempotencyKey: `companion-session:${user.id}:${deviceId}:${Math.floor(Date.now() / SESSION_TTL_MS)}`,
    });
  } catch (_) {}
  return {
    token,
    expiresAt: Date.now() + SESSION_TTL_MS,
    deviceId,
    user: { id: identity.id, email: user.email, displayName: identity.displayName },
    tenant: { id: tenant.id, name: tenant.name },
  };
}

async function resolveChatAuth(req) {
  const token = bearerToken(req);
  const claims = verifyCompanionSession(token);
  if (claims) {
    const context = platform.contextFor({ userId: claims.sub, tenantId: claims.tid, source: "android-companion" });
    if (!context) return null;
    return { context, supabaseSubject: claims.sid, authType: "supabase" };
  }
  if (legacyAuthorized(req)) {
    const context = ownerContext("android-companion-legacy");
    return context ? { context, supabaseSubject: null, authType: "legacy" } : null;
  }
  return null;
}

router.post("/session", async (req, res) => {
  if (limited(req)) return res.status(429).json({ ok: false, error: "Too many companion authentication requests. Try again shortly." });
  const config = supabaseConfig();
  if (!config.configured || !process.env.COMPANION_SESSION_SECRET) {
    return res.status(503).json({ ok: false, error: "Supabase Companion authentication is not configured." });
  }
  try {
    const result = await exchangeSupabase(req);
    return res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.code === "SUPABASE_TOKEN_INVALID" || err.code === "SUPABASE_TOKEN_MISSING" ? 401 : 502;
    return res.status(status).json({ ok: false, error: err.message || "Companion authentication failed." });
  }
});

router.post("/chat", async (req, res) => {
  const configured = supabaseConfig().configured && !!process.env.COMPANION_SESSION_SECRET;
  if (!configured && !process.env.COMPANION_API_KEY) return res.status(503).json({ ok: false, error: "Companion API is not configured." });
  const auth = await resolveChatAuth(req);
  if (!auth) return res.status(401).json({ ok: false, error: configured ? "Companion session exchange required." : "Invalid companion credentials." });
  if (limited(req)) return res.status(429).json({ ok: false, error: "Too many companion requests. Try again shortly." });
  const message = clean(req.body?.message);
  if (!message) return res.status(400).json({ ok: false, error: "message is required" });
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-12).map((item) => ({ role: item?.role === "assistant" ? "assistant" : "user", content: clean(item?.content, 2000) })).filter((item) => item.content) : [];
  const conversationId = clean(req.body?.conversationId, 120) || `companion_${crypto.randomBytes(8).toString("hex")}`;
  try {
    const answer = await getAIResponse(
      message,
      auth.context.user?.displayName || "Companion user",
      history,
      null,
      "The user is speaking through ARIA Android Companion. Keep the response concise, useful, and genuinely ARIA-like. Do not claim biological consciousness or abilities unavailable to this server.",
      { conversationId, source: "android-companion", platformContext: auth.context },
    );
    try {
      recordProductActivity({
        product: "companion",
        action: "chat.completed",
        context: auth.context,
        aggregateType: "conversation",
        aggregateId: conversationId,
        metadata: { authType: auth.authType },
        usage: { category: "ai", metric: "companion-messages", units: 1 },
      });
    } catch (_) {}
    const text = String(answer || "I’m here, but I couldn’t form a reply just now.").slice(0, 12000);
    const syncBase = { conversation_id: conversationId, supabase_user_id: auth.supabaseSubject, aria_user_id: auth.context.userId, tenant_id: auth.context.tenantId };
    await syncRow("companion_messages", { ...syncBase, message_id: crypto.createHash("sha256").update(`${conversationId}:user:${message}`).digest("hex"), role: "user", content: message, created_at: new Date().toISOString() });
    await syncRow("companion_messages", { ...syncBase, message_id: crypto.createHash("sha256").update(`${conversationId}:assistant:${text}`).digest("hex"), role: "assistant", content: text, created_at: new Date().toISOString() });
    return res.json({ ok: true, conversationId, text, auth: auth.authType });
  } catch (err) {
    return res.status(502).json({ ok: false, conversationId, error: "ARIA could not complete that companion request." });
  }
});

module.exports = router;
