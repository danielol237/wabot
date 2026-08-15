const { getPlan } = require("./plans");
const subscriptions = require("./subscriptions");
const payments = require("./payments");
const { publish } = require("../events");

function beginCheckout({ tenantId, planId = "free", provider = "manual", actorId = null } = {}) {
  if (!tenantId) throw new Error("tenantId is required");
  const plan = getPlan(planId);
  const normalizedProvider = String(provider || "manual").toLowerCase();
  if (!["manual", "mtn", "orange"].includes(normalizedProvider)) throw new Error("unsupported payment provider");
  if (plan.monthlyPrice <= 0) {
    const subscription = subscriptions.createSubscription({ tenantId, planId: plan.id, actorId, status: "trialing", provider: "internal" });
    return { plan, subscription, intent: null, provider: payments.providerStatus("manual"), activation: "immediate" };
  }
  const subscription = subscriptions.createSubscription({ tenantId, planId: plan.id, actorId, status: "pending", provider: normalizedProvider });
  const intent = payments.createPaymentIntent({ tenantId, subscriptionId: subscription.id, amount: plan.monthlyPrice, currency: plan.currency, provider: normalizedProvider, actorId, description: `${plan.name} monthly subscription` });
  return { plan, subscription, intent, provider: payments.providerStatus(normalizedProvider), activation: "after-approved-payment" };
}

function reconcilePayment(intentId, status, { actorId = null, externalId = null, metadata = {} } = {}) {
  const intent = payments.getPaymentIntent(intentId);
  if (!intent) throw new Error("payment intent not found");
  const updated = payments.transitionPayment(intentId, status, { actorId, externalId, metadata });
  let subscription = intent.subscriptionId ? subscriptions.getSubscription(intent.subscriptionId) : null;
  if (subscription && updated.status === "succeeded") subscription = subscriptions.transition(subscription.id, "active", { actorId, metadata: { paymentIntentId: updated.id, externalId: updated.externalId } });
  if (subscription && ["failed", "cancelled", "refunded"].includes(updated.status)) subscription = subscriptions.transition(subscription.id, updated.status === "refunded" ? "cancelled" : "past_due", { actorId, metadata: { paymentIntentId: updated.id } });
  publish({ type: "billing.checkout.reconciled", tenantId: intent.tenantId, actorId, aggregateType: "payment", aggregateId: intent.id, payload: { status: updated.status, subscriptionId: subscription?.id || null } });
  return { intent: updated, subscription };
}

module.exports = { beginCheckout, reconcilePayment };
