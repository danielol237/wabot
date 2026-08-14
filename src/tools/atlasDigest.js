// ARIA Atlas — high-signal daily briefing composer.
// This is deliberately deterministic and rate-limited. It only summarizes
// durable project state; it does not infer mood or manufacture urgency.

const { listWorkspaces, getBrief, markDigestSent } = require("./atlasStore");

const DAILY_MS = 20 * 60 * 60 * 1000;

function ownerId() {
  const configured = String(process.env.OWNER_NUMBER || "").trim();
  return configured ? (configured.includes("@") ? configured : configured + "@s.whatsapp.net") : "dashboard-owner";
}

function dueBriefs(userId = ownerId(), now = Date.now()) {
  return listWorkspaces(userId, { state: "active" })
    .filter((workspace) => workspace.digest?.enabled !== false)
    .filter((workspace) => now - Number(workspace.digest?.lastSentAt || 0) >= DAILY_MS)
    .map((workspace) => getBrief(userId, workspace.id))
    .filter(Boolean);
}

function lineFor(brief) {
  const { workspace, nextTasks, blocked, progress } = brief;
  const next = nextTasks[0]?.title || "define the next milestone";
  const blockedText = blocked.length ? ` · blocked: ${blocked[0].title}` : "";
  return `• *${workspace.title}* — ${progress}% · next: ${next}${blockedText}`;
}

function composeDailyBrief(userId = ownerId(), now = Date.now()) {
  const briefs = dueBriefs(userId, now);
  if (!briefs.length) return null;
  const lines = briefs.slice(0, 4).map(lineFor);
  const text = `🧭 *Atlas project brief*\n\n${lines.join("\n")}\n\nAsk “what is next?” or “what is blocking us?” for the full workspace view.`;
  return { userId, workspaceIds: briefs.map((brief) => brief.workspace.id), text };
}

function markDelivered(brief, at = Date.now()) {
  if (!brief) return;
  for (const id of brief.workspaceIds || []) markDigestSent(brief.userId, id, at);
}

module.exports = { DAILY_MS, ownerId, dueBriefs, composeDailyBrief, markDelivered };
