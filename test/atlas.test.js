const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const atlas = require("../src/tools/atlasStore");
const brain = require("../src/tools/atlasBrain");
const policy = require("../src/tools/atlasPolicy");

function cleanup(id) {
  try { fs.rmSync(path.join(atlas.ATLAS_DIR, id + ".json"), { force: true }); } catch (_) {}
}

test("Atlas creates an owner-scoped durable project contract", () => {
  const owner = "atlas-test-owner-" + Date.now();
  const workspace = brain.createAtlasProject(owner, "ARIA, this is a project: ship the anime dashboard by December");
  try {
    assert.equal(workspace.title, "ship the anime dashboard");
    assert.equal(workspace.contract.deadline, "December");
    assert.equal(atlas.getWorkspace(owner, workspace.id).ownerId, owner);
    assert.equal(atlas.getWorkspace("another-owner", workspace.id), null);
  } finally {
    cleanup(workspace.id);
  }
});

test("Atlas tracks tasks, progress, evidence, decisions, and a living brief", () => {
  const owner = "atlas-test-owner-" + Date.now() + "-2";
  const workspace = atlas.createWorkspace(owner, { title: "Reliability release", outcome: "Ship a stable release" });
  try {
    const task = atlas.addTask(owner, workspace.id, { title: "Inspect provider health", priority: "high" });
    assert.ok(task.id);
    atlas.updateTask(owner, workspace.id, task.id, { status: "done" });
    const blocked = atlas.addTask(owner, workspace.id, { title: "Deploy release", status: "blocked" });
    const evidence = atlas.addEvidence(owner, workspace.id, { title: "CI result", summary: "101 tests passed", url: "https://github.com/example/repo/actions" });
    const rejectedUrl = atlas.addEvidence(owner, workspace.id, { title: "Unsafe", summary: "not a link", url: "javascript:alert(1)" });
    const decision = atlas.addDecision(owner, workspace.id, { question: "Which release path?", choice: "Use the validated Docker image", rationale: "It contains the required media runtime", confidence: 90 });
    const brief = atlas.getBrief(owner, workspace.id);
    assert.equal(brief.progress, 50);
    assert.equal(brief.blocked[0].id, blocked.id);
    assert.equal(evidence.url, "https://github.com/example/repo/actions");
    assert.equal(rejectedUrl.url, null);
    assert.equal(decision.confidence, 90);
    assert.match(atlas.summary(brief), /Reliability release/);
  } finally {
    cleanup(workspace.id);
  }
});

test("Atlas policy classifies safe preparation and commits separately", () => {
  assert.equal(policy.classifyAction("inspect the failed provider"), policy.LEVELS.PREPARE);
  assert.equal(policy.classifyAction("deploy the release"), policy.LEVELS.COMMIT);
  assert.equal(policy.approvalRequired("deploy the release", { approvalPolicy: "balanced" }), true);
  assert.equal(policy.approvalRequired("inspect the failed provider", { approvalPolicy: "balanced" }), false);
});

test("Atlas natural queries return a project brief without command syntax", async () => {
  const owner = "atlas-test-owner-" + Date.now() + "-3";
  const workspace = atlas.createWorkspace(owner, { title: "Natural project", outcome: "Test conversational intake" });
  try {
    atlas.addTask(owner, workspace.id, { title: "Inspect natural routing" });
    const result = await brain.handleAtlas(owner, "what is next?");
    assert.equal(result.kind, "text");
    assert.match(result.text, /Natural project/);
    assert.match(result.text, /Inspect natural routing/);
  } finally {
    cleanup(workspace.id);
  }
});


test("Atlas daily brief is high-signal and rate-limited per workspace", () => {
  const digest = require("../src/tools/atlasDigest");
  const owner = "atlas-test-owner-" + Date.now() + "-digest";
  const workspace = atlas.createWorkspace(owner, { title: "Digest project", outcome: "Keep the release moving" });
  const now = Date.now();
  try {
    atlas.addTask(owner, workspace.id, { title: "Inspect failed provider", priority: "high" });
    const brief = digest.composeDailyBrief(owner, now);
    assert.ok(brief);
    assert.match(brief.text, /Digest project/);
    assert.match(brief.text, /Inspect failed provider/);
    digest.markDelivered(brief, now);
    assert.equal(digest.composeDailyBrief(owner, now + 60 * 60 * 1000), null);
    assert.ok(digest.composeDailyBrief(owner, now + digest.DAILY_MS + 1));
  } finally {
    cleanup(workspace.id);
  }
});


