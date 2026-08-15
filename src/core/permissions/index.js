const ROLE_CAPABILITIES = Object.freeze({
  owner: ["*"],
  admin: [
    "tenant.read", "tenant.manage", "members.read", "members.manage", "audit.read",
    "usage.read", "business.read", "business.write", "lead.manage", "followup.manage",
    "knowledge.manage", "order.manage", "analytics.read", "ai.use", "media.use",
  ],
  operator: [
    "tenant.read", "members.read", "audit.read", "usage.read", "business.read",
    "business.write", "lead.manage", "followup.manage", "knowledge.manage", "order.manage",
    "analytics.read", "ai.use", "media.use",
  ],
  agent: ["tenant.read", "business.read", "business.write", "lead.manage", "followup.manage", "knowledge.read", "order.manage", "ai.use", "media.use"],
  viewer: ["tenant.read", "business.read", "analytics.read", "knowledge.read"],
  member: ["tenant.read", "business.read", "knowledge.read", "ai.use"],
});

function capabilitiesForRole(role) {
  return (ROLE_CAPABILITIES[String(role || "member").toLowerCase()] || ROLE_CAPABILITIES.member).slice();
}

function can(role, capability) {
  const required = String(capability || "").trim().toLowerCase();
  if (!required) return false;
  const granted = capabilitiesForRole(role);
  return granted.includes("*") || granted.includes(required);
}

function assertCan(context, capability) {
  if (!context || !can(context.role, capability)) {
    const error = new Error(`Missing capability: ${capability}`);
    error.code = "CAPABILITY_DENIED";
    error.capability = capability;
    throw error;
  }
  return true;
}

function authorize({ userId, tenantId, role, capability, source = "platform" } = {}) {
  const allowed = can(role, capability);
  return {
    allowed,
    userId: userId || null,
    tenantId: tenantId || null,
    role: role || "member",
    capability,
    source,
    reason: allowed ? null : "CAPABILITY_DENIED",
  };
}

module.exports = { ROLE_CAPABILITIES, capabilitiesForRole, can, assertCan, authorize };
