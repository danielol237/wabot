const identity = require("./identity");
const tenants = require("./identity/tenants");
const permissions = require("./permissions");
const events = require("./events");
const audit = require("./events/audit");
const usage = require("./usage");
const jobs = require("./jobs");
const billing = require("./billing");

function ownerJid(value = process.env.OWNER_NUMBER || "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw;
  return `${raw.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
}

function bootstrapOwnerWorkspace({ ownerNumber = process.env.OWNER_NUMBER, ownerName = process.env.ARIA_OWNER_NAME || "ARIA owner", tenantName = process.env.ARIA_TENANT_NAME || "ARIA Workspace" } = {}) {
  const jid = ownerJid(ownerNumber);
  if (!jid || jid === "@s.whatsapp.net") return null;
  const user = identity.ensureUser({ displayName: ownerName, identity: { provider: "whatsapp", value: jid }, metadata: { owner: true } });
  const tenant = tenants.ensureTenant({ name: tenantName, slug: process.env.ARIA_TENANT_SLUG || tenantName, ownerUserId: user.id, metadata: { bootstrap: "env-owner" } });
  return { user, tenant, membership: tenants.getMembership(tenant.id, user.id) };
}

function contextFor({ userId, tenantId, role = null, source = "platform", identityProvider = null, identityValue = null } = {}) {
  let user = userId ? identity.getUser(userId) : null;
  if (!user && identityProvider && identityValue) user = identity.findByIdentity(identityProvider, identityValue);
  if (!user) return null;
  const tenant = tenantId ? tenants.getTenant(tenantId) : tenants.listTenantsForUser(user.id)[0]?.tenant;
  if (!tenant) return null;
  const membership = tenants.getMembership(tenant.id, user.id);
  if (!membership || membership.status !== "active") return null;
  return { userId: user.id, tenantId: tenant.id, role: role || membership.role, source, user, tenant, membership };
}

function assertContext(context, capability) {
  if (!context) {
    const error = new Error("platform context is required");
    error.code = "PLATFORM_CONTEXT_REQUIRED";
    throw error;
  }
  permissions.assertCan(context, capability);
  return context;
}

function recordAction({ context, action, outcome = "success", resourceType = null, resourceId = null, metadata = {}, correlationId, idempotencyKey = null } = {}) {
  const event = events.publish({ type: `platform.${action}`, tenantId: context?.tenantId || null, actorId: context?.userId || null, aggregateType: resourceType, aggregateId: resourceId, correlationId, idempotencyKey, payload: { outcome, ...metadata }, source: context?.source || "platform" });
  const auditEvent = audit.record({ action, outcome, tenantId: context?.tenantId || null, actorId: context?.userId || null, resourceType, resourceId, metadata, correlationId, idempotencyKey, source: context?.source || "platform" });
  return { event, auditEvent };
}

module.exports = { identity, tenants, permissions, events, audit, usage, jobs, billing, ownerJid, bootstrapOwnerWorkspace, contextFor, assertContext, recordAction };
