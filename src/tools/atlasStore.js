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
const MAX_RISKS = 100;
const MAX_SIGNALS = 200;
const MAX_BRIEFS = 100;
const MAX_DELIVERIES = 120;
const MAX_EXECUTIONS = 60;
const MAX_RETROSPECTIVES = 60;
const MAX_OPERATOR_TEAMS = 20;
const MAX_TEAM_PACKETS = 5;
const MAX_TEAM_HANDOFFS = 30;
const MAX_KNOWLEDGE_NODES = 400;
const MAX_KNOWLEDGE_EDGES = 800;
const MAX_ARTIFACTS = 200;

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

function defaultIntegrationHealth(source) {
  return {
    source,
    status: "disabled",
    reasonCode: "not_configured",
    message: "Integration is not configured.",
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0,
    lastDeliveryId: null,
    lastEvent: null,
    lastHttpStatus: null,
    attempts: 0,
    successes: 0,
    failures: 0,
  };
}

function defaultSentinel() {
  return {
    version: 4,
    enabled: false,
    sources: { github: { repository: null }, render: { serviceId: null } },
    health: { github: defaultIntegrationHealth("github"), render: defaultIntegrationHealth("render") },
    deliveries: [],
    lastPassAt: 0,
    lastSignalAt: 0,
    lastNotifiedAt: 0,
  };
}

function normalizeWorkspace(workspace) {
  if (!workspace || typeof workspace !== "object") return workspace;
  workspace.signals = Array.isArray(workspace.signals) ? workspace.signals : [];
  workspace.briefs = Array.isArray(workspace.briefs) ? workspace.briefs : [];
  workspace.executions = Array.isArray(workspace.executions) ? workspace.executions.slice(-MAX_EXECUTIONS) : [];
  workspace.retrospectives = Array.isArray(workspace.retrospectives) ? workspace.retrospectives.slice(-MAX_RETROSPECTIVES) : [];
  workspace.operatorTeams = Array.isArray(workspace.operatorTeams) ? workspace.operatorTeams.slice(-MAX_OPERATOR_TEAMS).map(operatorTeamValue) : [];
  workspace.knowledgeNodes = Array.isArray(workspace.knowledgeNodes) ? workspace.knowledgeNodes.slice(-MAX_KNOWLEDGE_NODES).map(knowledgeNodeValue) : [];
  workspace.knowledgeEdges = Array.isArray(workspace.knowledgeEdges) ? workspace.knowledgeEdges.slice(-MAX_KNOWLEDGE_EDGES).map(knowledgeEdgeValue) : [];
  workspace.artifacts = Array.isArray(workspace.artifacts) ? workspace.artifacts.slice(-MAX_ARTIFACTS).map(artifactValue) : [];
  workspace.knowledgeRevision = Math.max(0, Number(workspace.knowledgeRevision) || 0);
  workspace.lastProjectedAt = Number(workspace.lastProjectedAt) || 0;
  const defaults = defaultSentinel();
  workspace.sentinel = {
    ...defaults,
    ...(workspace.sentinel || {}),
    sources: {
      ...defaults.sources,
      ...(workspace.sentinel?.sources || {}),
      github: { ...defaults.sources.github, ...(workspace.sentinel?.sources?.github || {}) },
      render: { ...defaults.sources.render, ...(workspace.sentinel?.sources?.render || {}) },
    },
    health: {
      ...defaults.health,
      ...(workspace.sentinel?.health || {}),
      github: { ...defaults.health.github, ...(workspace.sentinel?.health?.github || {}) },
      render: { ...defaults.health.render, ...(workspace.sentinel?.health?.render || {}) },
    },
    deliveries: Array.isArray(workspace.sentinel?.deliveries) ? workspace.sentinel.deliveries.slice(-MAX_DELIVERIES) : [],
  };
  workspace.sentinel = sentinelConfigValue(workspace.sentinel);
  return workspace;
}

