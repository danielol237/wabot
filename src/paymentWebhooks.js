const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const billing = require("./core/billing");
const { publish } = require("./core/events");

function providerName(value) {
  return String(value || "").trim().toLowerCase();
}

function eventIdFrom(payload, req) {
  return String(payload?.eventId || payload?.id || payload?.reference || req.headers["x-event-id"] || "").trim().slice(0, 180);
}

router.post("/:provider", (req, res) => {
  const provider = providerName(req.params.provider);
  if (!["mtn", "orange"].includes(provider)) return res.status(404).json({ ok: false, error: "Unsupported payment provider." });
  const secret = process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`];
  if (!secret) return res.status(503).json({ ok: false, error: `${provider} webhook is not configured.` });
  const signature = req.headers["x-signature"] || req.headers["x-webhook-signature"] || req.headers["x-signature-sha256"];
  if (!billing.verifyWebhookSignature(req.rawBody || JSON.stringify(req.body || {}), signature, secret)) return res.status(401).json({ ok: false, error: "Invalid webhook signature." });
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const eventId = eventIdFrom(payload, req);
  if (!eventId) return res.status(400).json({ ok: false, error: "Webhook event id is required." });
  const tenantId = payload.tenantId || payload.metadata?.tenantId || null;
  const stored = billing.recordWebhook({ provider, eventId, tenantId, payload });
  if (!stored.duplicate) {
    publish({ type: "billing.webhook.received", tenantId, actorId: null, aggregateType: "payment_webhook", aggregateId: stored.eventId, source: provider, idempotencyKey: `webhook:${stored.key}`, payload: { provider, eventId } });
  }
  return res.status(200).json({ ok: true, accepted: true, duplicate: stored.duplicate, provider, eventId });
});

module.exports = router;
