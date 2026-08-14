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

function defaultSentinel() {
  return {
    version: 1,
    enabled: false,
    sources: { github: { repository: null }, render: { serviceId: null } },
    lastPassAt: 0,
    lastSignalAt: 0,
    lastNotifiedAt: 0,
  };
}

function normalizeWorkspace(workspace) {
  if (!workspace || typeof workspace !== "object") return workspace;
  workspace.signals = Array.isArray(workspace.signals) ? workspace.signals : [];
  workspace.briefs = Array.isArray(workspace.briefs) ? workspace.briefs : [];
  workspace.sentinel = {
    ...defaultSentinel(),
    ...(workspace.sentinel || {}),
    sources: {
      ...defaultSentinel().sources,
      ...(workspace.sentinel?.sources || {}),
      github: { ...defaultSentinel().sources.github, ...(workspace.sentinel?.sources?.github || {}) },
      render: { ...defaultSentinel().sources.render, ...(workspace.sentinel?.sources?.render || {}) },
    },
  };
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

function sentinelConfigValue(sentinel = {}) {
  const repoCandidate = cleanText(sentinel.sources?.github?.repository || sentinel.githubRepository, 160);
  const repo = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repoCandidate) ? repoCandidate : "";
  const serviceId = cleanText(sentinel.sources?.render?.serviceId || sentinel.renderServiceId, 120);
  return {
    version: 1,
    enabled: sentinel.enabled === true,
    sources: { github: { repository: repo || null }, render: { serviceId: serviceId || null } },
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
