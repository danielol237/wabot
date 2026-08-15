const plans = require("./plans");
const entitlements = require("./entitlements");
const subscriptions = require("./subscriptions");
const payments = require("./payments");
const checkout = require("./checkout");

function resolveTenantPlan(tenantId) {
  const active = subscriptions.getActiveSubscription(tenantId);
  return active ? plans.getPlan(active.planId) : plans.getPlan("free");
}

function entitlementForTenant({ tenantId, key, requested = 1, usage = null, from = null, to = null } = {}) {
  const plan = resolveTenantPlan(tenantId);
  return entitlements.checkEntitlement({ tenantId, planId: plan.id, key, requested, usage, from, to });
}

module.exports = { ...plans, ...entitlements, ...subscriptions, ...payments, ...checkout, resolveTenantPlan, entitlementForTenant };
