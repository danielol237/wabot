// ARIA Atlas v2 — durable mission reconciliation.
// This is a deterministic bridge between the mission engine and Atlas. It does
// not create a second mission state machine and is safe to run repeatedly.

const durable = require("./durableMissions");
const atlas = require("./atlasStore");

const TERMINAL = new Set(["completed", "failed", "needs_review", "cancelled"]);

function ownerFor(mission) {
  return String(mission.metadata?.atlasOwnerId || mission.creator || "").trim();
}

function reconcileOne(mission) {
  if (!mission || !TERMINAL.has(mission.status)) return null;
  const workspaceId = String(mission.metadata?.atlasWorkspaceId || "").trim();
  const ownerId = ownerFor(mission);
  if (!workspaceId || !ownerId) return null;
  return atlas.reconcileMission(ownerId, workspaceId, mission.id, {
    status: mission.status,
    result: typeof mission.result === "string" ? mission.result : mission.result ? JSON.stringify(mission.result) : "",
    error: mission.error,
    progress: mission.progress,
    title: `Mission outcome: ${(mission.objective || mission.id).slice(0, 180)}`,
  });
}

function runReconciliationPass(limit = 200) {
  let reconciled = 0;
  const records = durable.getAllMissions().slice(0, limit);
  for (const mission of records) {
    const result = reconcileOne(mission);
    if (result && result.reconciledAt) reconciled += 1;
  }
  return { scanned: records.length, reconciled };
}

module.exports = { TERMINAL, ownerFor, reconcileOne, runReconciliationPass };
