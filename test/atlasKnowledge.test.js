const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const atlas = require("../src/tools/atlasStore");
const knowledge = require("../src/tools/atlasKnowledge");

function cleanup(workspaceId) {
  try { fs.rmSync(path.join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
}

test("V7 projects core Atlas records into a stable graph without duplicate nodes or edges", () => {
  const owner = "v7-graph-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Knowledge project", outcome: "Build a traceable project" });
  try {
    const evidence = atlas.addEvidence(owner, workspace.id, { kind: "test", title: "Acceptance proof", summary: "A deterministic check passed." });
    const task = atlas.addTask(owner, workspace.id, { title: "Build the graph", description: "Create the project knowledge index.", evidenceIds: [evidence.id] });
    atlas.addDecision(owner, workspace.id, { choice: "Use a bounded workspace graph", rationale: "It preserves owner scope and atomic writes." });
    const first = knowledge.projectWorkspace(owner, workspace.id);
    const firstCounts = knowledge.graphSummary(first.workspace);
    const second = knowledge.projectWorkspace(owner, workspace.id);
    const secondCounts = knowledge.graphSummary(second.workspace);
    assert.equal(firstCounts.nodeCount, secondCounts.nodeCount);
    assert.equal(firstCounts.edgeCount, secondCounts.edgeCount);
    assert.equal(firstCounts.revision, secondCounts.revision);
    assert.ok(second.workspace.knowledgeNodes.some((node) => node.sourceType === "task" && node.sourceId === task.id));
    assert.ok(second.workspace.knowledgeEdges.some((edge) => edge.type === "supports" && edge.targetId === `knowledge_task_${task.id}`));
    const result = knowledge.queryKnowledge(owner, workspace.id, "graph");
    assert.equal(result.summary.nodeCount, secondCounts.nodeCount);
    assert.equal(result.health.orphanEdges.length, 0);
  } finally {
    cleanup(workspace.id);
  }
});

test("V7 typed edges are owner-scoped, deduplicated, and conflicts are visible", () => {
  const owner = "v7-edge-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Edge project", outcome: "Trace relationships" });
  try {
    const requirement = knowledge.addKnowledgeNode(owner, workspace.id, { type: "requirement", title: "Required outcome", summary: "The project must be traceable." });
    const evidence = knowledge.addKnowledgeNode(owner, workspace.id, { type: "evidence", title: "Evidence", summary: "Evidence supports the requirement." });
    const supports = knowledge.linkKnowledge(owner, workspace.id, { type: "supports", sourceId: evidence.id, targetId: requirement.id, rationale: "Test evidence supports the requirement." });
    const duplicate = knowledge.linkKnowledge(owner, workspace.id, { type: "supports", sourceId: evidence.id, targetId: requirement.id });
    knowledge.linkKnowledge(owner, workspace.id, { type: "contradicts", sourceId: evidence.id, targetId: requirement.id, rationale: "A later note conflicts." });
    assert.equal(supports.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(atlas.listKnowledgeEdges(owner, workspace.id).length, 2);
    const health = knowledge.knowledgeHealth(atlas.getWorkspace(owner, workspace.id));
    assert.equal(health.conflicts.length, 1);
    assert.equal(knowledge.linkKnowledge(owner, workspace.id, { type: "supports", sourceId: evidence.id, targetId: "missing-node" }), null);
  } finally {
    cleanup(workspace.id);
  }
});

test("V7 artifact vault deduplicates provenance and traces related graph nodes", () => {
  const owner = "v7-artifact-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Artifact project", outcome: "Trace generated outputs" });
  try {
    const first = knowledge.addProjectArtifact(owner, workspace.id, { kind: "report", title: "Verification report", summary: "Verifier output.", url: "https://example.com/report", sourceType: "operator_team", sourceId: "team_demo", sourceRole: "verifier" });
    const duplicate = knowledge.addProjectArtifact(owner, workspace.id, { kind: "report", title: "Same report", url: "https://example.com/report", sourceType: "operator_team", sourceId: "team_demo" });
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    const projected = knowledge.projectWorkspace(owner, workspace.id);
    assert.ok(projected.workspace.knowledgeNodes.some((node) => node.type === "artifact" && node.sourceId === first.artifact.id));
    const trace = knowledge.traceArtifact(owner, workspace.id, "Verification report");
    assert.equal(trace.artifact.id, first.artifact.id);
    assert.ok(trace.nodes.some((node) => node.type === "artifact"));
    const unsafe = knowledge.addProjectArtifact(owner, workspace.id, { title: "Unsafe", url: "javascript:alert(1)", localPath: "../../secret" });
    assert.equal(unsafe, null);
  } finally {
    cleanup(workspace.id);
  }
});

test("V7 freshness health reports stale knowledge without rewriting it", () => {
  const owner = "v7-health-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Freshness project", outcome: "Detect stale context" });
  try {
    const stale = knowledge.addKnowledgeNode(owner, workspace.id, { type: "external_reference", title: "Old reference", summary: "Needs review.", freshness: "stale", sourceUpdatedAt: Date.now() - 40 * 24 * 60 * 60 * 1000 });
    const before = atlas.getWorkspace(owner, workspace.id).knowledgeRevision;
    const health = knowledge.knowledgeHealth(atlas.getWorkspace(owner, workspace.id));
    assert.ok(health.staleNodes.some((node) => node.id === stale.id));
    assert.equal(atlas.getWorkspace(owner, workspace.id).knowledgeRevision, before);
  } finally {
    cleanup(workspace.id);
  }
});
