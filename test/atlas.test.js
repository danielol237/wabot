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