function readWorkspace(id) {
  ensureDir();
  const file = fileFor(id);
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? normalizeWorkspace(value) : null;
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
    briefs: [],
    executions: [],
    retrospectives: [],
    operatorTeams: [],
    knowledgeNodes: [],
    knowledgeEdges: [],
    artifacts: [],
    knowledgeRevision: 0,
    lastProjectedAt: 0,
    sentinel: defaultSentinel(),
    missionIds: [],
    missionOutcomes: {},
    risks: [],
    planning: { version: 2, status: "unplanned", draft: null, generatedAt: 0, appliedAt: 0, appliedPlanId: null },
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
  normalizeWorkspace(workspace);
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

function taskValue(task = {}) {
  const priority = ["low", "normal", "high", "urgent"].includes(task.priority) ? task.priority : "normal";
  return {
    id: task.id || "task_" + crypto.randomUUID(),
    title: cleanText(task.title || task.text || "Untitled task", 240),
    description: cleanText(task.description, 1000),
    status: ["todo", "in_progress", "blocked", "done", "cancelled"].includes(task.status) ? task.status : "todo",
    priority,
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String).slice(0, 20) : [],
    milestoneId: task.milestoneId || null,
    missionId: task.missionId || null,
    evidenceIds: Array.isArray(task.evidenceIds) ? task.evidenceIds.slice(0, 30) : [],
    createdAt: task.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function addTask(ownerId, id, task = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    created = taskValue(task);
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

function addPlanDraft(ownerId, id, draft = {}) {
  let stored = null;
  const workspace = mutate(ownerId, id, (value) => {
    const normalized = {
      id: cleanText(draft.id || "plan_" + crypto.randomUUID(), 120),
      goal: cleanText(draft.goal || value.contract.outcome, 1000),
      assumptions: Array.isArray(draft.assumptions) ? draft.assumptions.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 20) : [],
      milestones: Array.isArray(draft.milestones) ? draft.milestones.slice(0, 20).map((milestone, index) => ({
        key: cleanText(milestone.key || `m${index + 1}`, 40),
        title: cleanText(milestone.title || `Milestone ${index + 1}`, 240),
        description: cleanText(milestone.description, 1000),
        dueAt: milestone.dueAt || null,
        dependsOn: Array.isArray(milestone.dependsOn) ? milestone.dependsOn.map((item) => cleanText(item, 40)).slice(0, 10) : [],
        tasks: Array.isArray(milestone.tasks) ? milestone.tasks.slice(0, 20).map((task) => ({
          key: cleanText(task.key || "task", 60),
          title: cleanText(task.title || "Untitled task", 240),
          description: cleanText(task.description, 1000),
          priority: task.priority,
          dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map((item) => cleanText(item, 60)).slice(0, 10) : [],
        })) : [],
      })) : [],
      risks: Array.isArray(draft.risks) ? draft.risks.slice(0, MAX_RISKS).map((risk, index) => ({
        key: cleanText(risk.key || `risk${index + 1}`, 60),
        title: cleanText(risk.title || "Unspecified risk", 240),
        likelihood: Math.max(1, Math.min(5, Number(risk.likelihood) || 3)),
        impact: Math.max(1, Math.min(5, Number(risk.impact) || 3)),
        mitigation: cleanText(risk.mitigation, 600),
      })) : [],
      generatedAt: Date.now(),
      status: "draft",
    };
    value.planning = { ...(value.planning || {}), version: 2, status: "draft", draft: normalized, generatedAt: normalized.generatedAt, appliedAt: 0, appliedPlanId: null };
    addEventToWorkspace(value, "plan_drafted", `Atlas drafted a ${normalized.milestones.length}-milestone roadmap.`);
    stored = normalized;
  });
  return workspace ? stored : null;
}

function applyPlan(ownerId, id, planId) {
  let applied = null;
  const workspace = mutate(ownerId, id, (value) => {
    const draft = value.planning?.draft;
    if (!draft || (planId && draft.id !== planId)) return;
    const milestoneIds = new Map();
    const taskIds = new Map();
    const existingTitles = new Map(value.tasks.map((task) => [task.title.toLowerCase(), task.id]));
    const createdMilestones = [];
    for (const milestone of draft.milestones || []) {
      const created = { id: "mile_" + crypto.randomUUID(), title: milestone.title, description: milestone.description, status: "planned", dueAt: milestone.dueAt || null, dependsOn: milestone.dependsOn || [], taskIds: [], createdAt: Date.now(), updatedAt: Date.now() };
      milestoneIds.set(milestone.key, created.id);
      value.milestones.push(created);
      createdMilestones.push(created);
    }
    for (const milestone of draft.milestones || []) {
      const createdMilestone = createdMilestones.find((item) => item.title === milestone.title);
      for (const task of milestone.tasks || []) {
        const existing = existingTitles.get(task.title.toLowerCase());
        const createdTask = existing ? value.tasks.find((item) => item.id === existing) : taskValue({ title: task.title, description: task.description, priority: task.priority, milestoneId: createdMilestone.id });
        if (!existing) value.tasks.push(createdTask);
        taskIds.set(`${milestone.key}:${task.key}`, createdTask.id);
        if (!taskIds.has(task.key)) taskIds.set(task.key, createdTask.id);
        createdMilestone.taskIds.push(createdTask.id);
      }
    }
    for (const milestone of draft.milestones || []) {
      for (const task of milestone.tasks || []) {
        const taskId = taskIds.get(`${milestone.key}:${task.key}`);
        const storedTask = value.tasks.find((item) => item.id === taskId);
        if (!storedTask) continue;
        storedTask.dependsOn = (task.dependsOn || []).map((dependency) => taskIds.get(`${milestone.key}:${dependency}`) || taskIds.get(dependency)).filter(Boolean).slice(0, 20);
        storedTask.milestoneId = milestoneIds.get(milestone.key) || storedTask.milestoneId;
      }
    }
    value.risks = [...(value.risks || []), ...(draft.risks || []).map((risk) => ({ id: "risk_" + crypto.randomUUID(), ...risk, score: risk.likelihood * risk.impact, status: "open", createdAt: Date.now(), updatedAt: Date.now() }))].slice(-MAX_RISKS);
    value.planning = { ...(value.planning || {}), status: "applied", draft: null, appliedAt: Date.now(), appliedPlanId: draft.id, generatedAt: draft.generatedAt };
    addEventToWorkspace(value, "plan_applied", `Applied Atlas roadmap: ${draft.milestones.length} milestone(s), ${value.tasks.length} task(s).`);
    applied = { planId: draft.id, milestoneIds: createdMilestones.map((item) => item.id), taskCount: value.tasks.length, riskCount: value.risks.length };
  });
  return workspace ? applied : null;
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

function addRisk(ownerId, id, risk = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    created = { id: "risk_" + crypto.randomUUID(), title: cleanText(risk.title || "Unspecified risk", 240), likelihood: Math.max(1, Math.min(5, Number(risk.likelihood) || 3)), impact: Math.max(1, Math.min(5, Number(risk.impact) || 3)), score: Math.max(1, Math.min(25, (Number(risk.likelihood) || 3) * (Number(risk.impact) || 3))), mitigation: cleanText(risk.mitigation, 600), status: "open", createdAt: Date.now(), updatedAt: Date.now() };
    value.risks = [...(value.risks || []), created].slice(-MAX_RISKS);
    addEventToWorkspace(value, "risk_added", `Risk added: ${created.title}`);
  });
  return workspace ? created : null;
}

function executionCheckpointValue(checkpoint = {}) {
  const statuses = ["pending", "running", "blocked", "done", "rejected", "cancelled"];
  return {
    id: cleanText(checkpoint.id || "checkpoint_" + crypto.randomUUID(), 120),
    title: cleanText(checkpoint.title || checkpoint.criterion || "Untitled checkpoint", 240),
    criterion: cleanText(checkpoint.criterion || checkpoint.title || "Acceptance criterion not defined.", 600),
    status: statuses.includes(checkpoint.status) ? checkpoint.status : "pending",
    evidenceIds: Array.isArray(checkpoint.evidenceIds) ? checkpoint.evidenceIds.map(String).slice(0, 30) : [],
    missionId: cleanText(checkpoint.missionId, 120) || null,
    note: cleanText(checkpoint.note, 800),
    startedAt: Number(checkpoint.startedAt) || 0,
    completedAt: Number(checkpoint.completedAt) || 0,
    updatedAt: Date.now(),
  };
}

function executionValue(execution = {}) {
  const lanes = ["research", "design", "build", "verify", "release"];
  const states = ["draft", "awaiting_approval", "running", "checkpoint", "blocked", "completed", "failed", "cancelled"];
  const checkpoints = Array.isArray(execution.checkpoints) ? execution.checkpoints.slice(0, 16).map(executionCheckpointValue) : [];
  return {
    id: cleanText(execution.id || "exec_" + crypto.randomUUID(), 120),
    taskId: cleanText(execution.taskId, 120) || null,
    missionId: cleanText(execution.missionId, 120) || null,
    lane: lanes.includes(execution.lane) ? execution.lane : "research",
    objective: cleanText(execution.objective || "Untitled execution", 800),
    state: states.includes(execution.state) ? execution.state : "draft",
    currentCheckpointIndex: Math.max(0, Number(execution.currentCheckpointIndex) || 0),
    checkpoints,
    proposedAction: cleanText(execution.proposedAction, 800),
    approval: execution.approval && typeof execution.approval === "object" ? {
      id: cleanText(execution.approval.id, 120) || null,
      prompt: cleanText(execution.approval.prompt, 800),
      expiresAt: Number(execution.approval.expiresAt) || 0,
      resolvedAt: Number(execution.approval.resolvedAt) || 0,
      decision: cleanText(execution.approval.decision, 40) || null,
    } : null,
    result: cleanText(execution.result, 1600),
    error: cleanText(execution.error, 800),
    recoveryProposal: cleanText(execution.recoveryProposal, 1000),
    retrospectiveId: cleanText(execution.retrospectiveId, 120) || null,
    lastReconciledStatus: cleanText(execution.lastReconciledStatus, 40) || null,
    lastReconciledAt: Number(execution.lastReconciledAt) || 0,
    createdAt: Number(execution.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

function addExecution(ownerId, id, execution = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    created = executionValue({ ...execution, workspaceId: id });
    value.executions.push(created);
    addEventToWorkspace(value, "execution_created", `Execution started in ${created.lane} lane: ${created.objective}`);
  });
  return workspace ? created : null;
}

function getExecution(ownerId, id, executionId) {
  const workspace = getWorkspace(ownerId, id);
  return workspace?.executions?.find((execution) => execution.id === executionId) || null;
}

function listExecutions(ownerId, id, options = {}) {
  const workspace = getWorkspace(ownerId, id);
  if (!workspace) return [];
  return workspace.executions.filter((execution) => !options.state || execution.state === options.state).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function updateExecution(ownerId, id, executionId, patch = {}) {
  let updated = null;
  const workspace = mutate(ownerId, id, (value) => {
    const current = value.executions.find((execution) => execution.id === executionId);
    if (!current) return;
    updated = executionValue({ ...current, ...patch, id: current.id, createdAt: current.createdAt });
    value.executions = value.executions.map((execution) => execution.id === executionId ? updated : execution);
    addEventToWorkspace(value, "execution_updated", `${updated.id} → ${updated.state}`);
  });
  return workspace ? updated : null;
}

function addRetrospective(ownerId, id, retrospective = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    created = {
      id: cleanText(retrospective.id || "retro_" + crypto.randomUUID(), 120),
      executionId: cleanText(retrospective.executionId, 120) || null,
      outcome: cleanText(retrospective.outcome || "Execution retrospective", 800),
      highlights: Array.isArray(retrospective.highlights) ? retrospective.highlights.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 12) : [],
      failures: Array.isArray(retrospective.failures) ? retrospective.failures.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, 12) : [],
      nextImprovement: cleanText(retrospective.nextImprovement, 800),
      createdAt: Date.now(),
    };
    value.retrospectives.push(created);
    value.retrospectives = value.retrospectives.slice(-MAX_RETROSPECTIVES);
    addEventToWorkspace(value, "retrospective_added", `Retrospective recorded for ${created.executionId || "execution"}.`);
  });
  return workspace ? created : null;
}

