const crypto = require("crypto");
const path = require("path");
const { createJsonRepository } = require("../storage/jsonRepository");
const { assertCan } = require("../permissions");
const { publish } = require("../events");
const jobs = require("../jobs");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../../data");
const STORE = createJsonRepository(path.join(DATA_DIR, "platformBusiness.json"), () => ({
  customers: {},
  leads: {},
  conversations: {},
  knowledge: {},
  followups: {},
  orders: {},
}));

const LEAD_STAGES = ["new", "contacted", "qualified", "negotiating", "won", "lost"];

function id(prefix) { return `${prefix}_${crypto.randomBytes(10).toString("hex")}`; }
function text(value, max = 240) { return String(value == null ? "" : value).trim().slice(0, max); }
function tenantOf(context) { if (!context?.tenantId) throw new Error("tenant context is required"); return String(context.tenantId); }
function requireCapability(context, capability) { tenantOf(context); assertCan(context, capability); }
function now() { return new Date().toISOString(); }
function belongs(item, tenantId) { return item && item.tenantId === tenantId; }

function ensureCustomer(context, { name, phone = null, email = null, company = null, tags = [], notes = "", source = "manual", metadata = {} } = {}) {
  requireCapability(context, "business.write");
  if (!name && !phone && !email) throw new Error("customer name, phone, or email is required");
  const tenantId = tenantOf(context);
  const state = STORE.read();
  const normalized = String(phone || email || name).toLowerCase().replace(/\s+/g, "");
  const existing = Object.values(state.customers).find((item) => item.tenantId === tenantId && item.identity === normalized);
  const customer = existing || { id: id("cus"), tenantId, identity: normalized, createdAt: now() };
  Object.assign(customer, {
    name: text(name || customer.name || "Customer", 120),
    phone: phone ? text(phone, 40) : customer.phone || null,
    email: email ? text(email, 180).toLowerCase() : customer.email || null,
    company: company ? text(company, 140) : customer.company || null,
    tags: [...new Set([...(customer.tags || []), ...(Array.isArray(tags) ? tags.map((tag) => text(tag, 40).toLowerCase()) : [])])].slice(0, 30),
    notes: text(notes || customer.notes || "", 2000),
    source: text(source || customer.source || "manual", 80),
    metadata: { ...(customer.metadata || {}), ...(metadata || {}) },
    updatedAt: now(),
  });
  state.customers[customer.id] = customer;
  STORE.write(state);
  publish({ type: existing ? "business.customer.updated" : "business.customer.created", tenantId, actorId: context.userId, aggregateType: "customer", aggregateId: customer.id, payload: { name: customer.name, source: customer.source } });
  return { ...customer };
}

function createLead(context, { customerId, title, value = 0, currency = "XAF", stage = "new", score = 0, source = "whatsapp", notes = "", nextActionAt = null, ownerUserId = null, metadata = {} } = {}) {
  requireCapability(context, "lead.manage");
  const tenantId = tenantOf(context);
  const state = STORE.read();
  const customer = state.customers[customerId];
  if (!belongs(customer, tenantId)) throw new Error("customer not found in tenant");
  const safeStage = LEAD_STAGES.includes(String(stage).toLowerCase()) ? String(stage).toLowerCase() : "new";
  const lead = {
    id: id("lead"), tenantId, customerId, title: text(title || "New opportunity", 180), value: Math.max(0, Number(value) || 0), currency: text(currency || "XAF", 8).toUpperCase(), stage: safeStage,
    score: Math.max(0, Math.min(100, Number(score) || 0)), source: text(source || "whatsapp", 80), notes: text(notes, 2000), nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : null,
    ownerUserId: ownerUserId ? text(ownerUserId, 120) : context.userId || null, metadata: metadata || {}, createdAt: now(), updatedAt: now(),
  };
  state.leads[lead.id] = lead;
  STORE.write(state);
  publish({ type: "business.lead.created", tenantId, actorId: context.userId, aggregateType: "lead", aggregateId: lead.id, payload: { customerId, value: lead.value, currency: lead.currency, stage: lead.stage, score: lead.score } });
  return { ...lead };
}

