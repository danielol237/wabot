const crypto = require("crypto");
const path = require("path");
const { createJsonRepository } = require("../storage/jsonRepository");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../../data");
const STORE = createJsonRepository(path.join(DATA_DIR, "platformEvents.json"), () => ({ events: [] }));
const MAX_EVENTS = 20000;

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function clean(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function publish({ type, tenantId = null, actorId = null, aggregateType = null, aggregateId = null, payload = {}, correlationId, idempotencyKey = null, source = "platform", version = 1 } = {}) {
  const eventType = clean(type, 120);
  if (!eventType) throw new Error("event type is required");
  const state = STORE.read();
  if (idempotencyKey) {
    const existing = state.events.find((event) => event.idempotencyKey === idempotencyKey && event.tenantId === tenantId);
    if (existing) return { ...existing, duplicate: true };
  }
  const event = {
    id: id("evt"),
    type: eventType,
    version: Number(version) || 1,
    tenantId: tenantId ? clean(tenantId) : null,
    actorId: actorId ? clean(actorId) : null,
    aggregateType: aggregateType ? clean(aggregateType, 80) : null,
    aggregateId: aggregateId ? clean(aggregateId) : null,
    correlationId: clean(correlationId || id("cor"), 120),
    idempotencyKey: idempotencyKey ? clean(idempotencyKey, 180) : null,
    source: clean(source, 80) || "platform",
    payload: payload && typeof payload === "object" ? JSON.parse(JSON.stringify(payload)) : { value: payload },
    occurredAt: new Date().toISOString(),
  };
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  STORE.write(state);
  return { ...event, duplicate: false };
}

function list({ tenantId = null, type = null, aggregateId = null, limit = 100 } = {}) {
  const max = Math.max(1, Math.min(500, Number(limit) || 100));
  return STORE.read().events
    .filter((event) => !tenantId || event.tenantId === tenantId)
    .filter((event) => !type || event.type === type)
    .filter((event) => !aggregateId || event.aggregateId === aggregateId)
    .slice(-max)
    .reverse();
}

function count({ tenantId = null, type = null } = {}) {
  return list({ tenantId, type, limit: MAX_EVENTS }).length;
}

module.exports = { STORE, publish, list, count };
