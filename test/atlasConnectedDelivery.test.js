const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const atlas = require("../src/tools/atlasStore");
const sentinel = require("../src/tools/atlasSentinel");
const connected = require("../src/tools/atlasConnectedDelivery");

function cleanup(workspaceId) {
  try { fs.rmSync(path.join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
}

test("V8 connected delivery records provider mappings and idempotent failed-check proposals", () => {
  const owner = "v8-connected-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Connected release", outcome: "Observe release health" });
  try {
    const mapped = connected.configureConnectedDelivery(owner, workspace.id, { repository: "danielol237/wabot", serviceId: "srv-demo" });
    assert.equal(mapped.status, "observing");
    assert.equal(mapped.github.repository, "danielol237/wabot");
    assert.equal(mapped.render.serviceId, "srv-demo");

    const payload = { action: "completed", repository: { full_name: "danielol237/wabot" }, check_run: { conclusion: "failure" } };
    const accepted = sentinel.ingestGithub(owner, payload, "check_run", "delivery-v8-failure", { notify: false });
    const duplicate = sentinel.ingestGithub(owner, payload, "check_run", "delivery-v8-failure", { notify: false });
    assert.equal(accepted.status, "accepted");
    assert.equal(duplicate.status, "duplicate");

    const state = connected.connectedDelivery(owner, workspace.id);
    assert.equal(state.status, "needs_review");
    assert.equal(state.github.lastCheck.kind, "check_run");
    assert.equal(state.proposals.filter((proposal) => proposal.status === "open").length, 1);
    assert.equal(state.release.signalIds.length, 1);
    assert.equal(state.release.evidenceIds.length, 1);
  } finally {
    cleanup(workspace.id);
  }
});

test("V8 connected delivery reaches verified release state after a clean Render deployment", () => {
  const owner = "v8-release-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Render release", outcome: "Verify production delivery" });
  try {
    connected.configureConnectedDelivery(owner, workspace.id, { serviceId: "srv-production" });
    const accepted = sentinel.ingestRender(owner, { type: "deploy_ended", timestamp: new Date().toISOString(), data: { id: "evt-v8-deploy", serviceId: "srv-production", serviceName: "aria", status: "succeeded" } }, { notify: false });
    assert.equal(accepted.status, "accepted");
    const state = connected.connectedDelivery(owner, workspace.id);
    assert.equal(state.status, "released_verified");
    assert.equal(state.render.lastDeploy.kind, "deploy_ended");
    assert.equal(state.render.availability, "unknown");
  } finally {
    cleanup(workspace.id);
  }
});

test("V8 connected delivery approvals stay owner-scoped and explicitly side-effect-free", () => {
  const owner = "v8-approval-owner-" + Date.now();
  const other = "v8-other-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Approval project", outcome: "Review delivery proposals" });
  const otherWorkspace = atlas.createWorkspace(other, { title: "Other project", outcome: "Must remain isolated" });
  try {
    connected.configureConnectedDelivery(owner, workspace.id, { repository: "danielol237/wabot" });
    sentinel.ingestGithub(owner, { action: "completed", repository: { full_name: "danielol237/wabot" }, check_run: { conclusion: "failure" } }, "check_run", "delivery-v8-approval", { notify: false });
    const proposal = connected.connectedDelivery(owner, workspace.id).proposals.find((item) => item.status === "open");
    assert.ok(proposal);
    assert.equal(connected.connectedDelivery(other, otherWorkspace.id).proposals.length, 0);

    const response = connected.handleConnectedDelivery(owner, `approve ${proposal.id}`);
    assert.match(response.text, /No commit, merge, deploy, rollback/i);
    const updated = atlas.listConnectedProposals(owner, workspace.id).find((item) => item.id === proposal.id);
    assert.equal(updated.status, "approved");
    assert.equal(updated.decisionBy, owner);
  } finally {
    cleanup(workspace.id);
    cleanup(otherWorkspace.id);
  }
});
