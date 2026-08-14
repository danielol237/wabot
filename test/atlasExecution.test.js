const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const atlas = require("../src/tools/atlasStore");
const execution = require("../src/tools/atlasExecution");
const missions = require("../src/tools/durableMissions");

function cleanup(owner, workspaceId, missionIds = []) {
  try { fs.rmSync(path.join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
  for (const id of missionIds) {
    try { fs.rmSync(path.join(__dirname, "../data/missions", id + ".json"), { force: true }); } catch (_) {}
  }
}

test("Atlas V5 gates non-read-only lanes and completes evidence checkpoints", () => {
  const owner = "v5-execution-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "V5 Execution Test", outcome: "Ship a verified execution core" });
  try {
    const run = execution.createExecution(owner, workspace.id, { lane: "build", objective: "Build the execution core" });
    assert.equal(run.state, "draft");
    assert.equal(run.lane, "build");

    const waiting = execution.beginExecution(owner, workspace.id, run.id);
    assert.equal(waiting.requiresApproval, true);
    assert.equal(waiting.run.state, "awaiting_approval");
    assert.match(waiting.message, /approve execution/);

    const approved = execution.approveExecution(owner, workspace.id, run.id, "approve");
    assert.equal(approved.ok, true);
    assert.equal(approved.run.state, "running");
    assert.equal(approved.run.checkpoints[0].status, "running");

    const evidence = atlas.addEvidence(owner, workspace.id, { kind: "test", title: "Execution test evidence", summary: "V5 checkpoint passed.", source: "test" });
    let current = atlas.getExecution(owner, workspace.id, run.id);
    let result = execution.completeCheckpoint(owner, workspace.id, run.id, current.checkpoints[0].id, { evidenceIds: [evidence.id], note: "First checkpoint passed." });
    assert.equal(result.ok, true);
    current = result.run;
    result = execution.completeCheckpoint(owner, workspace.id, run.id, current.checkpoints[current.currentCheckpointIndex].id, { note: "Owner checkpoint passed." });
    current = result.run;
    result = execution.completeCheckpoint(owner, workspace.id, run.id, current.checkpoints[current.currentCheckpointIndex].id, { note: "Verification passed.", result: "Execution completed." });
    assert.equal(result.run.state, "completed");
    assert.deepEqual(result.run.checkpoints[0].evidenceIds, [evidence.id]);
  } finally {
    cleanup(owner, workspace.id);
  }
});

test("Atlas V5 local research execution starts without a consequential approval", async () => {
  const owner = "v5-research-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Research Test", outcome: "Understand the project" });
  try {
    const response = await execution.handleExecution(owner, "start a research execution for collect project facts", { workspaceId: workspace.id });
    assert.equal(response.kind, "text");
    const run = atlas.listExecutions(owner, workspace.id)[0];
    assert.equal(run.lane, "research");
    assert.equal(run.state, "running");
  } finally {
    cleanup(owner, workspace.id);
  }
});

test("Atlas V5 reconciles a terminal mission into execution evidence exactly once", async () => {
  const owner = "v5-reconcile-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Reconcile Test", outcome: "Reconcile mission outcomes" });
  const missionId = missions.createMission(owner, owner, "Verify reconciliation", { metadata: { atlasWorkspaceId: workspace.id } });
  try {
    const run = execution.createExecution(owner, workspace.id, { lane: "verify", objective: "Verify reconciliation" });
    execution.attachMission(owner, workspace.id, run.id, missionId);
    const mission = missions.getMission(missionId);
    mission.status = "completed";
    mission.result = "Verification mission passed.";
    mission.progress = "Completed";
    await missions.save();

    const first = execution.reconcileExecutionPass(owner);
    assert.equal(first.reconciled, 1);
    const reconciled = atlas.getExecution(owner, workspace.id, run.id);
    assert.equal(reconciled.lastReconciledStatus, "completed");
    assert.equal(reconciled.state, "checkpoint");
    assert.equal(reconciled.checkpoints[0].status, "done");
    assert.equal(reconciled.checkpoints[0].evidenceIds.length, 1);

    const second = execution.reconcileExecutionPass(owner);
    assert.equal(second.reconciled, 0);
  } finally {
    cleanup(owner, workspace.id, [missionId]);
  }
});

test("Atlas V5 failed mission becomes blocked with a recovery proposal", async () => {
  const owner = "v5-failure-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Failure Test", outcome: "Handle blocked execution" });
  const missionId = missions.createMission(owner, owner, "Fail reconciliation", { metadata: { atlasWorkspaceId: workspace.id } });
  try {
    const run = execution.createExecution(owner, workspace.id, { lane: "build", objective: "Fail reconciliation" });
    execution.attachMission(owner, workspace.id, run.id, missionId);
    const mission = missions.getMission(missionId);
    mission.status = "failed";
    mission.error = "Build verification failed.";
    mission.progress = "Failed";
    await missions.save();

    const result = execution.reconcileExecutionPass(owner);
    assert.equal(result.reconciled, 1);
    const blocked = atlas.getExecution(owner, workspace.id, run.id);
    assert.equal(blocked.state, "blocked");
    assert.match(blocked.recoveryProposal, /Review the mission trace/);
    assert.equal(atlas.listWorkspaces(owner)[0].risks.length > 0, true);
  } finally {
    cleanup(owner, workspace.id, [missionId]);
  }
});