function operatorPacketValue(packet = {}) {
  const statuses = ["pending", "awaiting_approval", "running", "completed", "blocked", "needs_review", "skipped"];
  return {
    id: cleanText(packet.id || "packet_" + crypto.randomUUID(), 120),
    role: cleanText(packet.role || "researcher", 60),
    status: statuses.includes(packet.status) ? packet.status : "pending",
    objective: cleanText(packet.objective, 800),
    criterion: cleanText(packet.criterion, 800),
    inputHandoffIds: Array.isArray(packet.inputHandoffIds) ? packet.inputHandoffIds.map(String).slice(0, 12) : [],
    missionId: cleanText(packet.missionId, 120) || null,
    outputHandoffId: cleanText(packet.outputHandoffId, 120) || null,
    evidenceIds: Array.isArray(packet.evidenceIds) ? packet.evidenceIds.map(String).slice(0, 30) : [],
    attempts: Math.max(0, Number(packet.attempts) || 0),
    maxAttempts: Math.max(1, Math.min(3, Number(packet.maxAttempts) || 2)),
    timeoutMs: Math.max(1000, Math.min(15 * 60 * 1000, Number(packet.timeoutMs) || 15 * 60 * 1000)),
    startedAt: Number(packet.startedAt) || 0,
    completedAt: Number(packet.completedAt) || 0,
    blockedReason: cleanText(packet.blockedReason, 800),
    recoveryProposal: cleanText(packet.recoveryProposal, 1000),
    result: cleanText(packet.result, 4000),
    lastReconciledStatus: cleanText(packet.lastReconciledStatus, 40) || null,
    lastReconciledAt: Number(packet.lastReconciledAt) || 0,
    updatedAt: Date.now(),
  };
}

