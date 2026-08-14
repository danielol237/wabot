// Atlas V5 Execution Core: durable, approval-aware execution lanes attached to
// Atlas workspaces and the existing durable mission engine.

const atlas = require("./atlasStore");
const missions = require("./durableMissions");
const crypto = require("crypto");

const LANES = ["research", "design", "build", "verify", "release"];
const READ_ONLY_LANES = new Set(["research", "verify"]);
const ACTIVE_STATES = new Set(["awaiting_approval", "running", "checkpoint"]);

function ownerKey(ownerId) {
  return String(ownerId || "").trim();
}

function laneValue(value) {
  const lane = String(value || "research").toLowerCase().trim();
  return LANES.includes(lane) ? lane : "research";
}

function clean(value, max = 800) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function defaultCheckpoints(objective, lane) {
  const name = clean(objective || "execution", 180);
  if (lane === "research") return [
    { title: "Collect evidence", criterion: `Gather relevant facts for: ${name}` },
    { title: "Summarize findings", criterion: "Record a concise, source-backed finding and unresolved questions." },
  ];
  if (lane === "verify") return [
    { title: "Run verification", criterion: `Run the agreed checks for: ${name}` },
    { title: "Record acceptance evidence", criterion: "Attach results and state whether the acceptance criterion passed." },
  ];
  return [
    { title: "Prepare execution", criterion: `Define the bounded change for: ${name}` },
    { title: "Owner checkpoint", criterion: "Review the proposed action and confirm the next step." },
    { title: "Verify outcome", criterion: "Collect evidence that the intended outcome was achieved." },
  ];
}

function findWorkspace(ownerId, workspaceId) {
  return workspaceId ? atlas.getWorkspace(ownerId, workspaceId) : atlas.findWorkspace(ownerId);
}

function getRun(ownerId, workspaceId, executionId) {
  return atlas.getExecution(ownerId, workspaceId, executionId);
}

function executionPrompt(run) {
  return `Execution ${run.id} is in the ${run.lane} lane. Objective: ${run.objective}. Proposed action: ${run.proposedAction || "none"}. Review and approve only this bounded next step.`;
}

function createExecution(ownerId, workspaceId, input = {}) {
  const workspace = findWorkspace(ownerId, workspaceId);
  if (!workspace) return null;
  const lane = laneValue(input.lane);
  const objective = clean(input.objective || input.title || workspace.contract.outcome, 800);
  const checkpoints = Array.isArray(input.checkpoints) && input.checkpoints.length ? input.checkpoints : defaultCheckpoints(objective, lane);
  return atlas.addExecution(ownerId, workspace.id, {
    taskId: input.taskId || null,
    missionId: null,
    lane,
    objective,
    state: "draft",
    currentCheckpointIndex: 0,
    checkpoints,
    proposedAction: clean(input.proposedAction || `Begin the ${lane} lane for: ${objective}`, 800),
  });
}

function setCheckpoint(run, checkpointId, patch) {
  const checkpoints = (run.checkpoints || []).map((checkpoint) => checkpoint.id === checkpointId ? { ...checkpoint, ...patch } : checkpoint);
  return checkpoints;
}

function beginExecution(ownerId, workspaceId, executionId, options = {}) {
  const run = getRun(ownerId, workspaceId, executionId);
  if (!run) return { ok: false, message: "Execution run not found." };
  if (!["draft", "checkpoint"].includes(run.state)) return { ok: false, message: `Execution is already ${run.state}.` };
  const requiresApproval = options.requireApproval === true || !READ_ONLY_LANES.has(run.lane);
  const current = run.checkpoints?.[run.currentCheckpointIndex];
  if (requiresApproval) {
    const approval = {
      id: "approval_" + crypto.randomUUID(),
      prompt: executionPrompt(run),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      resolvedAt: 0,
      decision: null,
    };
    const updated = atlas.updateExecution(ownerId, workspaceId, executionId, {
      state: "awaiting_approval",
      approval,
      proposedAction: clean(options.proposedAction || run.proposedAction, 800),
    });
    return { ok: true, requiresApproval: true, run: updated, message: `Execution ${executionId} is waiting for your approval.\n\n${approval.prompt}\n\nSay “approve execution ${executionId}” or “reject execution ${executionId}”.` };
  }
  const checkpoint = current ? { ...current, status: "running", startedAt: current.startedAt || Date.now() } : null;
  const updated = atlas.updateExecution(ownerId, workspaceId, executionId, {
    state: "running",
    approval: null,
    checkpoints: checkpoint ? setCheckpoint(run, checkpoint.id, checkpoint) : run.checkpoints,
  });
  return { ok: true, requiresApproval: false, run: updated, message: `Execution ${executionId} started in the ${updated.lane} lane.\n\nCheckpoint: ${checkpoint?.title || "none"}` };
}

