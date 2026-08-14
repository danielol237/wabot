const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const atlas = require("../src/tools/atlasStore");
const teams = require("../src/tools/atlasOperatorTeams");
const missions = require("../src/tools/durableMissions");

function cleanup(workspaceId, missionIds = []) {
  try { fs.rmSync(path.join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
  for (const id of missionIds) {
    try { fs.rmSync(path.join(__dirname, "../data/missions", id + ".json"), { force: true }); } catch (_) {}
  }
}

test("V6 full operator team stops at the consequential approval boundary", () => {
  const owner = "v6-team-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Team approval", outcome: "Coordinate a safe project" });
  try {
    const team = teams.createOperatorTeam(owner, workspace.id, { objective: "Coordinate a safe project", roles: ["designer"] });
    assert.equal(team.packets.length, 1);
    assert.deepEqual(team.packets.map((packet) => packet.role), ["designer"]);
    const started = teams.beginOperatorTeam(owner, workspace.id, team.id);
    assert.equal(started.ok, true);
    assert.equal(started.requiresApproval, true);
    assert.equal(started.team.state, "awaiting_approval");
    assert.equal(atlas.getOperatorTeam(owner, workspace.id, team.id).packets[0].missionId, null);
    assert.match(started.message, /approve team/);
  } finally {
    cleanup(workspace.id);
  }
});

test("V6 parser rejects unstructured verifier output as needs review", () => {
  const parsed = teams.parseRoleResult("The checks look good, but I did not provide a formal status.");
  assert.equal(parsed.status, "needs_review");
  assert.match(parsed.summary, /checks look good/);
  const passed = teams.parseRoleResult("STATUS: PASS\nSUMMARY: All checks passed.\nEVIDENCE: npm test\nHANDOFF: Ready for release review.\nDECISIONS: NONE\nUNRESOLVED: NONE");
  assert.equal(passed.status, "pass");
  assert.deepEqual(passed.unresolvedQuestions, []);
});

test("V6 reconciles a completed role mission into one accepted handoff", async () => {
  const owner = "v6-reconcile-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Team reconciliation", outcome: "Prove team handoffs" });
  const missionId = missions.createMission(owner, owner, "Research role packet", { metadata: { atlasWorkspaceId: workspace.id } });
  try {
    const team = teams.createOperatorTeam(owner, workspace.id, { objective: "Prove team handoffs", roles: ["researcher"] });
    const current = atlas.getOperatorTeam(owner, workspace.id, team.id);
    const mission = missions.getMission(missionId);
    mission.status = "completed";
    mission.progress = "Completed";
    mission.result = "STATUS: PASS\nSUMMARY: Sources collected.\nEVIDENCE: Three relevant sources.\nHANDOFF: Designer can compare the options.\nDECISIONS: NONE\nUNRESOLVED: NONE";
    await missions.save();
    atlas.updateOperatorTeam(owner, workspace.id, team.id, {
      state: "running",
      packets: current.packets.map((packet, index) => index === 0 ? { ...packet, status: "running", missionId } : packet),
    });

    const first = teams.reconcileOperatorTeamPass(owner);
    assert.equal(first.reconciled, 1);
    const complete = atlas.getOperatorTeam(owner, workspace.id, team.id);
    assert.equal(complete.state, "completed");
    assert.equal(complete.packets[0].status, "completed");
    assert.equal(complete.handoffs.length, 1);
    assert.equal(complete.handoffs[0].status, "accepted");
    assert.equal(complete.handoffs[0].toRole, "owner");
    assert.equal(complete.packets[0].evidenceIds.length, 1);

    const second = teams.reconcileOperatorTeamPass(owner);
    assert.equal(second.reconciled, 0);
    assert.equal(atlas.getWorkspace(owner, workspace.id).evidence.filter((item) => item.kind === "operator_handoff").length, 1);
  } finally {
    cleanup(workspace.id, [missionId]);
  }
});

test("V6 failed role mission becomes blocked with a bounded recovery proposal", async () => {
  const owner = "v6-blocked-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Team recovery", outcome: "Recover a blocked role" });
  const missionId = missions.createMission(owner, owner, "Blocked role packet", { metadata: { atlasWorkspaceId: workspace.id } });
  try {
    const team = teams.createOperatorTeam(owner, workspace.id, { objective: "Recover a blocked role", roles: ["researcher"] });
    const current = atlas.getOperatorTeam(owner, workspace.id, team.id);
    const mission = missions.getMission(missionId);
    mission.status = "failed";
    mission.error = "Research source unavailable.";
    mission.progress = "Failed";
    await missions.save();
    atlas.updateOperatorTeam(owner, workspace.id, team.id, {
      state: "running",
      packets: current.packets.map((packet, index) => index === 0 ? { ...packet, status: "running", missionId, attempts: 1 } : packet),
    });

    const result = teams.reconcileOperatorTeamPass(owner);
    assert.equal(result.reconciled, 1);
    const blocked = atlas.getOperatorTeam(owner, workspace.id, team.id);
    assert.equal(blocked.state, "blocked");
    assert.equal(blocked.packets[0].status, "blocked");
    assert.match(blocked.recoveryProposal, /Narrow the blocked packet/);
    const retried = teams.retryOperatorTeam(owner, workspace.id, team.id);
    assert.equal(retried.ok, true);
    assert.equal(atlas.getOperatorTeam(owner, workspace.id, team.id).packets[0].attempts, 2);
    missions.cancelMission(atlas.getOperatorTeam(owner, workspace.id, team.id).packets[0].missionId);
  } finally {
    cleanup(workspace.id, [missionId]);
  }
});
