// Atlas V7 Project Knowledge Graph and Artifact Vault.
// This is a bounded, owner-scoped projection over existing Atlas records.

const crypto = require("crypto");
const atlas = require("./atlasStore");

const EDGE_TYPES = ["supports", "contradicts", "depends_on", "produced_by", "derived_from", "satisfies", "blocks", "supersedes", "references", "related_to"];
const NODE_TYPES = ["requirement", "decision", "risk", "task", "evidence", "artifact", "execution", "external_reference"];
const DEFAULT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function clean(value, max = 1600) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function findWorkspace(ownerId, workspaceId) {
  return workspaceId ? atlas.getWorkspace(ownerId, workspaceId) : atlas.findWorkspace(ownerId);
}

function stableId(sourceType, sourceId) {
  return `knowledge_${clean(sourceType, 60)}_${clean(sourceId, 120)}`;
}

function freshnessFor(sourceUpdatedAt, now = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS) {
  if (!sourceUpdatedAt) return "unknown";
  return now - sourceUpdatedAt > staleAfterMs ? "stale" : "fresh";
}

function statusFor(sourceStatus) {
  return ["done", "cancelled", "resolved", "archived", "superseded"].includes(String(sourceStatus || "").toLowerCase()) ? "archived" : "active";
}

function node(ownerId, workspaceId, input) {
  return atlas.upsertKnowledgeNode(ownerId, workspaceId, input);
}

function projectWorkspace(ownerId, workspaceId, options = {}) {
  const workspace = findWorkspace(ownerId, workspaceId);
  if (!workspace) return null;
  const now = Date.now();
  const staleAfterMs = Math.max(60 * 60 * 1000, Math.min(365 * 24 * 60 * 60 * 1000, Number(options.staleAfterMs) || DEFAULT_STALE_AFTER_MS));
  const requirement = node(ownerId, workspace.id, {
    id: stableId("contract", workspace.id), type: "requirement", title: workspace.title,
    summary: `${workspace.contract.outcome}${workspace.contract.constraints?.length ? ` Constraints: ${workspace.contract.constraints.join("; ")}.` : ""}${workspace.contract.nonGoals?.length ? ` Non-goals: ${workspace.contract.nonGoals.join("; ")}.` : ""}`,
    status: "active", freshness: freshnessFor(workspace.createdAt || workspace.updatedAt, now, staleAfterMs), sourceType: "contract", sourceId: workspace.id,
    confidence: 95, sourceUpdatedAt: workspace.createdAt || workspace.updatedAt,
  });
  const taskNodes = new Map();
  for (const task of workspace.tasks || []) {
    taskNodes.set(task.id, node(ownerId, workspace.id, {
      id: stableId("task", task.id), type: "task", title: task.title, summary: task.description || `${task.status} task`, status: statusFor(task.status),
      freshness: freshnessFor(task.updatedAt, now, staleAfterMs), sourceType: "task", sourceId: task.id, confidence: 90, sourceUpdatedAt: task.updatedAt,
    }));
  }
  const decisionNodes = new Map();
  for (const decision of workspace.decisions || []) {
    decisionNodes.set(decision.id, node(ownerId, workspace.id, {
      id: stableId("decision", decision.id), type: "decision", title: decision.choice || decision.question || "Recorded decision", summary: decision.rationale || "Decision recorded in Atlas.", status: "active",
      freshness: freshnessFor(decision.createdAt, now, staleAfterMs), sourceType: "decision", sourceId: decision.id, confidence: 85, sourceUpdatedAt: decision.createdAt,
    }));
  }
  const evidenceNodes = new Map();
  for (const evidence of workspace.evidence || []) {
    evidenceNodes.set(evidence.id, node(ownerId, workspace.id, {
      id: stableId("evidence", evidence.id), type: "evidence", title: evidence.title, summary: evidence.summary, status: "active",
      freshness: freshnessFor(evidence.createdAt, now, staleAfterMs), sourceType: "evidence", sourceId: evidence.id, confidence: 80, sensitivity: evidence.sensitivity, sourceUpdatedAt: evidence.createdAt,
    }));
  }
  for (const risk of workspace.risks || []) {
    node(ownerId, workspace.id, {
      id: stableId("risk", risk.id), type: "risk", title: risk.title, summary: risk.mitigation || `${risk.status} risk with score ${risk.score || 0}.`, status: statusFor(risk.status),
      freshness: freshnessFor(risk.updatedAt || risk.createdAt, now, staleAfterMs), sourceType: "risk", sourceId: risk.id, confidence: 80, sourceUpdatedAt: risk.updatedAt || risk.createdAt,
    });
  }
  for (const execution of workspace.executions || []) {
    node(ownerId, workspace.id, {
      id: stableId("execution", execution.id), type: "execution", title: `${execution.lane || "execution"}: ${execution.objective || "run"}`, summary: `${execution.state || "unknown"} execution with ${(execution.checkpoints || []).length} checkpoint(s).`, status: statusFor(execution.state),
      freshness: freshnessFor(execution.updatedAt || execution.createdAt, now, staleAfterMs), sourceType: "execution", sourceId: execution.id, confidence: 90, sourceUpdatedAt: execution.updatedAt || execution.createdAt,
    });
  }
  for (const team of workspace.operatorTeams || []) {
    node(ownerId, workspace.id, {
      id: stableId("operator_team", team.id), type: "execution", title: `Operator team: ${team.objective}`, summary: `${team.state} team with ${(team.packets || []).length} role packet(s).`, status: statusFor(team.state),
      freshness: freshnessFor(team.updatedAt || team.createdAt, now, staleAfterMs), sourceType: "operator_team", sourceId: team.id, confidence: 90, sourceUpdatedAt: team.updatedAt || team.createdAt,
    });
  }
  for (const artifact of workspace.artifacts || []) {
    node(ownerId, workspace.id, {
      id: stableId("artifact", artifact.id), type: "artifact", title: artifact.title, summary: artifact.summary, status: statusFor(artifact.status), freshness: artifact.freshness || freshnessFor(artifact.updatedAt || artifact.createdAt, now, staleAfterMs), sourceType: "artifact", sourceId: artifact.id, artifactIds: [artifact.id], confidence: 90, sourceUpdatedAt: artifact.updatedAt || artifact.createdAt,
    });
  }
  if (requirement) {
    for (const task of taskNodes.values()) atlas.addKnowledgeEdge(ownerId, workspace.id, { type: "satisfies", sourceId: task.id, targetId: requirement.id, rationale: "Task belongs to the active project contract." });
  }
  for (const task of workspace.tasks || []) {
    for (const dependencyId of task.dependsOn || []) {
      const source = taskNodes.get(task.id); const target = taskNodes.get(dependencyId);
      if (source && target) atlas.addKnowledgeEdge(ownerId, workspace.id, { type: "depends_on", sourceId: source.id, targetId: target.id, rationale: "Task dependency recorded in Atlas." });
    }
    for (const evidenceId of task.evidenceIds || []) {
      const source = evidenceNodes.get(evidenceId); const target = taskNodes.get(task.id);
      if (source && target) atlas.addKnowledgeEdge(ownerId, workspace.id, { type: "supports", sourceId: source.id, targetId: target.id, rationale: "Evidence attached to task.", provenanceIds: [evidenceId] });
    }
  }
  for (const outcome of Object.values(workspace.missionOutcomes || {})) {
    const evidenceNode = evidenceNodes.get(outcome.evidenceId);
    const taskNode = taskNodes.get(outcome.taskId);
    if (evidenceNode && taskNode) atlas.addKnowledgeEdge(ownerId, workspace.id, { type: "supports", sourceId: evidenceNode.id, targetId: taskNode.id, rationale: "Durable mission outcome reconciled into task evidence.", provenanceIds: [outcome.evidenceId] });
  }
  atlas.updateKnowledgeMeta(ownerId, workspace.id, { lastProjectedAt: now });
  const projected = atlas.getWorkspace(ownerId, workspace.id);
  return { workspace: projected, revision: projected.knowledgeRevision || 0, projectedAt: projected.lastProjectedAt || now };
}

