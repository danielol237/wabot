const crypto = require("crypto");
const path = require("path");
const { createJsonRepository } = require("../storage/jsonRepository");
const { publish } = require("../events");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../../data");
const STORE = createJsonRepository(path.join(DATA_DIR, "platformPayments.json"), () => ({ intents: {}, webhookEvents: {} }));
const LIVE_ENABLED = String(process.env.ARIA_LIVE_PAYMENTS || "false").toLowerCase() === "true";

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function createPaymentIntent({ tenantId, subscriptionId = null, amount, currency = "XAF", provider = "manual", actorId = null, description = "ARIA subscription" } = {}) {
  if (!tenantId) throw new Error("tenantId is required");
  const numericAmount = Math.max(0, Number(amount) || 0);
  if (!numericAmount) throw new Error("amount must be greater than zero");
  const normalizedProvider = String(provider || "manual").toLowerCase();
  const intent = {
    id: id("pay"),
    tenantId: String(tenantId),
    subscriptionId: subscriptionId ? String(subscriptionId) : null,
    provider: normalizedProvider,
    amount: numericAmount,
    currency: String(currency || "XAF").toUpperCase(),
    description: String(description || "ARIA subscription").slice(0, 240),
    status: "pending",
    liveEnabled: LIVE_ENABLED,
    externalId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  };
  const state = STORE.read();
  state.intents[intent.id] = intent;
  STORE.write(state);
  publish({ type: "billing.payment.created", tenantId: intent.tenantId, actorId, aggregateType: "payment", aggregateId: intent.id, payload: { provider: intent.provider, amount: intent.amount, currency: intent.currency, status: intent.status, liveEnabled: intent.liveEnabled } });
  return { ...intent };
}

function getPaymentIntent(intentId) {
  const item = STORE.read().intents[intentId];
  return item ? { ...item } : null;
}

function transitionPayment(intentId, status, { actorId = null, externalId = null, metadata = {} } = {}) {
  const state = STORE.read();
  const item = state.intents[intentId];
  if (!item) throw new Error("payment intent not found");
  const next = String(status || "").toLowerCase();
  if (!["pending", "requires_action", "succeeded", "failed", "cancelled", "refunded"].includes(next)) throw new Error("invalid payment status");
  if (["succeeded", "refunded"].includes(next) && !LIVE_ENABLED && item.provider !== "manual") {
    const error = new Error("live payment transitions are disabled");
    error.code = "LIVE_PAYMENTS_DISABLED";
    throw error;
  }
  item.status = next;
  item.externalId = externalId ? String(externalId) : item.externalId;
  item.metadata = { ...(item.metadata || {}), ...(metadata || {}) };
  item.updatedAt = new Date().toISOString();
  STORE.write(state);
  publish({ type: `billing.payment.${next}`, tenantId: item.tenantId, actorId, aggregateType: "payment", aggregateId: item.id, payload: { provider: item.provider, amount: item.amount, currency: item.currency, externalId: item.externalId, metadata: item.metadata } });
  return { ...item };
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""))).digest("hex");
  const received = String(signature).replace(/^sha256=/i, "").trim();
  return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function recordWebhook({ provider, eventId, payload, tenantId = null }) {
  if (!provider || !eventId) throw new Error("provider and eventId are required");
  const state = STORE.read();
  const key = `${String(provider).toLowerCase()}:${String(eventId)}`;
  if (state.webhookEvents[key]) return { ...state.webhookEvents[key], duplicate: true };
  const item = { key, provider: String(provider).toLowerCase(), eventId: String(eventId), tenantId: tenantId ? String(tenantId) : null, payload: payload || {}, receivedAt: new Date().toISOString() };
  state.webhookEvents[key] = item;
  STORE.write(state);
  return { ...item, duplicate: false };
}

function providerStatus(provider) {
  const name = String(provider || "manual").toLowerCase();
  return {
    provider: name,
    mode: name === "manual" ? "sandbox" : (LIVE_ENABLED ? "live-gated" : "disabled"),
    canCreateIntent: true,
    canCapture: name === "manual" || LIVE_ENABLED,
    webhookSecretConfigured: !!process.env[`${name.toUpperCase()}_WEBHOOK_SECRET`],
  };
}

module.exports = { LIVE_ENABLED, createPaymentIntent, getPaymentIntent, transitionPayment, verifyWebhookSignature, recordWebhook, providerStatus };
