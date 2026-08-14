// Atlas V3 signed webhook ingress. The route never performs side effects from
// provider payloads; it only hands authenticated events to atlasSentinel.

const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const sentinel = require("./atlasSentinel");
const atlas = require("./atlasStore");

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
  const signature = String(req.get("x-hub-signature-256") || "");
  const body = rawBody(req);
  const delivery = String(req.get("x-github-delivery") || "").trim();
  const userAgent = String(req.get("user-agent") || "");
  if (!secret) return { configured: false, valid: false, reasonCode: "missing_secret", detail: "GITHUB_WEBHOOK_SECRET is not present in the running service." };
  if (!body) return { configured: true, valid: false, reasonCode: "raw_body_unavailable", detail: "The exact signed request body was unavailable." , delivery, signaturePresent: Boolean(signature), rawBodyAvailable: false };
  if (!signature) return { configured: true, valid: false, reasonCode: "missing_signature", detail: "GitHub did not provide X-Hub-Signature-256.", delivery, signaturePresent: false, rawBodyAvailable: true };
  if (!/^GitHub-Hookshot\//i.test(userAgent)) return { configured: true, valid: false, reasonCode: "unexpected_user_agent", detail: "The request did not identify itself as a GitHub webhook delivery.", delivery, signaturePresent: true, rawBodyAvailable: true };
  if (!delivery) return { configured: true, valid: false, reasonCode: "missing_delivery_id", detail: "GitHub did not provide X-GitHub-Delivery.", signaturePresent: true, rawBodyAvailable: true };
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  if (!safeEqual(signature, expected)) return { configured: true, valid: false, reasonCode: "invalid_signature", detail: "The HMAC signature did not match the running service secret.", delivery, signaturePresent: true, rawBodyAvailable: true };
  return { configured: true, valid: true, delivery, signaturePresent: true, rawBodyAvailable: true };
}

function renderAuth(req) {
  const secret = String(process.env.RENDER_WEBHOOK_SECRET || "");
  const id = String(req.get("webhook-id") || "").trim();
  const timestamp = String(req.get("webhook-timestamp") || "").trim();
  const header = String(req.get("webhook-signature") || "");
  const numericTimestamp = Number(timestamp);
  if (!secret) return { configured: false, valid: false, reasonCode: "missing_secret", detail: "RENDER_WEBHOOK_SECRET is not present in the running service.", id };
  if (!id || !timestamp || !Number.isFinite(numericTimestamp)) return { configured: true, valid: false, reasonCode: "missing_timestamp_headers", detail: "Render webhook ID or timestamp headers are missing.", id, signaturePresent: Boolean(header), rawBodyAvailable: Boolean(rawBody(req)) };
  if (Math.abs(Math.floor(Date.now() / 1000) - numericTimestamp) > MAX_SKEW_SECONDS) return { configured: true, valid: false, reasonCode: "stale_timestamp", detail: "Render webhook timestamp is outside the five-minute acceptance window.", id, signaturePresent: Boolean(header), rawBodyAvailable: Boolean(rawBody(req)) };
  const body = rawBody(req);
  if (!body) return { configured: true, valid: false, reasonCode: "raw_body_unavailable", detail: "The exact signed request body was unavailable.", id, signaturePresent: Boolean(header), rawBodyAvailable: false };
  if (!header) return { configured: true, valid: false, reasonCode: "missing_signature", detail: "Render did not provide a webhook signature.", id, signaturePresent: false, rawBodyAvailable: true };
  const signed = `${id}.${timestamp}.${body.toString("utf8")}.${secret}`;
  const expected = "v1," + crypto.createHmac("sha256", secret).update(signed).digest("base64");
  const signatures = header.split(/\s+/).filter(Boolean);
  if (!signatures.some((candidate) => safeEqual(candidate, expected))) return { configured: true, valid: false, reasonCode: "invalid_signature", detail: "The Render signature did not match the running service secret.", id, signaturePresent: true, rawBodyAvailable: true };
  return { configured: true, valid: true, id, signaturePresent: true, rawBodyAvailable: true };
}