function graphSummary(workspace) {
  const counts = {};
  for (const node of workspace?.knowledgeNodes || []) counts[node.type] = (counts[node.type] || 0) + 1;
  return { revision: workspace?.knowledgeRevision || 0, lastProjectedAt: workspace?.lastProjectedAt || 0, nodeCount: workspace?.knowledgeNodes?.length || 0, edgeCount: workspace?.knowledgeEdges?.length || 0, artifactCount: workspace?.artifacts?.length || 0, counts };
}

function knowledgeHealth(workspace, options = {}) {
  const now = Date.now();
  const staleAfterMs = Math.max(60 * 60 * 1000, Math.min(365 * 24 * 60 * 60 * 1000, Number(options.staleAfterMs) || DEFAULT_STALE_AFTER_MS));
  const nodes = workspace?.knowledgeNodes || [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const orphanEdges = (workspace?.knowledgeEdges || []).filter((edge) => !nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId));
  const staleNodes = nodes.filter((node) => node.freshness === "stale" || (node.sourceUpdatedAt && now - node.sourceUpdatedAt > staleAfterMs));
  const conflicts = [];
  for (const edge of workspace?.knowledgeEdges || []) {
    if (edge.type !== "supports") continue;
    if ((workspace.knowledgeEdges || []).some((other) => other.type === "contradicts" && other.sourceId === edge.sourceId && other.targetId === edge.targetId)) conflicts.push({ support: edge, contradiction: (workspace.knowledgeEdges || []).find((other) => other.type === "contradicts" && other.sourceId === edge.sourceId && other.targetId === edge.targetId) });
  }
  return { staleAfterMs, staleNodes, orphanEdges, conflicts, ok: !staleNodes.length && !orphanEdges.length && !conflicts.length };
}

