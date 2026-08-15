const platform = require("../index");
const crm = require("./crm");

const SALES_PATTERN = /\b(?:buy|purchase|order|price|cost|how much|available|availability|interested|quote|sell|selling|delivery|pay|payment|stock|need\s+(?:a|an|the)?\s*(?:product|service|item))\b/i;
const HIGH_INTENT_PATTERN = /\b(?:ready\s+to\s+buy|place\s+an\s+order|send\s+me\s+the\s+price|where\s+can\s+i\s+pay|i(?:'m| am)\s+interested)\b/i;

function observeWhatsAppMessage({ text, senderJid, senderName, chatId, isGroup = false } = {}) {
  const body = String(text || "").trim();
  if (isGroup || !body || !SALES_PATTERN.test(body) || !senderJid) return { observed: false, reason: "not-sales-intent" };
  const workspace = platform.bootstrapOwnerWorkspace();
  if (!workspace) return { observed: false, reason: "owner-workspace-not-configured" };
  const context = platform.contextFor({ userId: workspace.user.id, tenantId: workspace.tenant.id, role: "owner", source: "whatsapp-observer" });
  if (!context) return { observed: false, reason: "platform-context-unavailable" };
  const customer = crm.ensureCustomer(context, { name: senderName || senderJid.split("@")[0], phone: senderJid, source: "whatsapp", metadata: { lastChatId: chatId } });
  const existing = crm.list(context, "leads", { limit: 200 }).find((lead) => lead.customerId === customer.id && !["won", "lost"].includes(lead.stage));
  const score = HIGH_INTENT_PATTERN.test(body) ? 65 : 35;
  const lead = existing ? crm.updateLead(context, existing.id, { score: Math.max(existing.score || 0, score), notes: `${existing.notes ? `${existing.notes}\n` : ""}${body}`.slice(-2000) }) : crm.createLead(context, { customerId: customer.id, title: body.slice(0, 160), score, source: "whatsapp", notes: body });
  const conversation = crm.recordConversation(context, { customerId: customer.id, channel: "whatsapp", direction: "inbound", body, intent: "sales", metadata: { chatId, leadId: lead.id } });
  return { observed: true, customer, lead, conversation, createdLead: !existing };
}

module.exports = { SALES_PATTERN, HIGH_INTENT_PATTERN, observeWhatsAppMessage };