router.post("/github", (req, res) => {
  const startedAt = Date.now();
  const auth = githubAuth(req);
  const owner = ownerId();
  const repository = String(req.body?.repository?.full_name || "").trim().toLowerCase();
  const eventName = String(req.get("x-github-event") || "").trim().toLowerCase();
  if (!auth.configured) {
    if (owner) atlas.recordSentinelDeliveryForSource(owner, "github", repository, { deliveryId: auth.delivery, eventName, status: "rejected", reasonCode: auth.reasonCode, httpStatus: 503, signaturePresent: auth.signaturePresent, rawBodyAvailable: auth.rawBodyAvailable, detail: auth.detail, durationMs: Date.now() - startedAt });
    return res.status(503).json({ error: "GitHub Sentinel webhook is not configured", code: auth.reasonCode });
  }
  if (!auth.valid) {
    if (owner) atlas.recordSentinelDeliveryForSource(owner, "github", repository, { deliveryId: auth.delivery, eventName, status: "rejected", reasonCode: auth.reasonCode, httpStatus: 401, signaturePresent: auth.signaturePresent, rawBodyAvailable: auth.rawBodyAvailable, detail: auth.detail, durationMs: Date.now() - startedAt });
    return res.status(401).json({ error: "Invalid GitHub webhook signature", code: auth.reasonCode });
  }
  if (!owner) return res.status(503).json({ error: "Atlas Sentinel owner is not configured", code: "owner_unconfigured" });
  if (!eventName) {
    atlas.recordSentinelDeliveryForSource(owner, "github", repository, { deliveryId: auth.delivery, eventName: "unknown", status: "rejected", reasonCode: "missing_event_header", httpStatus: 400, signaturePresent: true, rawBodyAvailable: true, detail: "GitHub event header is missing.", durationMs: Date.now() - startedAt });
    return res.status(400).json({ error: "Missing GitHub event header", code: "missing_event_header" });
  }
  try {
    const result = sentinel.ingestGithub(owner, req.body, eventName, auth.delivery, { notify: true });
    const delivery = atlas.recordSentinelDeliveryForSource(owner, "github", repository, { deliveryId: auth.delivery, eventName, status: result.status === "duplicate" ? "duplicate" : result.status === "accepted" ? "accepted" : "ignored", reasonCode: result.status === "accepted" ? "delivery_accepted" : result.status === "duplicate" ? "duplicate_delivery" : "workspace_unmapped", httpStatus: 202, signaturePresent: true, rawBodyAvailable: true, detail: result.reason || "Verified GitHub delivery processed.", durationMs: Date.now() - startedAt });
    return res.status(202).json({ ok: true, ...result, diagnostics: delivery ? { health: delivery.health, reasonCode: delivery.delivery.reasonCode } : null });
  } catch (error) {
    console.error("[atlas-github-webhook]", error.message);
    if (owner) atlas.recordSentinelDeliveryForSource(owner, "github", repository, { deliveryId: auth.delivery, eventName, status: "failed", reasonCode: "processing_error", httpStatus: 500, signaturePresent: true, rawBodyAvailable: true, detail: "The verified delivery could not be normalized.", durationMs: Date.now() - startedAt });
    return res.status(500).json({ error: "Could not process GitHub Sentinel event", code: "processing_error" });
  }
});

router.post("/render", (req, res) => {
  const startedAt = Date.now();
  const auth = renderAuth(req);
  const owner = ownerId();
  const serviceId = String(req.body?.data?.serviceId || req.body?.serviceId || "").trim();
  const eventName = String(req.body?.type || "render_event").trim().toLowerCase();
  if (!auth.configured) {
    if (owner) atlas.recordSentinelDeliveryForSource(owner, "render", serviceId, { deliveryId: auth.id, eventName, status: "rejected", reasonCode: auth.reasonCode, httpStatus: 503, signaturePresent: auth.signaturePresent, rawBodyAvailable: auth.rawBodyAvailable, detail: auth.detail, durationMs: Date.now() - startedAt });
    return res.status(503).json({ error: "Render Sentinel webhook is not configured", code: auth.reasonCode });
  }
  if (!auth.valid) {
    if (owner) atlas.recordSentinelDeliveryForSource(owner, "render", serviceId, { deliveryId: auth.id, eventName, status: "rejected", reasonCode: auth.reasonCode, httpStatus: 401, signaturePresent: auth.signaturePresent, rawBodyAvailable: auth.rawBodyAvailable, detail: auth.detail, durationMs: Date.now() - startedAt });
    return res.status(401).json({ error: "Invalid Render webhook signature", code: auth.reasonCode });
  }
  if (!owner) return res.status(503).json({ error: "Atlas Sentinel owner is not configured", code: "owner_unconfigured" });
  try {
    const result = sentinel.ingestRender(owner, req.body, { notify: true });
    const delivery = atlas.recordSentinelDeliveryForSource(owner, "render", serviceId, { deliveryId: auth.id, eventName, status: result.status === "duplicate" ? "duplicate" : result.status === "accepted" ? "accepted" : "ignored", reasonCode: result.status === "accepted" ? "delivery_accepted" : result.status === "duplicate" ? "duplicate_delivery" : "workspace_unmapped", httpStatus: 202, signaturePresent: true, rawBodyAvailable: true, detail: result.reason || "Verified Render delivery processed.", durationMs: Date.now() - startedAt });
    return res.status(202).json({ ok: true, ...result, diagnostics: delivery ? { health: delivery.health, reasonCode: delivery.delivery.reasonCode } : null });
  } catch (error) {
    console.error("[atlas-render-webhook]", error.message);
    if (owner) atlas.recordSentinelDeliveryForSource(owner, "render", serviceId, { deliveryId: auth.id, eventName, status: "failed", reasonCode: "processing_error", httpStatus: 500, signaturePresent: true, rawBodyAvailable: true, detail: "The verified delivery could not be normalized.", durationMs: Date.now() - startedAt });
    return res.status(500).json({ error: "Could not process Render Sentinel event", code: "processing_error" });
  }
});

function localGithubSelfTest() {
  const secret = String(process.env.GITHUB_WEBHOOK_SECRET || "");
  if (!secret) return { pass: false, reasonCode: "missing_secret", message: "GITHUB_WEBHOOK_SECRET is not present in the running service." };
  const body = Buffer.from(JSON.stringify({ action: "atlas_v4_local_self_test", repository: { full_name: "local/test" } }));
  const delivery = "local-v4-self-test";
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  const req = { rawBody: body, get(name) { return ({ "x-hub-signature-256": signature, "x-github-delivery": delivery, "user-agent": "GitHub-Hookshot/local-self-test" }[String(name).toLowerCase()] || ""); } };
  const auth = githubAuth(req);
  return { pass: auth.valid === true, reasonCode: auth.valid ? "local_verifier_passed" : auth.reasonCode, message: auth.valid ? "The running service can verify its own HMAC/raw-body path. This does not test GitHub delivery or the provider-side secret." : auth.detail };
}

module.exports = router;
module.exports._test = { githubAuth, renderAuth, rawBody, localGithubSelfTest };