function queryKnowledge(ownerId, workspaceId, query = "", options = {}) {
  const projection = projectWorkspace(ownerId, workspaceId, options);
  if (!projection) return null;
  const workspace = projection.workspace;
  const term = clean(query, 300).toLowerCase();
  const nodes = (workspace.knowledgeNodes || []).filter((node) => (!options.type || node.type === options.type) && (!term || [node.title, node.summary, node.type, node.sourceId].some((value) => String(value || "").toLowerCase().includes(term)))).slice(0, Math.max(1, Math.min(50, Number(options.limit) || 12)));
  return { summary: graphSummary(workspace), nodes, edges: workspace.knowledgeEdges || [], artifacts: workspace.artifacts || [], health: knowledgeHealth(workspace, options) };
}

function traceArtifact(ownerId, workspaceId, query = "") {
  const projection = projectWorkspace(ownerId, workspaceId);
  if (!projection) return null;
  const workspace = projection.workspace;
  const term = clean(query, 240).toLowerCase();
  const artifact = workspace.artifacts.find((item) => item.id.toLowerCase() === term || item.title.toLowerCase().includes(term) || item.url?.toLowerCase().includes(term) || item.localPath?.toLowerCase().includes(term));
  if (!artifact) return { artifact: null, nodes: [], edges: [] };
  const nodeId = stableId("artifact", artifact.id);
  const edges = workspace.knowledgeEdges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId);
  const relatedIds = new Set([nodeId, ...edges.map((edge) => edge.sourceId), ...edges.map((edge) => edge.targetId)]);
  return { artifact, nodes: workspace.knowledgeNodes.filter((node) => relatedIds.has(node.id)), edges };
}

function addKnowledgeNode(ownerId, workspaceId, input = {}) {
  if (!NODE_TYPES.includes(input.type)) return null;
  return node(ownerId, workspaceId, { ...input, sourceType: input.sourceType || "owner_note", sourceId: input.sourceId || `note_${crypto.randomUUID()}` });
}

function linkKnowledge(ownerId, workspaceId, input = {}) {
  if (!EDGE_TYPES.includes(input.type)) return null;
  return atlas.addKnowledgeEdge(ownerId, workspaceId, input);
}

function addProjectArtifact(ownerId, workspaceId, input = {}) {
  const url = String(input.url || "").trim();
  const localPath = String(input.localPath || "").trim();
  if (!url && !localPath) return null;
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return null;
  if (localPath && (localPath.startsWith("/") || localPath.includes(".."))) return null;
  return atlas.addArtifact(ownerId, workspaceId, input);
}

function formatHealth(health) {
  const lines = [`Graph health: ${health.ok ? "healthy" : "needs review"}`, `Stale nodes: ${health.staleNodes.length}`, `Orphan edges: ${health.orphanEdges.length}`, `Conflicts: ${health.conflicts.length}`];
  if (health.staleNodes.length) lines.push(`\nStale: ${health.staleNodes.slice(0, 5).map((node) => `${node.title} [${node.id}]`).join("; ")}`);
  if (health.conflicts.length) lines.push(`\nConflicting relationships: ${health.conflicts.slice(0, 5).map((item) => `${item.support.sourceId} → ${item.support.targetId}`).join("; ")}`);
  return lines.join("\n");
}

function formatKnowledge(result) {
  if (!result) return "I don’t have an active Atlas workspace yet.";
  const nodes = result.nodes.length ? result.nodes.map((node) => `• ${node.type}: ${node.title} [${node.id}]${node.freshness === "stale" ? " · stale" : ""}`).join("\n") : "• No matching knowledge nodes.";
  const counts = Object.entries(result.summary.counts).map(([type, count]) => `${type} ${count}`).join(" · ");
  return `🧠 *Project knowledge*\nRevision: ${result.summary.revision}\nNodes: ${result.summary.nodeCount} · Edges: ${result.summary.edgeCount} · Artifacts: ${result.summary.artifactCount}\n${counts ? `Types: ${counts}\n` : ""}\n${nodes}\n\n${formatHealth(result.health)}`;
}

function formatTrace(trace) {
  if (!trace?.artifact) return "I couldn’t find that artifact in the project vault.";
  return `🗂️ *Artifact trace*\n${trace.artifact.title}\nID: ${trace.artifact.id}\nKind: ${trace.artifact.kind}\nSource: ${trace.artifact.sourceType || "unknown"} ${trace.artifact.sourceId || ""}\n${trace.artifact.url || trace.artifact.localPath || "No access location recorded."}\n\nRelated nodes:\n${trace.nodes.map((node) => `• ${node.type}: ${node.title}`).join("\n") || "• None"}\n\nRelationships: ${trace.edges.length}`;
}

