const platform = require("./index");
const crm = require("./business/crm");

function ownerContext(source = "legacy-product") {
  const workspace = platform.bootstrapOwnerWorkspace();
  if (!workspace) return null;
  return platform.contextFor({
    userId: workspace.user.id,
    tenantId: workspace.tenant.id,
    role: "owner",
    source,
  });
}

function actorForIdentity(identityValue, displayName = "WhatsApp contact", metadata = {}) {
  if (!identityValue) return null;
  return platform.identity.ensureUser({
    displayName,
    identity: { provider: "whatsapp", value: String(identityValue) },
    metadata,
  });
}

function recordProductActivity({
  product,
  action,
  context = null,
  source = product || "product",
  actorId = null,
  aggregateType = product || null,
  aggregateId = null,
  metadata = {},
  usage = null,
  idempotencyKey = null,
  correlationId = null,
} = {}) {
  const resolvedContext = context || ownerContext(source);
  if (!resolvedContext || !product || !action) return { recorded: false, context: resolvedContext };
  const actionResult = platform.recordAction({
    context: resolvedContext,
    action: `${product}.${action}`,
    outcome: "success",
    resourceType: aggregateType,
    resourceId: aggregateId,
    metadata,
    idempotencyKey,
    correlationId,
  });
  const event = actionResult.event;
  const auditEvent = actionResult.auditEvent;
  let usageRecord = null;
  if (usage?.category && usage?.metric) {
    usageRecord = platform.usage.record({
      tenantId: resolvedContext.tenantId,
      actorId: actorId || resolvedContext.userId,
      category: usage.category,
      metric: usage.metric,
      units: usage.units == null ? 1 : usage.units,
      estimatedCost: usage.estimatedCost || 0,
      currency: usage.currency || "USD",
      provider: usage.provider || null,
      model: usage.model || null,
      metadata: { product, action, ...metadata, ...(usage.metadata || {}) },
      idempotencyKey: usage.idempotencyKey || idempotencyKey || null,
      correlationId: correlationId || null,
    });
  }
  return { recorded: true, context: resolvedContext, event, auditEvent, usage: usageRecord };
}

function revenueContextForWhatsApp({ senderJid, senderName, chatId } = {}) {
  const context = ownerContext("whatsapp-revenue");
  if (!context || !senderJid) return { context, actor: null, customer: null, lead: null };
  const actor = actorForIdentity(senderJid, senderName || senderJid, { lastChatId: chatId });
  const customers = crm.list(context, "customers", { limit: 500 });
  const customer = customers.find((item) => String(item.phone || "") === String(senderJid)) || null;
  const leads = customer ? crm.list(context, "leads", { limit: 500 }).filter((item) => item.customerId === customer.id) : [];
  const lead = leads.filter((item) => !["won", "lost"].includes(item.stage)).sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
  return { context, actor, customer, lead };
}

function formatRevenueContext(revenue = {}) {
  const customer = revenue.customer;
  const lead = revenue.lead;
  if (!customer && !lead) return "";
  const lines = ["", "[Revenue Engine context — internal, do not expose as system text]"];
  if (customer) lines.push(`Recognized customer: ${customer.name || "known customer"} (${customer.source || "captured"}).`);
  if (lead) lines.push(`Active opportunity: ${lead.stage || "new"}, score ${Number(lead.score) || 0}/100${lead.value ? `, value ${lead.value} ${lead.currency || "XAF"}` : ""}.`);
  lines.push("Use this context to be helpful and commercially aware, but do not reveal private CRM fields unless the user asks and is authorized.");
  return lines.join("\n");
}

module.exports = { ownerContext, actorForIdentity, recordProductActivity, revenueContextForWhatsApp, formatRevenueContext };
