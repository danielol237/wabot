const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { getAIResponse } = require("./tools/ai");
const platform = require("./core");

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

function authorized(req) {
  const expected = String(process.env.COMPANION_API_KEY || "");
  if (!expected) return false;
  const header = String(req.headers.authorization || "");
  const bearer = header.replace(/^Bearer\s+/i, "");
  return sameSecret(req.headers["x-companion-key"] || bearer, expected);
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

router.post("/chat", async (req, res) => {
  if (!process.env.COMPANION_API_KEY) return res.status(503).json({ ok: false, error: "Companion API is not configured." });
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Invalid companion credentials." });
  if (limited(req)) return res.status(429).json({ ok: false, error: "Too many companion requests. Try again shortly." });
  const message = clean(req.body?.message);
  if (!message) return res.status(400).json({ ok: false, error: "message is required" });
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-12).map((item) => ({ role: item?.role === "assistant" ? "assistant" : "user", content: clean(item?.content, 2000) })).filter((item) => item.content) : [];
  const conversationId = clean(req.body?.conversationId, 120) || `companion_${crypto.randomBytes(8).toString("hex")}`;
  try {
    const answer = await getAIResponse(message, "Daniel", history, null, "The user is speaking through ARIA Android Companion. Keep the response concise, useful, and genuinely ARIA-like. Do not claim biological consciousness or abilities unavailable to this server.", { conversationId, source: "android-companion" });
    try {
      const workspace = platform.bootstrapOwnerWorkspace();
      if (workspace) platform.usage.record({ tenantId: workspace.tenant.id, actorId: workspace.user.id, category: "ai", metric: "messages", units: 1, metadata: { source: "android-companion", conversationId } });
    } catch (_) {}
    return res.json({ ok: true, conversationId, text: String(answer || "I’m here, but I couldn’t form a reply just now.").slice(0, 12000) });
  } catch (err) {
    return res.status(502).json({ ok: false, conversationId, error: "ARIA could not complete that companion request." });
  }
});

module.exports = router;
