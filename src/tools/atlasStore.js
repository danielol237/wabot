// ARIA Atlas — durable Project Brain workspace store.
// One owner-scoped JSON record per workspace keeps project context, decisions,
// evidence, tasks, and mission links together without mixing users.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const ATLAS_DIR = path.join(DATA_DIR, "atlas");
const MAX_EVENTS = 500;
const MAX_EVIDENCE = 300;
const MAX_DECISIONS = 200;

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(ATLAS_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DATA_DIR, 0o700); fs.chmodSync(ATLAS_DIR, 0o700); } catch (_) {}
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function fileFor(id) {
  const safe = safeId(id);
  if (!safe || safe !== String(id)) throw new Error("invalid Atlas workspace id");
  return path.join(ATLAS_DIR, safe + ".json");
}

function readWorkspace(id) {
  ensureDir();
  const file = fileFor(id);
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch (_) {
    return null;
  }
}

function writeAtomic(file, value) {
  ensureDir();
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch (_) {}
}

function persist(workspace) {
  workspace.updatedAt = Date.now();
  writeAtomic(fileFor(workspace.id), workspace);
  return workspace;
}

function ownerKey(ownerId) {
  const key = String(ownerId || "").trim();
  if (!key) throw new Error("Atlas workspace requires an owner");
  return key;
}

function cleanText(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

function safeHttpUrl(value) {
  const raw = cleanText(value, 1000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function createWorkspace(ownerId, input = {}) {
  const owner = ownerKey(ownerId);
  const now = Date.now();
  const id = "atlas_" + crypto.randomUUID();
  const title = cleanText(input.title || input.name || "Untitled project", 120) || "Untitled project";
  const workspace = {
    id,
    ownerId: owner,
    title,
    state: "active",
    contract: {
      outcome: cleanText(input.outcome || input.objective || title, 1000),
      deadline: cleanText(input.deadline, 80) || null,
      constraints: Array.isArray(input.constraints) ? input.constraints.map((v) => cleanText(v, 300)).filter(Boolean).slice(0, 30) : [],
      nonGoals: Array.isArray(input.nonGoals) ? input.nonGoals.map((v) => cleanText(v, 300)).filter(Boolean).slice(0, 30) : [],
    },
    milestones: [],
    tasks: [],
    decisions: [],
    evidence: [],
    signals: [],
    missionIds: [],
    approvalPolicy: input.approvalPolicy || "balanced",
    digest: { enabled: input.digestEnabled !== false, cadence: input.digestCadence || "daily", lastSentAt: 0 },
    createdAt: now,
    updatedAt: now,
  };
  workspace.events = [{ type: "workspace_created", text: `Created Atlas workspace: ${title}`, at: now }];
  persist(workspace);
  return workspace;
}

function getWorkspace(ownerId, id) {
  const workspace = readWorkspace(id);
  if (!workspace || workspace.ownerId !== ownerKey(ownerId)) return null;
  return workspace;
}

function listWorkspaces(ownerId, options = {}) {
  const owner = ownerKey(ownerId);
  ensureDir();
  return fs.readdirSync(ATLAS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readWorkspace(file.slice(0, -5)))
    .filter((workspace) => workspace && workspace.ownerId === owner && (!options.state || workspace.state === options.state))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function findWorkspace(ownerId, query = "") {
  const workspaces = listWorkspaces(ownerId, { state: "active" });
  const term = cleanText(query, 120).toLowerCase();
  if (!term) return workspaces[0] || null;
  return workspaces.find((workspace) => workspace.title.toLowerCase().includes(term) || workspace.contract.outcome.toLowerCase().includes(term)) || workspaces[0] || null;
}

function mutate(ownerId, id, fn) {
  const workspace = getWorkspace(ownerId, id);
  if (!workspace) return null;
  fn(workspace);
  return persist(workspace);
}

function addEvent(ownerId, id, event = {}) {
  return mutate(ownerId, id, (workspace) => {
    if (!Array.isArray(workspace.events)) workspace.events = [];
    workspace.events.push({
      id: crypto.randomUUID(),
      type: cleanText(event.type || "note", 40),
      text: cleanText(event.text || event.detail || "", 1000),
      at: Number(event.at) || Date.now(),
      source: cleanText(event.source, 120) || "whatsapp",
    });
    if (workspace.events.length > MAX_EVENTS) workspace.events = workspace.events.slice(-MAX_EVENTS);
  });
}

function addTask(ownerId, id, task = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    created = {
      id: "task_" + crypto.randomUUID(),
      title: cleanText(task.title || task.text || "Untitled task", 240),
      description: cleanText(task.description, 1000),
      status: task.status || "todo",
      priority: task.priority || "normal",
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String).slice(0, 20) : [],
      missionId: task.missionId || null,
      evidenceIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    value.tasks.push(created);
    addEventToWorkspace(value, "task_created", `Task added: ${created.title}`);
  });
  return workspace ? created : null;
}

function updateTask(ownerId, id, taskId, patch = {}) {
  let updated = null;
  const workspace = mutate(ownerId, id, (value) => {
    const task = value.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    if (patch.title !== undefined) task.title = cleanText(patch.title, 240);
    if (patch.description !== undefined) task.description = cleanText(patch.description, 1000);
    if (patch.status !== undefined && ["todo", "in_progress", "blocked", "done", "cancelled"].includes(patch.status)) task.status = patch.status;
    if (patch.priority !== undefined) task.priority = patch.priority;
    task.updatedAt = Date.now();
    updated = task;
    addEventToWorkspace(value, "task_updated", `${task.title} → ${task.status}`);
  });
  return workspace ? updated : null;
}

function addMilestone(ownerId, id, milestone = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    created = {
      id: "mile_" + crypto.randomUUID(),
      title: cleanText(milestone.title || "Untitled milestone", 240),
      description: cleanText(milestone.description, 1000),
      status: milestone.status || "planned",
      dueAt: milestone.dueAt || null,
      taskIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    value.milestones.push(created);
    addEventToWorkspace(value, "milestone_created", `Milestone added: ${created.title}`);
  });
  return workspace ? created : null;
}

function addEvidence(ownerId, id, evidence = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    created = {
      id: "evidence_" + crypto.randomUUID(),
      kind: cleanText(evidence.kind || "note", 40),
      title: cleanText(evidence.title || "Untitled evidence", 240),
      summary: cleanText(evidence.summary || evidence.text, 1200),
      url: safeHttpUrl(evidence.url),
      source: cleanText(evidence.source, 160) || "whatsapp",
      sensitivity: evidence.sensitivity || "normal",
      createdAt: Date.now(),
    };
    value.evidence.push(created);
    if (value.evidence.length > MAX_EVIDENCE) value.evidence = value.evidence.slice(-MAX_EVIDENCE);
    addEventToWorkspace(value, "evidence_added", `Evidence added: ${created.title}`);
  });
  return workspace ? created : null;
}