function operatorHandoffValue(handoff = {}) {
  return {
    id: cleanText(handoff.id || "handoff_" + crypto.randomUUID(), 120),
    fromRole: cleanText(handoff.fromRole, 60),
    toRole: cleanText(handoff.toRole, 60),
    summary: cleanText(handoff.summary, 4000),
    evidenceIds: Array.isArray(handoff.evidenceIds) ? handoff.evidenceIds.map(String).slice(0, 30) : [],
    decisions: Array.isArray(handoff.decisions) ? handoff.decisions.map((item) => cleanText(item, 400)).filter(Boolean).slice(0, 12) : [],
    unresolvedQuestions: Array.isArray(handoff.unresolvedQuestions) ? handoff.unresolvedQuestions.map((item) => cleanText(item, 400)).filter(Boolean).slice(0, 12) : [],
    status: ["accepted", "needs_review", "blocked"].includes(handoff.status) ? handoff.status : "accepted",
    createdAt: Number(handoff.createdAt) || Date.now(),
  };
}

function safeRelativePath(value) {
  const raw = cleanText(value, 500).replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) return null;
  const normalized = path.posix.normalize(raw);
  return normalized === "." || normalized.startsWith("../") || normalized.includes("/../") ? null : normalized;
}

function knowledgeNodeValue(node = {}) {
  const types = ["requirement", "decision", "risk", "task", "evidence", "artifact", "execution", "external_reference"];
  const freshness = ["fresh", "stale", "unknown", "superseded"];
  const status = ["active", "archived", "stale", "superseded"];
  return {
    id: cleanText(node.id || "node_" + crypto.randomUUID(), 120),
    type: types.includes(node.type) ? node.type : "external_reference",
    title: cleanText(node.title || "Untitled knowledge", 240),
    summary: cleanText(node.summary, 1600),
    status: status.includes(node.status) ? node.status : "active",
    freshness: freshness.includes(node.freshness) ? node.freshness : "unknown",
    sourceType: cleanText(node.sourceType, 60) || null,
    sourceId: cleanText(node.sourceId, 160) || null,
    artifactIds: Array.isArray(node.artifactIds) ? node.artifactIds.map(String).slice(0, 30) : [],
    confidence: Math.max(0, Math.min(100, Number.isFinite(Number(node.confidence)) ? Number(node.confidence) : 50)),
    sensitivity: ["normal", "private", "secret"].includes(node.sensitivity) ? node.sensitivity : "normal",
    sourceUpdatedAt: Number(node.sourceUpdatedAt) || 0,
    lastSeenAt: Number(node.lastSeenAt) || Date.now(),
    createdAt: Number(node.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

function knowledgeEdgeValue(edge = {}) {
  const types = ["supports", "contradicts", "depends_on", "produced_by", "derived_from", "satisfies", "blocks", "supersedes", "references", "related_to"];
  return {
    id: cleanText(edge.id || "edge_" + crypto.randomUUID(), 120),
    type: types.includes(edge.type) ? edge.type : "related_to",
    sourceId: cleanText(edge.sourceId, 120),
    targetId: cleanText(edge.targetId, 120),
    rationale: cleanText(edge.rationale, 800),
    provenanceIds: Array.isArray(edge.provenanceIds) ? edge.provenanceIds.map(String).slice(0, 20) : [],
    confidence: Math.max(0, Math.min(100, Number.isFinite(Number(edge.confidence)) ? Number(edge.confidence) : 50)),
    createdAt: Number(edge.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

function artifactValue(artifact = {}) {
  const statuses = ["active", "stale", "superseded", "archived"];
  const freshness = ["fresh", "stale", "unknown", "superseded"];
  return {
    id: cleanText(artifact.id || "artifact_" + crypto.randomUUID(), 120),
    kind: cleanText(artifact.kind || "output", 60),
    title: cleanText(artifact.title || "Untitled artifact", 240),
    summary: cleanText(artifact.summary, 1600),
    url: safeHttpUrl(artifact.url),
    localPath: safeRelativePath(artifact.localPath),
    contentType: cleanText(artifact.contentType, 120) || null,
    size: Math.max(0, Number(artifact.size) || 0),
    checksum: cleanText(artifact.checksum, 160) || null,
    sourceType: cleanText(artifact.sourceType, 60) || null,
    sourceId: cleanText(artifact.sourceId, 160) || null,
    sourceRole: cleanText(artifact.sourceRole, 60) || null,
    relatedNodeIds: Array.isArray(artifact.relatedNodeIds) ? artifact.relatedNodeIds.map(String).slice(0, 30) : [],
    status: statuses.includes(artifact.status) ? artifact.status : "active",
    freshness: freshness.includes(artifact.freshness) ? artifact.freshness : "unknown",
    sensitivity: ["normal", "private", "secret"].includes(artifact.sensitivity) ? artifact.sensitivity : "normal",
    createdAt: Number(artifact.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

function bumpKnowledge(workspace, projectedAt = 0) {
  workspace.knowledgeRevision = (Number(workspace.knowledgeRevision) || 0) + 1;
  if (projectedAt) workspace.lastProjectedAt = Number(projectedAt) || Date.now();
}

function upsertKnowledgeNode(ownerId, id, node = {}) {
  let result = null;
  const workspace = mutate(ownerId, id, (value) => {
    const normalized = knowledgeNodeValue(node);
    const existing = value.knowledgeNodes.find((item) => item.id === normalized.id || (normalized.sourceType && normalized.sourceId && item.sourceType === normalized.sourceType && item.sourceId === normalized.sourceId));
    if (existing) {
      const candidate = { ...existing, ...normalized, id: existing.id, createdAt: existing.createdAt, lastSeenAt: existing.lastSeenAt, updatedAt: existing.updatedAt };
      const changed = JSON.stringify({ ...existing, updatedAt: 0 }) !== JSON.stringify({ ...candidate, updatedAt: 0 });
      result = changed ? { ...candidate, lastSeenAt: Date.now(), updatedAt: Date.now() } : existing;
      if (changed) {
        value.knowledgeNodes = value.knowledgeNodes.map((item) => item.id === existing.id ? result : item);
        bumpKnowledge(value);
      }
    } else {
      result = normalized;
      value.knowledgeNodes.push(result);
      value.knowledgeNodes = value.knowledgeNodes.slice(-MAX_KNOWLEDGE_NODES);
      bumpKnowledge(value);
    }
  });
  return workspace ? result : null;
}

function getKnowledgeNode(ownerId, id, nodeId) {
  const workspace = getWorkspace(ownerId, id);
  return workspace?.knowledgeNodes?.find((node) => node.id === nodeId) || null;
}

function listKnowledgeNodes(ownerId, id, options = {}) {
  const workspace = getWorkspace(ownerId, id);
  if (!workspace) return [];
  return workspace.knowledgeNodes.filter((node) => (!options.type || node.type === options.type) && (!options.status || node.status === options.status) && (!options.freshness || node.freshness === options.freshness)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function addKnowledgeEdge(ownerId, id, edge = {}) {
  let result = null;
  const workspace = mutate(ownerId, id, (value) => {
    const normalized = knowledgeEdgeValue(edge);
    if (!normalized.sourceId || !normalized.targetId || normalized.sourceId === normalized.targetId) return;
    if (!value.knowledgeNodes.some((node) => node.id === normalized.sourceId) || !value.knowledgeNodes.some((node) => node.id === normalized.targetId)) return;
    const existing = value.knowledgeEdges.find((item) => item.type === normalized.type && item.sourceId === normalized.sourceId && item.targetId === normalized.targetId);
    if (existing) { result = { edge: existing, duplicate: true }; return; }
    value.knowledgeEdges.push(normalized);
    value.knowledgeEdges = value.knowledgeEdges.slice(-MAX_KNOWLEDGE_EDGES);
    bumpKnowledge(value);
    result = { edge: normalized, duplicate: false };
  });
  return workspace ? result : null;
}

function listKnowledgeEdges(ownerId, id, options = {}) {
  const workspace = getWorkspace(ownerId, id);
  if (!workspace) return [];
  return workspace.knowledgeEdges.filter((edge) => (!options.nodeId || edge.sourceId === options.nodeId || edge.targetId === options.nodeId) && (!options.type || edge.type === options.type));
}

function addArtifact(ownerId, id, artifact = {}) {
  let result = null;
  const workspace = mutate(ownerId, id, (value) => {
    const normalized = artifactValue(artifact);
    const duplicate = value.artifacts.find((item) => (normalized.checksum && item.checksum === normalized.checksum) || (normalized.url && item.url === normalized.url) || (normalized.localPath && item.localPath === normalized.localPath));
    if (duplicate) { result = { artifact: duplicate, duplicate: true }; return; }
    value.artifacts.push(normalized);
    value.artifacts = value.artifacts.slice(-MAX_ARTIFACTS);
    bumpKnowledge(value);
    result = { artifact: normalized, duplicate: false };
  });
  return workspace ? result : null;
}

function getArtifact(ownerId, id, artifactId) {
  const workspace = getWorkspace(ownerId, id);
  return workspace?.artifacts?.find((artifact) => artifact.id === artifactId) || null;
}

function listArtifacts(ownerId, id, options = {}) {
  const workspace = getWorkspace(ownerId, id);
  if (!workspace) return [];
  return workspace.artifacts.filter((artifact) => (!options.status || artifact.status === options.status) && (!options.freshness || artifact.freshness === options.freshness)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function updateKnowledgeMeta(ownerId, id, patch = {}) {
  return mutate(ownerId, id, (workspace) => {
    if (patch.lastProjectedAt !== undefined) workspace.lastProjectedAt = Number(patch.lastProjectedAt) || Date.now();
    if (patch.bump) bumpKnowledge(workspace, patch.lastProjectedAt);
  });
}

function operatorTeamValue(team = {}) {
  const states = ["draft", "awaiting_approval", "running", "paused", "blocked", "completed", "cancelled"];
  const packets = Array.isArray(team.packets || team.rolePackets) ? (team.packets || team.rolePackets).slice(0, MAX_TEAM_PACKETS).map(operatorPacketValue) : [];
  const handoffs = Array.isArray(team.handoffs) ? team.handoffs.slice(-MAX_TEAM_HANDOFFS).map(operatorHandoffValue) : [];
  return {
    id: cleanText(team.id || "team_" + crypto.randomUUID(), 120),
    objective: cleanText(team.objective || "Untitled operator team", 800),
    state: states.includes(team.state) ? team.state : "draft",
    currentPacketIndex: Math.max(0, Math.min(Math.max(0, packets.length - 1), Number(team.currentPacketIndex) || 0)),
    packets,
    handoffs,
    budgets: {
      maxPackets: Math.max(1, Math.min(MAX_TEAM_PACKETS, Number(team.budgets?.maxPackets) || MAX_TEAM_PACKETS)),
      maxAttemptsPerPacket: Math.max(1, Math.min(3, Number(team.budgets?.maxAttemptsPerPacket) || 2)),
      maxDurationMs: Math.max(60 * 1000, Math.min(60 * 60 * 1000, Number(team.budgets?.maxDurationMs) || 15 * 60 * 1000)),
      maxOutputChars: Math.max(500, Math.min(8000, Number(team.budgets?.maxOutputChars) || 4000)),
    },
    approval: team.approval && typeof team.approval === "object" ? {
      id: cleanText(team.approval.id, 120) || null,
      prompt: cleanText(team.approval.prompt, 1000),
      decision: cleanText(team.approval.decision, 40) || null,
      expiresAt: Number(team.approval.expiresAt) || 0,
      resolvedAt: Number(team.approval.resolvedAt) || 0,
    } : null,
    blockedReason: cleanText(team.blockedReason, 1000),
    recoveryProposal: cleanText(team.recoveryProposal, 1200),
    retrospectiveId: cleanText(team.retrospectiveId, 120) || null,
    createdAt: Number(team.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

function addOperatorTeam(ownerId, id, team = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    created = operatorTeamValue({ ...team, id: team.id || "team_" + crypto.randomUUID() });
    value.operatorTeams.push(created);
    value.operatorTeams = value.operatorTeams.slice(-MAX_OPERATOR_TEAMS);
    addEventToWorkspace(value, "operator_team_created", `Operator team created: ${created.objective}`);
  });
  return workspace ? created : null;
}

function getOperatorTeam(ownerId, id, teamId) {
  const workspace = getWorkspace(ownerId, id);
  return workspace?.operatorTeams?.find((team) => team.id === teamId) || null;
}

function listOperatorTeams(ownerId, id, options = {}) {
  const workspace = getWorkspace(ownerId, id);
  if (!workspace) return [];
  return workspace.operatorTeams.filter((team) => !options.state || team.state === options.state).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function updateOperatorTeam(ownerId, id, teamId, patch = {}) {
  let updated = null;
  const workspace = mutate(ownerId, id, (value) => {
    const current = value.operatorTeams.find((team) => team.id === teamId);
    if (!current) return;
    updated = operatorTeamValue({ ...current, ...patch, id: current.id, createdAt: current.createdAt });
    value.operatorTeams = value.operatorTeams.map((team) => team.id === teamId ? updated : team);
    addEventToWorkspace(value, "operator_team_updated", `${updated.id} → ${updated.state}`);
  });
  return workspace ? updated : null;
}

function addOperatorHandoff(ownerId, id, teamId, handoff = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    const team = value.operatorTeams.find((item) => item.id === teamId);
    if (!team) return;
    created = operatorHandoffValue(handoff);
    team.handoffs = [...(team.handoffs || []), created].slice(-MAX_TEAM_HANDOFFS);
    team.updatedAt = Date.now();
    addEventToWorkspace(value, "operator_handoff_created", `${created.fromRole} handed work to ${created.toRole}.`);
  });
  return workspace ? created : null;
}

function healthValue(source, health = {}) {
  const statuses = ["disabled", "unconfigured", "healthy", "attention", "misconfigured"];
  return {
    ...defaultIntegrationHealth(source),
    ...health,
    source,
    status: statuses.includes(health.status) ? health.status : "attention",
    reasonCode: cleanText(health.reasonCode || "unknown", 80),
    message: cleanText(health.message || "Integration needs review.", 240),
    lastAttemptAt: Number(health.lastAttemptAt) || 0,
    lastSuccessAt: Number(health.lastSuccessAt) || 0,
    lastFailureAt: Number(health.lastFailureAt) || 0,
    lastDeliveryId: cleanText(health.lastDeliveryId, 160) || null,
    lastEvent: cleanText(health.lastEvent, 80) || null,
    lastHttpStatus: Number(health.lastHttpStatus) || null,
    attempts: Math.max(0, Number(health.attempts) || 0),
    successes: Math.max(0, Number(health.successes) || 0),
    failures: Math.max(0, Number(health.failures) || 0),
  };
}

function deliveryValue(delivery = {}) {
  const source = ["github", "render"].includes(delivery.source) ? delivery.source : "local";
  const statuses = ["accepted", "duplicate", "rejected", "failed", "ignored"];
  return {
    id: cleanText(delivery.id || "delivery_" + crypto.randomUUID(), 120),
    source,
    deliveryId: cleanText(delivery.deliveryId, 160) || null,
    eventName: cleanText(delivery.eventName || delivery.kind || "event", 80),
    status: statuses.includes(delivery.status) ? delivery.status : "failed",
    reasonCode: cleanText(delivery.reasonCode || "unknown", 80),
    httpStatus: Number(delivery.httpStatus) || null,
    receivedAt: Number(delivery.receivedAt) || Date.now(),
    durationMs: Math.max(0, Number(delivery.durationMs) || 0),
    workspaceId: cleanText(delivery.workspaceId, 120) || null,
    signaturePresent: delivery.signaturePresent === true,
    rawBodyAvailable: delivery.rawBodyAvailable === true,
    detail: cleanText(delivery.detail, 300),
  };
}

function sentinelConfigValue(sentinel = {}) {
  const repoCandidate = cleanText(sentinel.sources?.github?.repository || sentinel.githubRepository, 160);
  const repo = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repoCandidate) ? repoCandidate : "";
  const serviceId = cleanText(sentinel.sources?.render?.serviceId || sentinel.renderServiceId, 120);
  const enabled = sentinel.enabled === true;
  const health = {
    github: healthValue("github", sentinel.health?.github),
    render: healthValue("render", sentinel.health?.render),
  };
  for (const source of ["github", "render"]) {
    const configured = source === "github" ? Boolean(repo) : Boolean(serviceId);
    if (!enabled) {
      health[source] = healthValue(source, { ...health[source], status: "disabled", reasonCode: "sentinel_disabled", message: "Sentinel is disabled." });
    } else if (!configured) {
      health[source] = healthValue(source, { ...health[source], status: "unconfigured", reasonCode: "source_unconfigured", message: `No ${source} source is mapped to this workspace.` });
    } else if (health[source].status === "disabled" || health[source].reasonCode === "not_configured") {
      health[source] = healthValue(source, { ...health[source], status: "attention", reasonCode: "awaiting_first_delivery", message: `${source} is mapped and waiting for its first verified delivery.` });
    }
  }
  return {
    version: 4,
    enabled,
    sources: { github: { repository: repo || null }, render: { serviceId: serviceId || null } },
    health,
    deliveries: Array.isArray(sentinel.deliveries) ? sentinel.deliveries.slice(-MAX_DELIVERIES).map(deliveryValue) : [],
    lastPassAt: Number(sentinel.lastPassAt) || 0,
    lastSignalAt: Number(sentinel.lastSignalAt) || 0,
    lastNotifiedAt: Number(sentinel.lastNotifiedAt) || 0,
  };
}

function configureSentinel(ownerId, id, patch = {}) {
  let configured = null;
  const workspace = mutate(ownerId, id, (value) => {
    value.sentinel = sentinelConfigValue({ ...(value.sentinel || {}), ...patch, sources: { ...(value.sentinel?.sources || {}), ...(patch.sources || {}) } });
    addEventToWorkspace(value, "sentinel_configured", `Sentinel ${value.sentinel.enabled ? "enabled" : "disabled"} for ${value.title}.`);
    configured = value.sentinel;
  });
  return workspace ? configured : null;
}

function findSentinelWorkspace(ownerId, source, identity = "") {
  const workspaces = listWorkspaces(ownerId, { state: "active" });
  const term = cleanText(identity, 180).toLowerCase();
  return workspaces.find((workspace) => {
    if (!workspace.sentinel?.enabled) return false;
    if (source === "github") return !term || String(workspace.sentinel.sources?.github?.repository || "").toLowerCase() === term;
    if (source === "render") return !term || String(workspace.sentinel.sources?.render?.serviceId || "") === String(identity || "");
    return false;
  }) || null;
}

function recordSentinelDelivery(ownerId, id, delivery = {}) {
  let result = null;
  const workspace = mutate(ownerId, id, (value) => {
    const incoming = deliveryValue({ ...delivery, workspaceId: id });
    const duplicate = incoming.deliveryId && value.sentinel.deliveries.find((item) => item.source === incoming.source && item.deliveryId === incoming.deliveryId);
    if (duplicate) {
      result = { delivery: duplicate, duplicate: true, health: value.sentinel.health[incoming.source] };
      return;
    }
    value.sentinel.deliveries.push(incoming);
    value.sentinel.deliveries = value.sentinel.deliveries.slice(-MAX_DELIVERIES);
    const previous = value.sentinel.health[incoming.source] || defaultIntegrationHealth(incoming.source);
    const accepted = incoming.status === "accepted" || incoming.status === "duplicate";
    const health = healthValue(incoming.source, {
      ...previous,
      status: accepted ? "healthy" : (incoming.reasonCode === "missing_secret" || incoming.reasonCode === "invalid_signature" ? "misconfigured" : "attention"),
      reasonCode: accepted ? "delivery_accepted" : incoming.reasonCode,
      message: accepted ? "Verified deliveries are arriving." : incoming.detail || "The provider delivery needs review.",
      lastAttemptAt: incoming.receivedAt,
      lastSuccessAt: accepted ? incoming.receivedAt : previous.lastSuccessAt,
      lastFailureAt: accepted ? previous.lastFailureAt : incoming.receivedAt,
      lastDeliveryId: incoming.deliveryId,
      lastEvent: incoming.eventName,
      lastHttpStatus: incoming.httpStatus,
      attempts: previous.attempts + 1,
      successes: previous.successes + (accepted ? 1 : 0),
      failures: previous.failures + (accepted ? 0 : 1),
    });
    value.sentinel.health[incoming.source] = health;
    addEventToWorkspace(value, "sentinel_delivery", `${incoming.source} delivery ${incoming.status}: ${incoming.reasonCode}`);
    result = { delivery: incoming, duplicate: false, health };
  });
  return workspace ? result : null;
}

function recordSentinelDeliveryForSource(ownerId, source, identity, delivery = {}) {
  const workspace = findSentinelWorkspace(ownerId, source, identity);
  return workspace ? recordSentinelDelivery(ownerId, workspace.id, { ...delivery, source }) : null;
}

function signalValue(signal = {}) {
  const severity = ["info", "low", "medium", "high", "critical"].includes(signal.severity) ? signal.severity : "info";
  const status = ["new", "acknowledged", "resolved", "ignored"].includes(signal.status) ? signal.status : "new";
  return {
    id: cleanText(signal.id || "signal_" + crypto.randomUUID(), 120),
    source: cleanText(signal.source || "local", 40),
    kind: cleanText(signal.kind || "generic", 60),
    action: cleanText(signal.action, 60),
    sourceId: cleanText(signal.sourceId, 160),
    dedupeKey: cleanText(signal.dedupeKey || signal.sourceId || signal.id, 240),
    title: cleanText(signal.title || "Sentinel signal", 240),
    summary: cleanText(signal.summary || signal.detail, 1200),
    severity,
    status,
    at: Number(signal.at) || Date.now(),
    receivedAt: Number(signal.receivedAt) || Date.now(),
    evidenceId: cleanText(signal.evidenceId, 120) || null,
    riskId: cleanText(signal.riskId, 120) || null,
    briefId: cleanText(signal.briefId, 120) || null,
    notifiedAt: Number(signal.notifiedAt) || 0,
    acknowledgedAt: Number(signal.acknowledgedAt) || 0,
    resolvedAt: Number(signal.resolvedAt) || 0,
  };
}

function recordSignal(ownerId, id, signal = {}) {
  let result = null;
  const workspace = mutate(ownerId, id, (value) => {
    const incoming = signalValue(signal);
    const duplicate = value.signals.find((item) => incoming.dedupeKey && item.dedupeKey === incoming.dedupeKey);
    if (duplicate) {
      result = { signal: duplicate, duplicate: true };
      return;
    }
    value.signals.push(incoming);
    if (value.signals.length > MAX_SIGNALS) value.signals = value.signals.slice(-MAX_SIGNALS);
    value.sentinel.lastSignalAt = incoming.receivedAt;
    addEventToWorkspace(value, "sentinel_signal", `${incoming.source}/${incoming.kind}: ${incoming.title}`);
    result = { signal: incoming, duplicate: false };
  });
  return workspace ? result : null;
}

function addBrief(ownerId, id, brief = {}) {
  let created = null;
  const workspace = mutate(ownerId, id, (value) => {
    const sourceSignalId = cleanText(brief.sourceSignalId, 120) || null;
    const duplicate = sourceSignalId && value.briefs.find((item) => item.sourceSignalId === sourceSignalId);
    if (duplicate) {
      created = duplicate;
      return;
    }
    created = {
      id: cleanText(brief.id || "brief_" + crypto.randomUUID(), 120),
      sourceSignalId,
      title: cleanText(brief.title || "Sentinel decision brief", 240),
      impact: cleanText(brief.impact, 800),
      recommendation: cleanText(brief.recommendation, 1000),
      actionLevel: ["observe", "prepare", "propose", "commit"].includes(brief.actionLevel) ? brief.actionLevel : "observe",
      status: ["proposed", "acknowledged", "approved", "rejected", "resolved"].includes(brief.status) ? brief.status : "proposed",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      acknowledgedAt: 0,
      approvedAt: 0,
      resolvedAt: 0,
    };
    value.briefs.push(created);
    if (value.briefs.length > MAX_BRIEFS) value.briefs = value.briefs.slice(-MAX_BRIEFS);
    if (sourceSignalId) {
      const signal = value.signals.find((item) => item.id === sourceSignalId);
      if (signal) signal.briefId = created.id;
    }
    addEventToWorkspace(value, "sentinel_brief", `Decision brief: ${created.title}`);
  });
  return workspace ? created : null;
}

function updateSignal(ownerId, id, signalId, patch = {}) {
  let updated = null;
  const workspace = mutate(ownerId, id, (value) => {
    const signal = value.signals.find((item) => item.id === signalId);
    if (!signal) return;
    const next = patch.status;
    if (next && ["new", "acknowledged", "resolved", "ignored"].includes(next)) {
      signal.status = next;
      if (next === "acknowledged") signal.acknowledgedAt = Date.now();
      if (next === "resolved") signal.resolvedAt = Date.now();
    }
    if (patch.notifiedAt !== undefined) signal.notifiedAt = Number(patch.notifiedAt) || 0;
    for (const key of ["evidenceId", "riskId", "briefId"]) {
      if (patch[key] !== undefined) signal[key] = cleanText(patch[key], 120) || null;
    }
    updated = signal;
    addEventToWorkspace(value, "sentinel_signal_updated", `${signal.title} → ${signal.status}`);
  });
  return workspace ? updated : null;
}

function updateBrief(ownerId, id, briefId, patch = {}) {
  let updated = null;
  const workspace = mutate(ownerId, id, (value) => {
    const brief = value.briefs.find((item) => item.id === briefId);
    if (!brief) return;
    const next = patch.status;
    if (next && ["proposed", "acknowledged", "approved", "rejected", "resolved"].includes(next)) {
      brief.status = next;
      brief.updatedAt = Date.now();
      if (next === "acknowledged") brief.acknowledgedAt = Date.now();
      if (next === "approved") brief.approvedAt = Date.now();
      if (next === "resolved") brief.resolvedAt = Date.now();
    }
    updated = brief;
    addEventToWorkspace(value, "sentinel_brief_updated", `${brief.title} → ${brief.status}`);
  });
  return workspace ? updated : null;
}

function updateRisk(ownerId, id, riskId, patch = {}) {
  let updated = null;
  const workspace = mutate(ownerId, id, (value) => {
    const risk = value.risks.find((item) => item.id === riskId);
    if (!risk) return;
    if (patch.status && ["open", "mitigated", "accepted", "closed"].includes(patch.status)) risk.status = patch.status;
    risk.updatedAt = Date.now();
    updated = risk;
    addEventToWorkspace(value, "risk_updated", `${risk.title} → ${risk.status}`);
  });
  return workspace ? updated : null;
}

function markSentinelPass(ownerId, id, at = Date.now()) {
  return mutate(ownerId, id, (value) => {
    value.sentinel.lastPassAt = Number(at) || Date.now();
  });
}

function getSentinelHealth(ownerId, id) {
  const workspace = getWorkspace(ownerId, id);
  if (!workspace) return null;
  return { health: workspace.sentinel.health, deliveries: workspace.sentinel.deliveries.slice(-MAX_DELIVERIES) };
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

function reconcileMission(ownerId, id, missionId, outcome = {}) {
  let reconciliation = null;
  const workspace = mutate(ownerId, id, (value) => {
    const key = cleanText(missionId, 120);
    if (!key) return;
    value.missionOutcomes = value.missionOutcomes || {};
    if (value.missionOutcomes[key]) {
      reconciliation = value.missionOutcomes[key];
      return;
    }
    const status = cleanText(outcome.status || "unknown", 40);
    const task = value.tasks.find((candidate) => candidate.missionId === key);
    if (task) {
      const nextStatus = status === "completed" ? "done" : ["failed", "needs_review"].includes(status) ? "blocked" : ["cancelled"].includes(status) ? "cancelled" : "in_progress";
      task.status = nextStatus;
      task.updatedAt = Date.now();
    }
    const evidence = {
      id: "evidence_" + crypto.randomUUID(),
      kind: "mission_outcome",
      title: cleanText(outcome.title || `Mission ${key} outcome`, 240),
      summary: cleanText(outcome.result || outcome.error || outcome.progress || `Mission status: ${status}`, 1200),
      url: null,
      source: "durable-mission",
      sensitivity: "normal",
      createdAt: Date.now(),
    };
    value.evidence.push(evidence);
    if (value.evidence.length > MAX_EVIDENCE) value.evidence = value.evidence.slice(-MAX_EVIDENCE);
    if (["failed", "needs_review"].includes(status)) {
      value.risks = [...(value.risks || []), { id: "risk_" + crypto.randomUUID(), title: cleanText(outcome.error || `Mission ${key} needs review`, 240), likelihood: 3, impact: 4, score: 12, mitigation: "Review the mission trace and decide whether to retry, revise, or cancel the task.", status: "open", createdAt: Date.now(), updatedAt: Date.now() }].slice(-MAX_RISKS);
    }
    reconciliation = { missionId: key, status, taskId: task?.id || null, evidenceId: evidence.id, reconciledAt: Date.now() };
    value.missionOutcomes[key] = reconciliation;
    addEventToWorkspace(value, "mission_reconciled", `Mission ${key} reconciled as ${status}${task ? ` → ${task.title}` : ""}.`);
  });
  return workspace ? reconciliation : null;
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
  addPlanDraft,
  applyPlan,
  addRisk,
  configureSentinel,
  addExecution,
  getExecution,
  listExecutions,
  updateExecution,
  addRetrospective,
  addOperatorTeam,
  getOperatorTeam,
  listOperatorTeams,
  updateOperatorTeam,
  addOperatorHandoff,
  upsertKnowledgeNode,
  getKnowledgeNode,
  listKnowledgeNodes,
  addKnowledgeEdge,
  listKnowledgeEdges,
  addArtifact,
  getArtifact,
  listArtifacts,
  updateKnowledgeMeta,
  recordSentinelDelivery,
  recordSentinelDeliveryForSource,
  getSentinelHealth,
  recordSignal,
  addBrief,
  updateSignal,
  updateBrief,
  updateRisk,
  markSentinelPass,
  reconcileMission,
  markDigestSent,
  linkMission,
  getBrief,
  summary,
};
