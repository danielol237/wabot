// Atlas V3 signed webhook ingress. The route never performs side effects from
// provider payloads; it only hands authenticated events to atlasSentinel.

const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const sentinel = require("./atlasSentinel");

const MAX_SKEW_SECONDS = 5 * 60;

function ownerId() {
  const value = String(process.env.OWNER_NUMBER || "").trim();
  return value ? (value.includes("@") ? value : value + "@s.whatsapp.net") : "";
}

function rawBody(req) {
  return Buffer.isBuffer(req.rawBody) ? req.rawBody : null;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function githubAuth(req) {
  const secret = String(process.env.GITHUB_WEBHOOK_SECRET || "");
  if (!secret) return { configured: false };
  const signature = String(req.get("x-hub-signature-256") || "");
  const body = rawBody(req);
  if (!body) return { configured: true, valid: false };
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  const userAgent = String(req.get("user-agent") || "");
  const delivery = String(req.get("x-github-delivery") || "").trim();
  if (!/^GitHub-Hookshot\//i.test(userAgent) || !delivery || !safeEqual(signature, expected)) return { configured: true, valid: false };
  return { configured: true, valid: true, delivery };
}

function renderAuth(req) {
  const secret = String(process.env.RENDER_WEBHOOK_SECRET || "");
  if (!secret) return { configured: false };
  const id = String(req.get("webhook-id") || "").trim();
  const timestamp = String(req.get("webhook-timestamp") || "").trim();
  const header = String(req.get("webhook-signature") || "");
  const numericTimestamp = Number(timestamp);
  if (!id || !timestamp || !Number.isFinite(numericTimestamp) || Math.abs(Math.floor(Date.now() / 1000) - numericTimestamp) > MAX_SKEW_SECONDS) return { configured: true, valid: false };
  const body = rawBody(req);
  if (!body) return { configured: true, valid: false };
  const signed = `${id}.${timestamp}.${body.toString("utf8")}.${secret}`;
  const expected = "v1," + crypto.createHmac("sha256", secret).update(signed).digest("base64");
  const signatures = header.split(/\s+/).filter(Boolean);
  if (!signatures.some((candidate) => safeEqual(candidate, expected))) return { configured: true, valid: false };
  return { configured: true, valid: true, id };
}

router.post("/github", (req, res) => {
  const auth = githubAuth(req);
  if (!auth.configured) return res.status(503).json({ error: "GitHub Sentinel webhook is not configured" });
  if (!auth.valid) return res.status(401).json({ error: "Invalid GitHub webhook signature" });
  if (!ownerId()) return res.status(503).json({ error: "Atlas Sentinel owner is not configured" });
  const eventName = String(req.get("x-github-event") || "").trim().toLowerCase();
  if (!eventName) return res.status(400).json({ error: "Missing GitHub event header" });
  try {
    const result = sentinel.ingestGithub(ownerId(), req.body, eventName, auth.delivery, { notify: true });
    return res.status(202).json({ ok: true, ...result });
  } catch (error) {
    console.error("[atlas-github-webhook]", error.message);
    return res.status(500).json({ error: "Could not process GitHub Sentinel event" });
  }
});

router.post("/render", (req, res) => {
  const auth = renderAuth(req);
  if (!auth.configured) return res.status(503).json({ error: "Render Sentinel webhook is not configured" });
  if (!auth.valid) return res.status(401).json({ error: "Invalid Render webhook signature" });
  if (!ownerId()) return res.status(503).json({ error: "Atlas Sentinel owner is not configured" });
  try {
    const result = sentinel.ingestRender(ownerId(), req.body, { notify: true });
    return res.status(202).json({ ok: true, ...result });
  } catch (error) {
    console.error("[atlas-render-webhook]", error.message);
    return res.status(500).json({ error: "Could not process Render Sentinel event" });
  }
});

module.exports = router;
module.exports._test = { githubAuth, renderAuth, rawBody };
