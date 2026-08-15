const { getPlan } = require("./plans");
const { summary } = require("../usage");

function entitlementValue(planId, key, fallback = 0) {
  const value = getPlan(planId).entitlements?.[key];
  return value == null ? fallback : Number(value);
}

function usageMetricFor(key) {
  return {
    ai_messages_month: ["ai", "messages"],
    media_downloads_month: ["media", "downloads"],
    active_automations: ["automation", "active"],
    knowledge_documents: ["knowledge", "documents"],
    business_contacts: ["business", "contacts"],
  }[key] || null;
}

function currentUsage(tenantId, key, { from = null, to = null } = {}) {
  const metric = usageMetricFor(key);
  if (!metric) return 0;
  const rows = summary({ tenantId, from, to });
  return rows.filter((row) => row.category === metric[0] && row.metric === metric[1]).reduce((sum, row) => sum + row.units, 0);
}

function checkEntitlement({ tenantId, planId = "free", key, requested = 1, usage = null, from = null, to = null } = {}) {
  const limit = entitlementValue(planId, key, 0);
  const used = usage == null ? currentUsage(tenantId, key, { from, to }) : Number(usage) || 0;
  const wants = Math.max(0, Number(requested) || 0);
  return {
    allowed: limit < 0 || used + wants <= limit,
    tenantId: tenantId || null,
    planId: getPlan(planId).id,
    key,
    limit,
    used,
    requested: wants,
    remaining: limit < 0 ? Infinity : Math.max(0, limit - used),
    reason: limit < 0 || used + wants <= limit ? null : "ENTITLEMENT_LIMIT_REACHED",
  };
}

function assertEntitled(options) {
  const result = checkEntitlement(options);
  if (!result.allowed) {
    const error = new Error(`Entitlement limit reached: ${result.key}`);
    error.code = result.reason;
    error.entitlement = result;
    throw error;
  }
  return result;
}

module.exports = { entitlementValue, currentUsage, checkEntitlement, assertEntitled };
