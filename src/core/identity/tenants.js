const crypto = require("crypto");
const path = require("path");
const { createJsonRepository } = require("../storage/jsonRepository");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../../data");
const STORE = createJsonRepository(path.join(DATA_DIR, "platformTenants.json"), () => ({
  tenants: {},
  memberships: {},
}));

function clean(value, max = 120) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function slugify(value) {
  const slug = clean(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

function tenantIdFrom(slug) {
  return `ten_${crypto.createHash("sha256").update(slug).digest("hex").slice(0, 20)}`;
}

function ensureTenant({ tenantId, slug, name, ownerUserId, metadata = {} } = {}) {
  if (!ownerUserId) throw new Error("ownerUserId is required");
  const safeSlug = slugify(slug || name || ownerUserId);
  const state = STORE.read();
  const id = clean(tenantId) || tenantIdFrom(safeSlug);
  const now = new Date().toISOString();
  const current = state.tenants[id] || {
    id,
    slug: safeSlug,
    name: clean(name || safeSlug, 120),
    ownerUserId: clean(ownerUserId),
    metadata: {},
    createdAt: now,
  };
  current.slug = safeSlug;
  current.name = clean(name || current.name || safeSlug, 120);
  current.ownerUserId = clean(current.ownerUserId || ownerUserId);
  current.metadata = { ...current.metadata, ...metadata };
  current.updatedAt = now;
  state.tenants[id] = current;
  const membershipKey = `${id}:${ownerUserId}`;
  state.memberships[membershipKey] = {
    tenantId: id,
    userId: clean(ownerUserId),
    role: "owner",
    status: "active",
    createdAt: state.memberships[membershipKey]?.createdAt || now,
    updatedAt: now,
  };
  STORE.write(state);
  return { ...current };
}

function addMembership({ tenantId, userId, role = "member", status = "active", metadata = {} } = {}) {
  if (!tenantId || !userId) throw new Error("tenantId and userId are required");
  const state = STORE.read();
  if (!state.tenants[tenantId]) throw new Error("tenant not found");
  const key = `${tenantId}:${userId}`;
  const now = new Date().toISOString();
  state.memberships[key] = {
    ...(state.memberships[key] || { createdAt: now }),
    tenantId,
    userId,
    role: clean(role, 40).toLowerCase() || "member",
    status: clean(status, 20).toLowerCase() || "active",
    metadata: { ...(state.memberships[key]?.metadata || {}), ...metadata },
    updatedAt: now,
  };
  STORE.write(state);
  return { ...state.memberships[key] };
}

function getTenant(tenantId) {
  const state = STORE.read();
  return state.tenants[tenantId] ? { ...state.tenants[tenantId] } : null;
}

function getMembership(tenantId, userId) {
  const state = STORE.read();
  const membership = state.memberships[`${tenantId}:${userId}`];
  return membership ? { ...membership } : null;
}

function listTenantsForUser(userId) {
  const state = STORE.read();
  return Object.values(state.memberships)
    .filter((item) => item.userId === userId && item.status === "active")
    .map((item) => ({ ...item, tenant: state.tenants[item.tenantId] || null }));
}

function listTenants() {
  return Object.values(STORE.read().tenants).map((tenant) => ({ ...tenant }));
}

module.exports = {
  STORE,
  slugify,
  tenantIdFrom,
  ensureTenant,
  addMembership,
  getTenant,
  getMembership,
  listTenantsForUser,
  listTenants,
};