function approveExecution(ownerId, workspaceId, executionId, decision = "approve") {
  const run = getRun(ownerId, workspaceId, executionId);
  if (!run || run.state !== "awaiting_approval" || !run.approval) return { ok: false, message: "That execution is not waiting for approval." };
  if (run.approval.expiresAt && Date.now() > run.approval.expiresAt) {
    const expired = atlas.updateExecution(ownerId, workspaceId, executionId, { state: "cancelled", error: "Execution approval expired.", approval: { ...run.approval, decision: "expired", resolvedAt: Date.now() } });
    return { ok: false, run: expired, message: "That execution approval expired, so the run was cancelled." };
  }
  if (decision !== "approve") {
    const current = run.checkpoints?.[run.currentCheckpointIndex];
    const rejected = atlas.updateExecution(ownerId, workspaceId, executionId, {
      state: "cancelled",
      approval: { ...run.approval, decision: "rejected", resolvedAt: Date.now() },
      checkpoints: current ? setCheckpoint(run, current.id, { status: "rejected", note: "Owner rejected the proposed action." }) : run.checkpoints,
    });
    return { ok: true, run: rejected, message: `Execution ${executionId} was rejected and cancelled. No external action was performed.` };
  }
  const current = run.checkpoints?.[run.currentCheckpointIndex];
  const approved = atlas.updateExecution(ownerId, workspaceId, executionId, {
    state: "running",
    approval: { ...run.approval, decision: "approved", resolvedAt: Date.now() },
    checkpoints: current ? setCheckpoint(run, current.id, { status: "running", startedAt: current.startedAt || Date.now() }) : run.checkpoints,
  });
  return { ok: true, run: approved, message: `Execution ${executionId} approved. It is now running the ${approved.lane} lane.` };
}

function pauseExecution(ownerId, workspaceId, executionId) {
  const run = getRun(ownerId, workspaceId, executionId);
  if (!run || !ACTIVE_STATES.has(run.state)) return { ok: false, message: "That execution is not active." };
  const paused = atlas.updateExecution(ownerId, workspaceId, executionId, { state: "checkpoint", proposedAction: "Resume only after reviewing the current checkpoint." });
  return { ok: true, run: paused, message: `Execution ${executionId} paused at checkpoint ${paused.currentCheckpointIndex + 1}.` };
}

function completeCheckpoint(ownerId, workspaceId, executionId, checkpointId, input = {}) {
  const run = getRun(ownerId, workspaceId, executionId);
  if (!run) return { ok: false, message: "Execution run not found." };
  const checkpoint = run.checkpoints?.find((item) => item.id === checkpointId) || run.checkpoints?.[run.currentCheckpointIndex];
  if (!checkpoint) return { ok: false, message: "No checkpoint is available." };
  const checkpoints = setCheckpoint(run, checkpoint.id, {
    status: input.status === "blocked" ? "blocked" : "done",
    evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : checkpoint.evidenceIds,
    note: input.note || checkpoint.note,
    completedAt: input.status === "blocked" ? 0 : Date.now(),
  });
  const nextIndex = checkpoints.findIndex((item) => item.status === "pending" || item.status === "running");
  const done = nextIndex < 0 && checkpoints.every((item) => item.status === "done");
  const updated = atlas.updateExecution(ownerId, workspaceId, executionId, {
    checkpoints,
    currentCheckpointIndex: nextIndex < 0 ? checkpoints.length : nextIndex,
    state: input.status === "blocked" ? "blocked" : (done ? "completed" : "checkpoint"),
    result: done ? clean(input.result || "All execution checkpoints completed.", 1600) : run.result,
    recoveryProposal: input.status === "blocked" ? clean(input.recoveryProposal || "Review the blocked checkpoint and propose a bounded recovery step.", 1000) : "",
  });
  return { ok: true, run: updated, message: done ? `Execution ${executionId} completed with evidence checkpoints.` : `Checkpoint ${checkpoint.title} recorded. The next checkpoint is ready for review.` };
}