function updateLead(context, leadId, patch = {}) {
  requireCapability(context, "lead.manage");
  const tenantId = tenantOf(context);
  const state = STORE.read();
  const lead = state.leads[leadId];
  if (!belongs(lead, tenantId)) throw new Error("lead not found in tenant");
  if (patch.stage && LEAD_STAGES.includes(String(patch.stage).toLowerCase())) lead.stage = String(patch.stage).toLowerCase();
  if (patch.score != null) lead.score = Math.max(0, Math.min(100, Number(patch.score) || 0));
  if (patch.value != null) lead.value = Math.max(0, Number(patch.value) || 0);
  if (patch.notes != null) lead.notes = text(patch.notes, 2000);
  if (patch.nextActionAt !== undefined) lead.nextActionAt = patch.nextActionAt ? new Date(patch.nextActionAt).toISOString() : null;
  if (patch.ownerUserId !== undefined) lead.ownerUserId = patch.ownerUserId ? text(patch.ownerUserId, 120) : null;
  lead.updatedAt = now();
  state.leads[lead.id] = lead;
  STORE.write(state);
  publish({ type: "business.lead.updated", tenantId, actorId: context.userId, aggregateType: "lead", aggregateId: lead.id, payload: { stage: lead.stage, score: lead.score, value: lead.value } });
  return { ...lead };
}

function recordConversation(context, { customerId, channel = "whatsapp", direction = "inbound", body, intent = null, sentiment = null, metadata = {} } = {}) {
  requireCapability(context, "business.write");
  const tenantId = tenantOf(context);
  const state = STORE.read();
  if (!belongs(state.customers[customerId], tenantId)) throw new Error("customer not found in tenant");
  const conversation = { id: id("msg"), tenantId, customerId, channel: text(channel, 40), direction: text(direction, 20), body: text(body, 6000), intent: intent ? text(intent, 100) : null, sentiment: sentiment ? text(sentiment, 40) : null, metadata: metadata || {}, createdAt: now() };
  state.conversations[conversation.id] = conversation;
  STORE.write(state);
  publish({ type: "business.conversation.recorded", tenantId, actorId: context.userId, aggregateType: "customer", aggregateId: customerId, payload: { conversationId: conversation.id, channel: conversation.channel, direction: conversation.direction, intent: conversation.intent } });
  return { ...conversation };
}

function addKnowledge(context, { title, content, tags = [], source = "manual", metadata = {} } = {}) {
  requireCapability(context, "knowledge.manage");
  const tenantId = tenantOf(context);
  if (!title || !content) throw new Error("knowledge title and content are required");
  const state = STORE.read();
  const item = { id: id("knw"), tenantId, title: text(title, 180), content: text(content, 12000), tags: Array.isArray(tags) ? tags.map((tag) => text(tag, 40).toLowerCase()).slice(0, 30) : [], source: text(source || "manual", 80), metadata: metadata || {}, createdAt: now(), updatedAt: now() };
  state.knowledge[item.id] = item;
  STORE.write(state);
  publish({ type: "business.knowledge.created", tenantId, actorId: context.userId, aggregateType: "knowledge", aggregateId: item.id, payload: { title: item.title, source: item.source } });
  return { ...item };
}

function scheduleFollowup(context, { leadId, customerId, message, scheduledAt, channel = "whatsapp", status = "pending", metadata = {} } = {}) {
  requireCapability(context, "followup.manage");
  const tenantId = tenantOf(context);
  const state = STORE.read();
  if (leadId && !belongs(state.leads[leadId], tenantId)) throw new Error("lead not found in tenant");
  if (customerId && !belongs(state.customers[customerId], tenantId)) throw new Error("customer not found in tenant");
  const followup = { id: id("fup"), tenantId, leadId: leadId || null, customerId: customerId || state.leads[leadId]?.customerId || null, message: text(message, 4000), scheduledAt: new Date(scheduledAt || Date.now()).toISOString(), channel: text(channel || "whatsapp", 40), status: text(status || "pending", 20), metadata: metadata || {}, createdAt: now(), updatedAt: now() };
  try {
    const job = jobs.enqueue({ tenantId, type: "business.followup.due", payload: { followupId: followup.id }, runAt: followup.scheduledAt, idempotencyKey: `followup:${followup.id}` });
    followup.jobId = job.id;
  } catch (_) {}
  state.followups[followup.id] = followup;
  STORE.write(state);
  publish({ type: "business.followup.scheduled", tenantId, actorId: context.userId, aggregateType: "followup", aggregateId: followup.id, payload: { leadId: followup.leadId, customerId: followup.customerId, scheduledAt: followup.scheduledAt, channel: followup.channel } });
  return { ...followup };
}

