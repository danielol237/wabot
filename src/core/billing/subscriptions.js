const crypto = require("crypto");
const path = require("path");
const { createJsonRepository } = require("../storage/jsonRepository");
const { getPlan } = require("./plans");
const { publish } = require("../events");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../../data");
const STORE = createJsonRepository(path.join(DATA_DIR, "platformSubscriptions.json"), () => ({ subscriptions: {} }));

function id() {
  return `sub_${crypto.randomBytes(10).toString("hex")}`;
}

function createSubscription({ tenantId, planId = "free", actorId = null, status = "trialing", periodStart = null, periodEnd = null, provider = "internal", externalId = null } = {}) {
  if (!tenantId) throw new Error("tenantId is required");
  const plan = getPlan(planId);
  const start = periodStart ? new Date(periodStart) : new Date();
  const end = periodEnd ? new Date(periodEnd) : new Date(start.getTime() + 30 * 86400000);
  const subscription = {
    id: id(),
    tenantId: String(tenantId),
    planId: plan.id,
    status: String(status || "trialing").toLowerCase(),
    provider: String(provider || "internal").toLowerCase(),
    externalId: externalId ? String(externalId) : null,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAt: null,
  };
  const state = STORE.read();
  state.subscriptions[subscription.id] = subscription;
  STORE.write(state);
  publish({ type: "billing.subscription.created", tenantId, actorId, aggregateType: "subscription", aggregateId: subscription.id, payload: { planId: plan.id, status: subscription.status, provider: subscription.provider } });
  return { ...subscription };
}

function getActiveSubscription(tenantId) {
  const subscriptions = Object.values(STORE.read().subscriptions).filter((item) => item.tenantId === String(tenantId) && ["trialing", "active", "past_due"].includes(item.status));
  subscriptions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return subscriptions[0] ? { ...subscriptions[0] } : null;
}

function getSubscription(subscriptionId) {
  const item = STORE.read().subscriptions[subscriptionId];
  return item ? { ...item } : null;
}

function transition(subscriptionId, status, { actorId = null, metadata = {} } = {}) {
  const state = STORE.read();
  const item = state.subscriptions[subscriptionId];
  if (!item) throw new Error("subscription not found");
  item.status = String(status || "").toLowerCase();
  item.updatedAt = new Date().toISOString();
  if (item.status === "cancelled") item.cancelledAt = item.updatedAt;
  if (metadata && typeof metadata === "object") item.metadata = { ...(item.metadata || {}), ...metadata };
  STORE.write(state);
  publish({ type: `billing.subscription.${item.status}`, tenantId: item.tenantId, actorId, aggregateType: "subscription", aggregateId: item.id, payload: { planId: item.planId, status: item.status, metadata: item.metadata || {} } });
  return { ...item };
}

function listSubscriptions(tenantId = null) {
  return Object.values(STORE.read().subscriptions).filter((item) => !tenantId || item.tenantId === String(tenantId)).map((item) => ({ ...item }));
}

module.exports = { STORE, createSubscription, getActiveSubscription, getSubscription, transition, listSubscriptions };