function handleKnowledge(ownerId, text, options = {}) {
  const input = clean(text, 1200);
  const lower = input.toLowerCase();
  const workspace = findWorkspace(ownerId, options.workspaceId);
  if (!workspace) return { kind: "text", text: "I need an active Atlas project before I can inspect project knowledge." };
  if (/\bstale\b.*(?:knowledge|project|nodes)|\bwhat is stale\b/i.test(lower)) return { kind: "text", text: formatHealth(knowledgeHealth(projectWorkspace(ownerId, workspace.id, options).workspace, options)) };
  if (/\b(?:conflicts?|contradictions?)\b.*(?:project|knowledge|graph)|\bwhat conflicts\b/i.test(lower)) return { kind: "text", text: formatHealth(knowledgeHealth(projectWorkspace(ownerId, workspace.id, options).workspace, options)) };
  if (/\bwhat\s+supports\b|\bwhat\s+is\s+blocking\s+this\s+project\b/i.test(lower)) return { kind: "text", text: formatKnowledge(queryKnowledge(ownerId, workspace.id, input.replace(/^(?:what\s+supports|what\s+is\s+blocking)\s*/i, ""), options)) };
  if (/\b(?:show|refresh|rebuild|project|what changed).*(?:knowledge|graph)|\bknowledge graph\b|\bproject knowledge\b/i.test(lower)) return { kind: "text", text: formatKnowledge(queryKnowledge(ownerId, workspace.id, "", options)) };
  if (/\btrace\b.*\b(?:artifact|output|file|report)\b|\bartifact\s+trace\b/i.test(lower)) {
    const query = input.replace(/^.*?\b(?:artifact|output|file|report)\b\s*/i, "").trim();
    return { kind: "text", text: formatTrace(traceArtifact(ownerId, workspace.id, query || "artifact")) };
  }
  if (/\badd\b.*\bartifact\b|\bartifact\b.*\b(?:vault|project)\b/i.test(lower)) {
    const url = input.match(/https?:\/\/\S+/i)?.[0] || null;
    const title = clean(input.replace(/https?:\/\/\S+/i, "").replace(/^.*?\bartifact\b\s*(?:to|in|for)?\s*/i, ""), 240) || "Project artifact";
    const stored = addProjectArtifact(ownerId, workspace.id, { title, url, kind: "owner_recorded", sourceType: "whatsapp", sourceId: `whatsapp_${Date.now()}` });
    return { kind: "text", text: stored ? `🗂️ Added artifact to *${workspace.title}*: ${stored.artifact.title}${stored.duplicate ? " (already recorded)" : ""}` : "I could not record that artifact. Provide a safe HTTP(S) URL or a project-relative path." };
  }
  if (/\brecord\b.*\brequirement\b|\badd\b.*\brequirement\b/i.test(lower)) {
    const summary = clean(input.replace(/^.*?\brequirement\b\s*[:,-]?\s*/i, ""), 1200);
    const created = addKnowledgeNode(ownerId, workspace.id, { type: "requirement", title: summary || "Owner requirement", summary: summary || "Requirement recorded by the owner.", confidence: 95 });
    return { kind: "text", text: created ? `✅ Requirement recorded: ${created.title} [${created.id}]` : "I could not record that requirement." };
  }
  if (/\blink\b.*\b(?:evidence|artifact|decision|requirement)\b/i.test(lower)) {
    const ids = [...input.matchAll(/\b(?:node|evidence|artifact|decision|task|knowledge)_[a-z0-9_-]+\b/gi)].map((match) => match[0]);
    const type = EDGE_TYPES.find((candidate) => lower.includes(candidate.replace("_", " "))) || "related_to";
    if (ids.length >= 2) {
      const result = linkKnowledge(ownerId, workspace.id, { type, sourceId: ids[0], targetId: ids[1], rationale: "Linked from the owner’s Atlas conversation." });
      return { kind: "text", text: result?.edge ? `${result.duplicate ? "That relationship already exists" : "Relationship recorded"}: ${type} ${ids[0]} → ${ids[1]}.` : "I could not link those IDs. Both nodes must exist in this workspace." };
    }
    return { kind: "text", text: "Tell me the two knowledge node IDs to link, for example: link evidence_<id> supports decision_<id>." };
  }
  return { kind: "text", text: formatKnowledge(queryKnowledge(ownerId, workspace.id, input, options)) };
}

module.exports = { EDGE_TYPES, NODE_TYPES, projectWorkspace, graphSummary, knowledgeHealth, queryKnowledge, traceArtifact, addKnowledgeNode, linkKnowledge, addProjectArtifact, formatKnowledge, formatTrace, handleKnowledge };