test("Atlas v2 drafts and applies a dependency-linked roadmap", async () => {
  const planner = require("../src/tools/atlasPlanner");
  const owner = "atlas-test-owner-" + Date.now() + "-planner";
  const workspace = atlas.createWorkspace(owner, { title: "Ship Atlas v2", outcome: "Release a reliable planning engine" });
  try {
    const draftResult = planner.draftPlan(owner, "plan this project");
    assert.ok(draftResult?.draft);
    assert.equal(draftResult.draft.milestones.length, 4);
    assert.ok(draftResult.draft.risks.length >= 2);
    const applied = planner.applyDraft(owner);
    assert.ok(applied?.applied);
    const stored = atlas.getWorkspace(owner, workspace.id);
    assert.equal(stored.planning.status, "applied");
    assert.equal(stored.milestones.length, 4);
    assert.ok(stored.tasks.length >= 10);
    assert.ok(stored.tasks.some((task) => task.dependsOn.length > 0));
    const compareTask = stored.tasks.find((task) => task.title === "Compare the viable approaches");
    const baselineTask = stored.tasks.find((task) => task.title === "Inspect the current baseline");
    assert.ok(compareTask.dependsOn.includes(baselineTask.id));
    assert.ok(stored.risks.some((risk) => risk.score >= 12));
    assert.equal(planner.applyDraft(owner), null);
  } finally {
    cleanup(workspace.id);
  }
});

test("Atlas v2 reconciles a mission outcome exactly once", () => {
  const owner = "atlas-test-owner-" + Date.now() + "-reconcile";
  const workspace = atlas.createWorkspace(owner, { title: "Mission bridge", outcome: "Connect mission results" });
  try {
    const task = atlas.addTask(owner, workspace.id, { title: "Run verification", missionId: "mission-test-1" });
    const first = atlas.reconcileMission(owner, workspace.id, "mission-test-1", { status: "completed", result: "All verification checks passed" });
    const second = atlas.reconcileMission(owner, workspace.id, "mission-test-1", { status: "failed", error: "should not overwrite" });
    assert.equal(first.taskId, task.id);
    assert.equal(first.status, "completed");
    assert.deepEqual(second, first);
    const stored = atlas.getWorkspace(owner, workspace.id);
    assert.equal(stored.tasks.find((item) => item.id === task.id).status, "done");
    assert.equal(stored.evidence.filter((item) => item.kind === "mission_outcome").length, 1);
  } finally {
    cleanup(workspace.id);
  }
});


test("Atlas reconciler maps a terminal durable mission into its workspace", () => {
  const reconciler = require("../src/tools/atlasReconciler");
  const owner = "atlas-test-owner-" + Date.now() + "-bridge";
  const workspace = atlas.createWorkspace(owner, { title: "Reconciliation project", outcome: "Keep mission state honest" });
  try {
    const task = atlas.addTask(owner, workspace.id, { title: "Run release checks", missionId: "bridge-mission-1" });
    const result = reconciler.reconcileOne({
      id: "bridge-mission-1",
      creator: owner,
      status: "failed",
      progress: "Failed",
      error: "provider unavailable",
      metadata: { atlasWorkspaceId: workspace.id, atlasOwnerId: owner },
      objective: "Run release checks",
    });
    assert.equal(result.taskId, task.id);
    assert.equal(atlas.getWorkspace(owner, workspace.id).tasks.find((item) => item.id === task.id).status, "blocked");
    assert.ok(atlas.getWorkspace(owner, workspace.id).risks.some((risk) => /provider unavailable/.test(risk.title)));
  } finally {
    cleanup(workspace.id);
  }
});


test("Atlas v5 creates approval-gated lanes and evidence-backed checkpoints", () => {
  const execution = require("../src/tools/atlasExecution");
  const owner = "atlas-test-owner-" + Date.now() + "-v5";
  const workspace = atlas.createWorkspace(owner, { title: "V5 execution", outcome: "Execute with evidence" });
  try {
    const run = execution.createExecution(owner, workspace.id, { lane: "release", objective: "Release with evidence" });
    const waiting = execution.beginExecution(owner, workspace.id, run.id);
    assert.equal(waiting.requiresApproval, true);
    assert.equal(waiting.run.state, "awaiting_approval");
    const approved = execution.approveExecution(owner, workspace.id, run.id, "approve");
    assert.equal(approved.run.state, "running");
    const evidence = atlas.addEvidence(owner, workspace.id, { title: "Release check", summary: "Release check passed", kind: "verification", source: "atlas.test" });
    const checkpoint = approved.run.checkpoints[0];
    const completed = execution.completeCheckpoint(owner, workspace.id, run.id, checkpoint.id, { evidenceIds: [evidence.id], note: "Evidence attached." });
    assert.equal(completed.run.checkpoints[0].status, "done");
    assert.deepEqual(completed.run.checkpoints[0].evidenceIds, [evidence.id]);
  } finally {
    cleanup(workspace.id);
  }
});