function updateFollowup(context, followupId, { status, metadata = {} } = {}) {
  requireCapability(context, "followup.manage");
  const tenantId = tenantOf(context);
  const state = STORE.read();
  const followup = state.followups[followupId];
  if (!belongs(followup, tenantId)) throw new Error("follow-up not found in tenant");
  const allowed = ["pending", "approved", "sent", "cancelled", "failed"];
  if (status && !allowed.includes(String(status).toLowerCase())) throw new Error("invalid follow-up status");
  if (status) followup.status = String(status).toLowerCase();
  followup.metadata = { ...(followup.metadata || {}), ...(metadata || {}) };
  followup.updatedAt = now();
  state.followups[followup.id] = followup;
  STORE.write(state);
  publish({ type: `business.followup.${followup.status}`, tenantId, actorId: context.userId, aggregateType: "followup", aggregateId: followup.id, payload: { leadId: followup.leadId, customerId: followup.customerId, status: followup.status } });
  return { ...followup };
}

function createOrder(context, { customerId, leadId = null, items = [], total = 0, currency = "XAF", status = "draft", metadata = {} } = {}) {
  requireCapability(context, "order.manage");
  const tenantId = tenantOf(context);
  const state = STORE.read();
  if (!belongs(state.customers[customerId], tenantId)) throw new Error("customer not found in tenant");
  if (leadId && !belongs(state.leads[leadId], tenantId)) throw new Error("lead not found in tenant");
  const order = { id: id("ord"), tenantId, customerId, leadId, items: Array.isArray(items) ? JSON.parse(JSON.stringify(items)).slice(0, 100) : [], total: Math.max(0, Number(total) || 0), currency: text(currency || "XAF", 8).toUpperCase(), status: text(status || "draft", 30), metadata: metadata || {}, createdAt: now(), updatedAt: now() };
  state.orders[order.id] = order;
  STORE.write(state);
  publish({ type: "business.order.created", tenantId, actorId: context.userId, aggregateType: "order", aggregateId: order.id, payload: { customerId, leadId, total: order.total, currency: order.currency, status: order.status } });
  return { ...order };
}

function list(context, type, { stage = null, status = null, limit = 100 } = {}) {
  requireCapability(context, "business.read");
  const tenantId = tenantOf(context);
  const state = STORE.read();
  const source = state[type] || {};
  const max = Math.max(1, Math.min(500, Number(limit) || 100));
  return Object.values(source).filter((item) => item.tenantId === tenantId).filter((item) => !stage || item.stage === stage).filter((item) => !status || item.status === status).slice(-max).reverse();
}

function summary(context) {
  requireCapability(context, "analytics.read");
  const tenantId = tenantOf(context);
  const state = STORE.read();
  const customers = Object.values(state.customers).filter((item) => item.tenantId === tenantId);
  const leads = Object.values(state.leads).filter((item) => item.tenantId === tenantId);
  const orders = Object.values(state.orders).filter((item) => item.tenantId === tenantId);
  const byStage = Object.fromEntries(LEAD_STAGES.map((stage) => [stage, leads.filter((lead) => lead.stage === stage).length]));
  const revenue = orders.filter((order) => ["paid", "fulfilled", "won"].includes(order.status)).reduce((sum, order) => sum + order.total, 0);
  const openLeads = leads.filter((lead) => !["won", "lost"].includes(lead.stage));
  const pipelineValue = openLeads.reduce((sum, lead) => sum + lead.value, 0);
  const weightedPipeline = openLeads.reduce((sum, lead) => sum + (lead.value * (lead.score / 100)), 0);
  const forecast = { pipelineValue, weightedPipeline: Math.round(weightedPipeline), wonValue: revenue, openLeads: openLeads.length, winRate: leads.length ? Math.round((leads.filter((lead) => lead.stage === "won").length / leads.length) * 100) : 0 };
  return { customers: customers.length, leads: leads.length, orders: orders.length, revenue, byStage, forecast, hotLeads: leads.filter((lead) => lead.score >= 70 && !["won", "lost"].includes(lead.stage)).sort((a, b) => b.score - a.score).slice(0, 10) };
}

module.exports = { STORE, LEAD_STAGES, ensureCustomer, createLead, updateLead, recordConversation, addKnowledge, scheduleFollowup, updateFollowup, createOrder, list, summary };
