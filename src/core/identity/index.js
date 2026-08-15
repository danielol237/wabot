const crypto = require("crypto");
const path = require("path");
const { createJsonRepository } = require("../storage/jsonRepository");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../../data");
const STORE = createJsonRepository(path.join(DATA_DIR, "platformIdentities.json"), () => ({
  users: {},
  identities: {},
}));

function clean(value, max = 240) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalizeIdentity(provider, value) {
  const source = clean(value);
  const type = clean(provider || "internal", 40).toLowerCase();
  if (!source) throw new Error("identity value is required");
  let normalized = source;
  if (type === "email") normalized = source.toLowerCase();
  if (type === "whatsapp") {
    normalized = source.toLowerCase().replace(/\s+/g, "");
    if (!normalized.includes("@")) normalized += "@s.whatsapp.net";
  }
  return { provider: type, value: source, normalized, key: `${type}:${normalized}` };
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
}

function findByIdentity(provider, value) {
  const identity = normalizeIdentity(provider, value);
  const state = STORE.read();
  const userId = state.identities[identity.key];
  return userId ? state.users[userId] || null : null;
}

function ensureUser({ userId, displayName, identity, metadata = {} } = {}) {
  const normalized = typeof identity === "object" && identity?.key
    ? identity
    : normalizeIdentity(identity?.provider || "internal", identity?.value || userId || displayName);
  const state = STORE.read();
  const existingId = state.identities[normalized.key];
  const id = existingId || clean(userId) || stableId("usr", normalized.key);
  const now = new Date().toISOString();
  const current = state.users[id] || {
    id,
    displayName: clean(displayName || normalized.value, 120),
    identities: [],
    metadata: {},
    createdAt: now,
  };
  current.displayName = clean(displayName || current.displayName || normalized.value, 120);
  current.updatedAt = now;
  current.metadata = { ...current.metadata, ...metadata };
  if (!current.identities.some((item) => item.key === normalized.key)) {
    current.identities.push({ provider: normalized.provider, value: normalized.value, normalized: normalized.normalized, key: normalized.key });
  }
  state.users[id] = current;
  state.identities[normalized.key] = id;
  STORE.write(state);
  return { ...current, identities: current.identities.slice() };
}

function addIdentity(userId, provider, value) {
  const state = STORE.read();
  if (!state.users[userId]) throw new Error("user not found");
  const normalized = normalizeIdentity(provider, value);
  const existing = state.identities[normalized.key];
  if (existing && existing !== userId) throw new Error("identity is already linked to another user");
  if (!state.users[userId].identities.some((item) => item.key === normalized.key)) state.users[userId].identities.push(normalized);
  state.identities[normalized.key] = userId;
  state.users[userId].updatedAt = new Date().toISOString();
  STORE.write(state);
  return { ...state.users[userId] };
}

function getUser(userId) {
  const state = STORE.read();
  return state.users[userId] ? { ...state.users[userId] } : null;
}

function listUsers() {
  return Object.values(STORE.read().users).map((user) => ({ ...user }));
}

module.exports = {
  STORE,
  normalizeIdentity,
  stableId,
  findByIdentity,
  ensureUser,
  addIdentity,
  getUser,
  listUsers,
};
