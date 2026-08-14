// ARIA Atlas — natural-language Project Brain orchestration.
// This layer keeps intake deterministic and explainable. The LLM can later help
// classify ambiguous notes, but project writes always go through atlasStore.

const { createWorkspace, findWorkspace, getBrief, addEvent, addEvidence, addTask, updateTask, summary } = require("./atlasStore");
const { createMission, executeMission } = require("./durableMissions");
const { decisionCard, LEVELS } = require("./atlasPolicy");

function clean(value, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseDeadline(text) {
  return clean(String(text || "").match(/\bby\s+([^,.!?]+(?:\s+\d{4})?)\b/i)?.[1], 80) || null;
}

function parseProjectContract(text) {
  const input = clean(text);
  const withoutLead = input
    .replace(/^(?:aria[,:!]?\s*)?(?:this is|this is my|new|create|start)\s+(?:a\s+)?(?:new\s+)?project\s*[:,-]?\s*/i, "")
    .trim();
  const title = clean(withoutLead.split(/\b(?:by|because|so that|with the goal of)\b/i)[0], 120) || "Untitled project";
  const outcome = clean(withoutLead, 1000) || title;
  return { title, outcome, deadline: parseDeadline(input) };
}

function explicitWorkspaceQuery(text) {
  const m = String(text || "").match(/\b(?:add this to|add that to|in|for|on)\s+(?:the\s+)?(.+?)(?:\s+project)?$/i);
  return clean(m?.[1], 120);
}

function projectUrl(pathname = "") {
  const base = String(process.env.BASE_URL || process.env.ANIME_PUBLIC_URL || "").replace(/\/+$/, "");
  return base ? base + pathname : pathname;
}

function createAtlasProject(ownerId, text) {
  const contract = parseProjectContract(text);
  const workspace = createWorkspace(ownerId, contract);
  addEvidence(ownerId, workspace.id, {
    kind: "conversation",
    title: "Project contract captured from WhatsApp",
    summary: text,
    source: "whatsapp",
  });
  addTask(ownerId, workspace.id, {
    title: "Define the first milestone and acceptance criteria",
    description: "Turn the project outcome into a measurable first milestone.",
    priority: "high",
  });
  return workspace;
}

function formatCreated(workspace) {
  let out = `🧭 *Atlas workspace created: ${workspace.title}*\n\nOutcome: ${workspace.contract.outcome}`;
  if (workspace.contract.deadline) out += `\nDeadline: ${workspace.contract.deadline}`;
  out += `\n\nI’ll track this project’s milestones, tasks, decisions, evidence, and blockers together.\n\nDashboard: ${projectUrl("/dashboard/atlas")}`;
  out += "\n\nTell me “add this to the project”, “what is next?”, or “give me the project brief.”";
  return out;
}

function formatEvidence(workspace, evidence) {
  return `📌 Added to *${workspace.title}*\n\n${evidence.summary || evidence.title}\n\nI’ll keep it attached to this project’s evidence trail.`;
}

function formatDecisions(brief) {
  if (!brief.recentDecisions.length) return `There are no recorded decisions yet for *${brief.workspace.title}*. When we choose a direction, I’ll record the reason and alternatives.`;
  return `🧾 *Recent decisions for ${brief.workspace.title}*\n\n${brief.recentDecisions.map((decision) => `• ${decision.choice || decision.question}${decision.rationale ? ` — ${decision.rationale}` : ""}`).join("\n")}`;
}

async function nextSafeStep(ownerId, workspace, options = {}) {
  const brief = getBrief(ownerId, workspace.id);
  const task = brief?.nextTasks.find((candidate) => candidate.status === "todo");
  if (!task) return "There is no unstarted task in this workspace yet. Ask me to create the next milestone or add a task.";
  const gate = decisionCard(task.title, workspace);
  if (gate.approvalRequired || gate.level === LEVELS.PROPOSE || gate.level === LEVELS.COMMIT) {
    return `The next task is *${task.title}*. It is classified as *${gate.level}* and needs your approval before I run it. ${gate.reason}`;
  }
  const missionId = createMission(options.chatId || ownerId, ownerId, task.title, { metadata: { atlasWorkspaceId: workspace.id, atlasTaskId: task.id, actionLevel: "prepare" } });
  updateTask(ownerId, workspace.id, task.id, { status: "in_progress", missionId });
  addEvent(ownerId, workspace.id, { type: "next_step_started", text: `Started safe preparation mission ${missionId} for ${task.title}` });
  executeMission(missionId).catch(() => {});
  return `▶️ I started the safe preparation step for *${workspace.title}*.\n\nTask: ${task.title}\nMission: ${missionId}\n\nI’ll report the evidence and outcome when it checkpoints.`;
}

async function handleAtlas(ownerId, text, options = {}) {
  const input = clean(text);
  const lower = input.toLowerCase();
  if (/^(?:aria[,:!]?\s*)?(?:this is|this is my|new|create|start)\s+(?:a\s+)?(?:new\s+)?project\b/i.test(input)) {
    return { kind: "created", workspace: createAtlasProject(ownerId, input) };
  }

  if (/\b(?:why did you choose|what decisions|recent decisions|why this)\b/i.test(lower)) {
    const brief = getBrief(ownerId);
    return { kind: "text", text: formatDecisions(brief) };
  }

  if (/\b(?:what is|what's|show me)\s+(?:next|the next step|the project brief|the brief)|\b(?:project brief|morning brief|morning briefing)\b/i.test(lower)) {
    return { kind: "text", text: summary(getBrief(ownerId)) };
  }

  if (/\b(?:what is|what's|show me)\s+(?:blocking|blocked)|\b(?:blockers|what is blocking us)\b/i.test(lower)) {
    const brief = getBrief(ownerId);
    if (!brief) return { kind: "text", text: summary(null) };
    return { kind: "text", text: brief.blocked.length ? `🚧 *Blocked in ${brief.workspace.title}*\n\n${brief.blocked.map((task) => `• ${task.title}`).join("\n")}` : `Nothing is currently blocked in *${brief.workspace.title}*.` };
  }

  if (/\b(?:take|run)\s+(?:the\s+)?next\s+safe\s+step\b/i.test(lower)) {
    const workspace = findWorkspace(ownerId);
    return { kind: "text", text: workspace ? await nextSafeStep(ownerId, workspace, options) : summary(null) };
  }

  if (/\b(?:add this|add that)\s+to\b/i.test(lower)) {
    const query = explicitWorkspaceQuery(input);
    const workspace = findWorkspace(ownerId, query);
    if (!workspace) return { kind: "text", text: "I couldn't find that Atlas workspace. Say “this is a project: <name and outcome>” first." };
    const evidence = addEvidence(ownerId, workspace.id, { kind: "conversation", title: "WhatsApp note", summary: input, source: "whatsapp" });
    return { kind: "text", text: formatEvidence(workspace, evidence) };
  }

  if (/^(?:aria[,:!]?\s*)?(?:add|create)\s+(?:a\s+)?task\b/i.test(input)) {
    const title = clean(input.replace(/^(?:aria[,:!]?\s*)?(?:add|create)\s+(?:a\s+)?task\s*[:,-]?\s*/i, ""), 240);
    const workspace = findWorkspace(ownerId);
    if (!workspace) return { kind: "text", text: summary(null) };
    if (!title) return { kind: "text", text: "Tell me what the Atlas task should be." };
    const task = addTask(ownerId, workspace.id, { title });
    return { kind: "text", text: `✅ Added task to *${workspace.title}*: ${task.title}` };
  }

  if (/^(?:aria[,:!]?\s*)?(?:record|log|save)\s+(?:a\s+)?decision\b/i.test(input)) {
    const choice = clean(input.replace(/^(?:aria[,:!]?\s*)?(?:record|log|save)\s+(?:a\s+)?decision\s*[:,-]?\s*/i, ""), 600);
    const workspace = findWorkspace(ownerId);
    if (!workspace) return { kind: "text", text: summary(null) };
    if (!choice) return { kind: "text", text: "Tell me the decision you want recorded." };
    const decision = addDecision(ownerId, workspace.id, { choice, rationale: "Recorded from the owner’s conversation." });
    return { kind: "text", text: `🧾 Recorded in *${workspace.title}*: ${decision.choice}` };
  }

  const workspace = findWorkspace(ownerId);
  return { kind: "text", text: workspace ? summary(getBrief(ownerId, workspace.id)) : summary(null) };
}

module.exports = { parseProjectContract, createAtlasProject, formatCreated, handleAtlas, nextSafeStep };
