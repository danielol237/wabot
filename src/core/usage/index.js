const crypto = require("crypto");
const path = require("path");
const { createJsonRepository } = require("../storage/jsonRepository");
const { publish } = require("../events");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../../data");
const STORE = createJsonRepository(path.join(DATA_DIR, "platformUsage.json"), () => ({ records: [] }));
const MAX_RECORDS = 30000;

function id() {
  return `use_${crypto.randomBytes(10).toString("hex")}`;
}

function record({ tenantId, actorId = null, category, metric, units = 1, estimatedCost = 0, currency = "USD", provider = null, model = null, metadata = {}, idempotencyKey = null, correlationId = null } = {}) {
  if (!tenantId) throw new Error("tenantId is required for usage records");
  if (!category || !metric) throw new Error("category and metric are required for usage records");
  const state = STORE.read();
  if (idempotencyKey) {
    const existing = state.records.find((item) => item.tenantId === tenantId && item.idempotencyKey === idempotencyKey);
    if (existing) return { ...existing, duplicate: true };
  }
  const entry = {
    id: id(),
    tenantId: String(tenantId),
    actorId: actorId ? String(actorId) : null,
    category: String(category).trim().toLowerCase(),
    metric: String(metric).trim().toLowerCase(),
    units: Math.max(0, Number(units) || 0),
    estimatedCost: Math.max(0, Number(estimatedCost) || 0),
    currency: String(currency || "USD").toUpperCase().slice(0, 8),
    provider: provider ? String(provider).slice(0, 80) : null,
    model: model ? String(model).slice(0, 120) : null,
    metadata: metadata && typeof metadata === "object" ? JSON.parse(JSON.stringify(metadata)) : {},
    idempotencyKey: idempotencyKey ? String(idempotencyKey).slice(0, 180) : null,
    correlationId: correlationId ? String(correlationId).slice(0, 120) : null,
    recordedAt: new Date().toISOString(),
  };
  state.records.push(entry);
  if (state.records.length > MAX_RECORDS) state.records.splice(0, state.records.length - MAX_RECORDS);
  STORE.write(state);
  publish({
    type: "usage.recorded",
    tenantId: entry.tenantId,
    actorId: entry.actorId,
    aggregateType: "usage",
    aggregateId: entry.id,
    correlationId: entry.correlationId,
    idempotencyKey: idempotencyKey ? `event:${idempotencyKey}` : null,
    payload: { category: entry.category, metric: entry.metric, units: entry.units, estimatedCost: entry.estimatedCost, currency: entry.currency },
  });
  return { ...entry, duplicate: false };
}

function list({ tenantId, category = null, metric = null, from = null, to = null, limit = 500 } = {}) {
  const max = Math.max(1, Math.min(2000, Number(limit) || 500));
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs = to ? new Date(to).getTime() : Infinity;
  return STORE.read().records.filter((item) => {
    const at = new Date(item.recordedAt).getTime();
    return (!tenantId || item.tenantId === tenantId) && (!category || item.category === category) && (!metric || item.metric === metric) && at >= fromMs && at <= toMs;
  }).slice(-max).reverse();
}

function summary(options = {}) {
  const buckets = new Map();
  for (const item of list({ ...options, limit: 2000 })) {
    const key = `${item.category}:${item.metric}:${item.currency}`;
    const bucket = buckets.get(key) || { category: item.category, metric: item.metric, currency: item.currency, units: 0, estimatedCost: 0, records: 0 };
    bucket.units += item.units;
    bucket.estimatedCost += item.estimatedCost;
    bucket.records += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.estimatedCost - a.estimatedCost);
}

module.exports = { STORE, record, list, summary };