function attachMission(ownerId, workspaceId, executionId, missionId, checkpointId = null) {
  const run = getRun(ownerId, workspaceId, executionId);
  if (!run) return null;
  const checkpoint = checkpointId || run.checkpoints?.[run.currentCheckpointIndex]?.id || null;
  const checkpoints = checkpoint ? setCheckpoint(run, checkpoint, { missionId }) : run.checkpoints;
  return atlas.updateExecution(ownerId, workspaceId, executionId, { missionId, checkpoints });
}

function reconcileExecutionPass(ownerId) {
  const owner = ownerKey(ownerId);
  if (!owner) return { scanned: 0, reconciled: 0 };
  let scanned = 0;
  let reconciled = 0;
  for (const workspace of atlas.listWorkspaces(owner, { state: "active" })) {
    for (const run of atlas.listExecutions(owner, workspace.id)) {
      if (!run.missionId || ["completed", "failed", "cancelled"].includes(run.state)) continue;
      scanned++;
      const mission = missions.getMission(run.missionId);
      if (!mission || !["completed", "failed", "needs_review", "cancelled"].includes(mission.status)) continue;
      if (run.lastReconciledStatus === mission.status) continue;
      const current = run.checkpoints?.[run.currentCheckpointIndex];
      const isSuccess = mission.status === "completed";
      const evidence = atlas.addEvidence(owner, workspace.id, {
        kind: "execution_checkpoint",
        title: `${run.lane} execution ${isSuccess ? "completed" : "needs review"}`,
        summary: mission.result || mission.error || mission.progress || `Mission status: ${mission.status}`,
        source: "v5-execution",
      });
      const reconciledCheckpoints = current ? setCheckpoint(run, current.id, {
        status: isSuccess ? "done" : "blocked",
        evidenceIds: [...new Set([...(current.evidenceIds || []), evidence.id])],
        note: isSuccess ? "Durable mission outcome reconciled successfully." : "Durable mission outcome requires review.",
        completedAt: isSuccess ? Date.now() : 0,
      }) : (run.checkpoints || []);
      const nextIndex = reconciledCheckpoints.findIndex((checkpoint) => checkpoint.status === "pending" || checkpoint.status === "running");
      const allDone = nextIndex < 0 && reconciledCheckpoints.length > 0 && reconciledCheckpoints.every((checkpoint) => checkpoint.status === "done");
      const patch = {
        lastReconciledStatus: mission.status,
        lastReconciledAt: Date.now(),
        result: isSuccess ? clean(mission.result || "Mission completed.", 1600) : run.result,
        error: isSuccess ? "" : clean(mission.error || `Mission status: ${mission.status}`, 800),
        state: isSuccess ? (allDone ? "completed" : "checkpoint") : "blocked",
        currentCheckpointIndex: nextIndex < 0 ? reconciledCheckpoints.length : nextIndex,
        recoveryProposal: isSuccess ? "" : "Review the mission trace, revise the checkpoint, or approve a bounded retry.",
        checkpoints: reconciledCheckpoints,
      };
      const next = atlas.updateExecution(owner, workspace.id, run.id, patch);
      if (isSuccess && next?.taskId) atlas.updateTask(owner, workspace.id, next.taskId, { status: "done", missionId: run.missionId });
      if (!isSuccess && next?.taskId) atlas.updateTask(owner, workspace.id, next.taskId, { status: "blocked", missionId: run.missionId });
      if (!isSuccess) atlas.addRisk(owner, workspace.id, { title: `Execution blocked: ${run.objective}`, likelihood: 3, impact: 4, mitigation: "Review the durable mission trace and approve a bounded recovery step." });
      reconciled++;
    }
  }
  return { scanned, reconciled };
}

