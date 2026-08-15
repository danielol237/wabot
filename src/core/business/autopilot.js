const crm = require("./crm");
const { assertCan } = require("../permissions");
const { publish } = require("../events");

function proposeReply(context, { customerId, leadId = null, question, channel = "whatsapp" } = {}) {
  assertCan(context, "followup.manage");
  const prompt = String(question || "").trim();
  if (!prompt) throw new Error("question is required");
  const terms = new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2));
  const matches = crm.list(context, "knowledge", { limit: 200 }).map((item) => {
    const haystack = `${item.title} ${item.content} ${(item.tags || []).join(" ")}`.toLowerCase();
    const score = [...terms].reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    return { item, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  const sources = matches.map(({ item }) => item);
  const answer = sources.length
    ? `Thanks for reaching out. Based on our current information, ${sources[0].content.slice(0, 900)}${sources[0].content.length > 900 ? "…" : ""}\n\nI can confirm the exact next step with the team before anything is sent.`
    : "Thanks for reaching out. I have captured your question and will prepare a verified answer for review before anything is sent.";
  const draft = crm.createDraft(context, { customerId, leadId, body: answer, channel, knowledgeIds: sources.map((item) => item.id), metadata: { question: prompt, sourceCount: sources.length, approvalRequired: true } });
  return { draft, sources, approvalRequired: true, outboundSent: false };
}

function approveReply(context, draftId, { approvedBy = context.userId } = {}) {
  assertCan(context, "followup.manage");
  return crm.updateDraft(context, draftId, { status: "approved", metadata: { approvedBy, approvedAt: new Date().toISOString() } });
}

function qualifyLead(context, leadId, { intent = 0, budget = 0, urgency = 0, engagement = 0, fit = 0 } = {}) {
  assertCan(context, "lead.manage");
  const score = Math.max(0, Math.min(100, Math.round((Number(intent) || 0) * 0.3 + (Number(budget) || 0) * 0.25 + (Number(urgency) || 0) * 0.2 + (Number(engagement) || 0) * 0.15 + (Number(fit) || 0) * 0.1)));
  const stage = score >= 75 ? "qualified" : score >= 40 ? "contacted" : "new";
  return crm.updateLead(context, leadId, { score, stage });
}

function recommendations(context, { now = new Date() } = {}) {
  assertCan(context, "analytics.read");
  const summary = crm.summary(context);
  const due = crm.list(context, "followups", { status: "pending", limit: 200 }).filter((item) => new Date(item.scheduledAt).getTime() <= new Date(now).getTime());
  return {
    hotLeads: summary.hotLeads.map((lead) => ({
      lead,
      recommendation: lead.nextActionAt && new Date(lead.nextActionAt) <= new Date(now) ? "Follow up now" : "Review conversation and prepare offer",
    })),
    dueFollowups: due.map((followup) => ({ followup, recommendation: "Approve before sending" })),
    pipeline: summary.byStage,
    revenue: summary.revenue,
  };
}

function approveFollowup(context, followupId, { approvedBy = context.userId } = {}) {
  assertCan(context, "followup.manage");
  const followup = crm.updateFollowup(context, followupId, { status: "approved", metadata: { approvedBy, approvedAt: new Date().toISOString() } });
  publish({ type: "business.autopilot.followup.approved", tenantId: context.tenantId, actorId: context.userId, aggregateType: "followup", aggregateId: followup.id, payload: { approvedBy } });
  return followup;
}

async function executeApprovedFollowups(context, { deliver, now = new Date(), live = String(process.env.ARIA_AUTOPILOT_LIVE || "false").toLowerCase() === "true" } = {}) {
  assertCan(context, "followup.manage");
  const candidates = crm.list(context, "followups", { status: "approved", limit: 200 }).filter((item) => new Date(item.scheduledAt).getTime() <= new Date(now).getTime());
  if (!live) return { live: false, sent: [], pending: candidates, reason: "ARIA_AUTOPILOT_LIVE is disabled; approved sends remain proposals." };
  if (typeof deliver !== "function") throw new Error("deliver callback is required for live follow-up execution");
  const sent = [];
  for (const followup of candidates) {
    try {
      await deliver(followup);
      sent.push(crm.updateFollowup(context, followup.id, { status: "sent", metadata: { sentAt: new Date().toISOString() } }));
    } catch (err) {
      crm.updateFollowup(context, followup.id, { status: "failed", metadata: { error: String(err?.message || err).slice(0, 240) } });
    }
  }
  return { live: true, sent, pending: [] };
}

module.exports = { proposeReply, approveReply, qualifyLead, recommendations, approveFollowup, executeApprovedFollowups };
