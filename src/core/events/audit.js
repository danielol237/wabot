const { publish, list } = require("./index");

function record({ action, outcome = "success", tenantId = null, actorId = null, resourceType = null, resourceId = null, metadata = {}, correlationId, idempotencyKey = null, source = "platform" } = {}) {
  const safeAction = String(action || "unknown").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
  return publish({
    type: `audit.${safeAction}`,
    tenantId,
    actorId,
    aggregateType: resourceType,
    aggregateId: resourceId,
    correlationId,
    idempotencyKey,
    source,
    payload: { outcome, ...metadata },
  });
}

function listAudit(options = {}) {
  return list({ ...options, type: options.type || undefined }).filter((event) => event.type.startsWith("audit."));
}

module.exports = { record, listAudit };