function latestRun(ownerId, workspaceId) {
  return atlas.listExecutions(ownerId, workspaceId)[0] || null;
}

function formatRun(run) {
  if (!run) return "No execution runs exist for this workspace yet.";
  const current = run.checkpoints?.[run.currentCheckpointIndex];
  const rows = (run.checkpoints || []).map((checkpoint, index) => `${checkpoint.status === "done" ? "✅" : checkpoint.status === "blocked" ? "⛔" : checkpoint.status === "running" ? "▶️" : "○"} ${index + 1}. ${checkpoint.title} — ${checkpoint.status}`).join("\n");
  return `⚙️ *Execution ${run.id}*\nLane: ${run.lane}\nState: ${run.state}\nObjective: ${run.objective}\n${current ? `Current: ${current.title}\n` : ""}${run.recoveryProposal ? `Recovery proposal: ${run.recoveryProposal}\n` : ""}\n*Checkpoints*\n${rows || "No checkpoints defined."}`;
}

function formatMissingEvidence(ownerId, workspaceId) {
  const runs = atlas.listExecutions(ownerId, workspaceId).filter((run) => ACTIVE_STATES.has(run.state));
  if (!runs.length) return "No active execution has missing evidence.";
  return runs.map((run) => {
    const missing = (run.checkpoints || []).filter((checkpoint) => checkpoint.status !== "done");
    return `*${run.id}* — ${missing.map((checkpoint) => `${checkpoint.title} (${checkpoint.criterion})`).join("; ") || "none"}`;
  }).join("\n");
}

async function startSafeMission(ownerId, workspace, task, options = {}) {
  const lane = laneValue(options.lane || "research");
  const run = createExecution(ownerId, workspace.id, { lane, objective: task.title, taskId: task.id });
  if (!run) return { kind: "text", text: "I could not create the execution run." };
  const started = beginExecution(ownerId, workspace.id, run.id, { requireApproval: !READ_ONLY_LANES.has(lane) });
  if (!started.ok) return { kind: "text", text: started.message };
  if (started.requiresApproval) return { kind: "execution_waiting_approval", run: started.run, text: started.message };
  const missionId = missions.createMission(options.chatId || ownerId, ownerId, task.title, { metadata: { atlasWorkspaceId: workspace.id, atlasTaskId: task.id, atlasExecutionId: run.id, atlasOwnerId: ownerId, actionLevel: "prepare" } });
  attachMission(ownerId, workspace.id, run.id, missionId);
  atlas.updateTask(ownerId, workspace.id, task.id, { status: "in_progress", missionId });
  missions.executeMission(missionId);
  return { kind: "execution_started", run: atlas.getExecution(ownerId, workspace.id, run.id), missionId, text: `${started.message}\nMission: ${missionId}\n\nI’ll attach the mission outcome to this execution checkpoint.` };
}