function addDecision(ownerId, id, decision = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    created = {
      id: "decision_" + crypto.randomUUID(),
      question: cleanText(decision.question || decision.title, 300),
      choice: cleanText(decision.choice || decision.decision, 600),
      rationale: cleanText(decision.rationale, 1200),
      alternatives: Array.isArray(decision.alternatives) ? decision.alternatives.map((v) => cleanText(v, 300)).filter(Boolean).slice(0, 10) : [],
      confidence: Number.isFinite(Number(decision.confidence)) ? Math.max(0, Math.min(100, Number(decision.confidence))) : null,
      reversible: decision.reversible !== false,
      status: decision.status || "recorded",
      createdAt: Date.now(),
    };
    value.decisions.push(created);
    if (value.decisions.length > MAX_DECISIONS) value.decisions = value.decisions.slice(-MAX_DECISIONS);
    addEventToWorkspace(value, "decision_recorded", `Decision recorded: ${created.choice || created.question}`);
  });
  return workspace ? created : null;
}

function markDigestSent(ownerId, id, at = Date.now()) {
  return mutate(ownerId, id, (workspace) => {
    workspace.digest = { ...(workspace.digest || {}), enabled: workspace.digest?.enabled !== false, cadence: workspace.digest?.cadence || "daily", lastSentAt: at };
    addEventToWorkspace(workspace, "digest_sent", "Sent a concise Atlas project briefing.");
  });
}

function linkMission(ownerId, id, missionId, taskId = null) {
  return mutate(ownerId, id, (workspace) => {
    const value = cleanText(missionId, 120);
    if (value && !workspace.missionIds.includes(value)) workspace.missionIds.push(value);
    if (taskId) {
      const task = workspace.tasks.find((candidate) => candidate.id === taskId);
      if (task) task.missionId = value;
    }
    addEventToWorkspace(workspace, "mission_linked", `Mission linked: ${value}`);
  });
}

function addEventToWorkspace(workspace, type, text) {
  if (!Array.isArray(workspace.events)) workspace.events = [];
  workspace.events.push({ id: crypto.randomUUID(), type, text: cleanText(text, 1000), at: Date.now(), source: "atlas" });
  if (workspace.events.length > MAX_EVENTS) workspace.events = workspace.events.slice(-MAX_EVENTS);
}

function getBrief(ownerId, idOrQuery = "") {
  const workspace = idOrQuery ? (getWorkspace(ownerId, idOrQuery) || findWorkspace(ownerId, idOrQuery)) : findWorkspace(ownerId);
  if (!workspace) return null;
  const nextTasks = workspace.tasks.filter((task) => ["todo", "in_progress"].includes(task.status)).slice(0, 5);
  const blocked = workspace.tasks.filter((task) => task.status === "blocked").slice(0, 5);
  const recent = (workspace.events || []).slice(-5).reverse();
  const recentDecisions = (workspace.decisions || []).slice(-3).reverse();
  return {
    workspace,
    nextTasks,
    blocked,
    recent,
    recentDecisions,
    progress: workspace.tasks.length ? Math.round((workspace.tasks.filter((task) => task.status === "done").length / workspace.tasks.length) * 100) : 0,
  };
}

function summary(brief) {
  if (!brief) return "I don’t have an active Atlas workspace yet. Say, “ARIA, this is a project: <name and outcome>.”";
  const { workspace, nextTasks, blocked, recentDecisions, progress } = brief;
  let text = `*${workspace.title}*\nOutcome: ${workspace.contract.outcome}\nProgress: ${progress}%`;
  if (workspace.contract.deadline) text += `\nDeadline: ${workspace.contract.deadline}`;
  text += "\n\n*Next:*" + (nextTasks.length ? "\n" + nextTasks.map((task) => `• ${task.title} [${task.status}]`).join("\n") : "\n• No open tasks yet.");
  if (blocked.length) text += "\n\n*Blocked:*\n" + blocked.map((task) => `• ${task.title}`).join("\n");
  if (recentDecisions.length) text += "\n\n*Recent decisions:*\n" + recentDecisions.map((decision) => `• ${decision.choice || decision.question}`).join("\n");
  return text;
}

module.exports = {
  ATLAS_DIR,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  findWorkspace,
  addEvent,
  addTask,
  updateTask,
  addMilestone,
  addEvidence,
  addDecision,
  markDigestSent,
  linkMission,
  getBrief,
  summary,
};
