const DEFAULT_PLANS = Object.freeze({
  free: {
    id: "free",
    name: "ARIA Free",
    currency: "XAF",
    monthlyPrice: 0,
    entitlements: {
      seats: 1,
      ai_messages_month: 200,
      media_downloads_month: 10,
      active_automations: 2,
      knowledge_documents: 10,
      business_contacts: 100,
    },
  },
  starter: {
    id: "starter",
    name: "ARIA Starter",
    currency: "XAF",
    monthlyPrice: 5000,
    entitlements: {
      seats: 3,
      ai_messages_month: 2000,
      media_downloads_month: 100,
      active_automations: 10,
      knowledge_documents: 100,
      business_contacts: 1000,
    },
  },
  growth: {
    id: "growth",
    name: "ARIA Growth",
    currency: "XAF",
    monthlyPrice: 15000,
    entitlements: {
      seats: 10,
      ai_messages_month: 10000,
      media_downloads_month: 500,
      active_automations: 50,
      knowledge_documents: 500,
      business_contacts: 10000,
    },
  },
  business: {
    id: "business",
    name: "ARIA Business",
    currency: "XAF",
    monthlyPrice: 35000,
    entitlements: {
      seats: 25,
      ai_messages_month: 50000,
      media_downloads_month: 2000,
      active_automations: 250,
      knowledge_documents: 2500,
      business_contacts: 50000,
    },
  },
});

function configuredPlans() {
  let overrides = {};
  try { overrides = JSON.parse(process.env.ARIA_PLAN_OVERRIDES_JSON || "{}"); } catch (_) {}
  const merged = {};
  for (const [id, plan] of Object.entries(DEFAULT_PLANS)) merged[id] = { ...plan, ...(overrides[id] || {}), entitlements: { ...plan.entitlements, ...(overrides[id]?.entitlements || {}) } };
  return merged;
}

function getPlan(planId = "free") {
  const plans = configuredPlans();
  return plans[String(planId).toLowerCase()] || plans.free;
}

function listPlans() {
  return Object.values(configuredPlans()).map((plan) => ({ ...plan, entitlements: { ...plan.entitlements } }));
}

module.exports = { DEFAULT_PLANS, getPlan, listPlans };