async function handleExecution(ownerId, text, options = {}) {
  const input = clean(text, 1200);
  const lower = input.toLowerCase();
  const workspace = findWorkspace(ownerId, options.workspaceId);
  if (!workspace) return { kind: "text", text: "I need an active Atlas project before I can execute work." };

  const id = input.match(/\b(?:execution|run)\s+([a-z0-9_-]{4,120})\b/i)?.[1];
  if (/\b(?:show|check|what is|what's|status of)\b.*\b(?:execution|run)\b/i.test(lower)) return { kind: "text", text: formatRun(id ? getRun(ownerId, workspace.id, id) : latestRun(ownerId, workspace.id)) };
  if (/\b(?:what evidence is missing|missing evidence)\b/i.test(lower)) return { kind: "text", text: `🔎 *Missing execution evidence*\n\n${formatMissingEvidence(ownerId, workspace.id)}` };
  if (/\b(?:retrospect|retrospective)\b/i.test(lower)) {
    const run = id ? getRun(ownerId, workspace.id, id) : latestRun(ownerId, workspace.id);
    if (!run) return { kind: "text", text: "There is no execution to retrospect yet." };
    const retro = atlas.addRetrospective(ownerId, workspace.id, { executionId: run.id, outcome: run.state === "completed" ? "Execution completed." : `Execution ended in ${run.state}.`, highlights: run.checkpoints.filter((checkpoint) => checkpoint.status === "done").map((checkpoint) => checkpoint.title), failures: run.checkpoints.filter((checkpoint) => checkpoint.status === "blocked" || checkpoint.status === "rejected").map((checkpoint) => checkpoint.title), nextImprovement: run.recoveryProposal || "Keep acceptance criteria explicit and attach evidence at each checkpoint." });
    atlas.updateExecution(ownerId, workspace.id, run.id, { retrospectiveId: retro.id });
    return { kind: "text", text: `🧾 Retrospective recorded for execution ${run.id}.\n\nOutcome: ${retro.outcome}\nNext improvement: ${retro.nextImprovement}` };
  }
  if (/\b(?:pause|stop)\b.*\b(?:execution|run)\b/i.test(lower)) {
    const run = id ? getRun(ownerId, workspace.id, id) : latestRun(ownerId, workspace.id);
    const result = run ? pauseExecution(ownerId, workspace.id, run.id) : { message: "No execution run found." };
    return { kind: "text", text: result.message };
  }
  if (/\b(?:approve|reject)\b.*\b(?:execution|run|next step)\b/i.test(lower)) {
    const decision = /\breject\b/i.test(lower) ? "reject" : "approve";
    const run = id ? getRun(ownerId, workspace.id, id) : latestRun(ownerId, workspace.id);
    if (!run) return { kind: "text", text: "There is no execution waiting for a decision." };
    return { kind: "text", text: approveExecution(ownerId, workspace.id, run.id, decision).message };
  }
  if (/\b(?:recovery|recover)\b/i.test(lower)) {
    const run = id ? getRun(ownerId, workspace.id, id) : latestRun(ownerId, workspace.id);
    return { kind: "text", text: run?.recoveryProposal ? `🛠️ *Recovery proposal*\n\n${run.recoveryProposal}\n\nApproval is still required before any consequential retry.` : "No blocked execution needs recovery right now." };
  }
  const laneMatch = lower.match(/\b(?:start|begin|run)\s+(?:a\s+)?(?:(research|design|build|verify|release)\s+)?(?:execution|run)\b(?:\s+(?:for|on|to)\s+)?([\s\S]*)/i);
  if (laneMatch) {
    const lane = laneValue(laneMatch[1] || "research");
    const objective = clean(laneMatch[2] || workspace.contract.outcome, 800);
    const run = createExecution(ownerId, workspace.id, { lane, objective });
    const started = beginExecution(ownerId, workspace.id, run.id, { requireApproval: !READ_ONLY_LANES.has(lane) });
    return { kind: "text", text: started.message };
  }
  if (/\b(?:execute|take|run)\b.*\bnext\s+(?:safe\s+)?step\b/i.test(lower)) {
    const brief = atlas.getBrief(ownerId, workspace.id);
    const task = brief?.nextTasks?.find((candidate) => candidate.status === "todo");
    if (!task) return { kind: "text", text: "There is no unstarted Atlas task ready for execution." };
    return startSafeMission(ownerId, workspace, task, options);
  }
  return { kind: "text", text: "V5 execution understands: start a research/design/build/verify/release run, show execution status, pause execution, approve or reject an execution, show missing evidence, propose recovery, and retrospect a run." };
}

module.exports = {
  LANES,
  READ_ONLY_LANES,
  createExecution,
  beginExecution,
  approveExecution,
  pauseExecution,
  completeCheckpoint,
  attachMission,
  reconcileExecutionPass,
  formatRun,
  formatMissingEvidence,
  handleExecution,
};
