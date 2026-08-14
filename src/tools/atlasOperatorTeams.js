// Atlas V6 Delegated Operator Teams: bounded specialist role packets coordinated
// through the existing durable mission engine and Atlas workspace persistence.

const crypto = require("crypto");
const atlas = require("./atlasStore");
const missions = require("./durableMissions");

const ROLE_ORDER = ["researcher", "designer", "builder", "verifier", "release_reviewer"];
const READ_ONLY_ROLES = new Set(["researcher", "verifier"]);
const TERMINAL_MISSIONS = new Set(["completed", "failed", "needs_review", "cancelled"]);
const ROLE_DEFS = {
  researcher: {
    label: "Researcher",
    objective: (project) => `Gather relevant facts, constraints, alternatives, and source-backed evidence for: ${project}`,
    criterion: "Return source-backed findings, unresolved questions, and concrete design inputs.",
  },
  designer: {
    label: "Designer",
    objective: (project) => `Turn the accepted research into a bounded implementation proposal for: ${project}`,
    criterion: "Return a proposed approach, dependencies, acceptance criteria, risks, and owner decisions needed.",
  },
  builder: {
    label: "Builder",
    objective: (project) => `Produce the bounded local implementation work described by the accepted handoffs for: ${project}`,
    criterion: "Return the work performed, changed surfaces, checks run, and remaining gaps without claiming unperformed side effects.",
  },
  verifier: {
    label: "Verifier",
    objective: (project) => `Verify the current result against the explicit acceptance criteria for: ${project}`,
    criterion: "Return STATUS: PASS, STATUS: BLOCKED, or STATUS: NEEDS_REVIEW with evidence and failed checks.",
  },
  release_reviewer: {
    label: "Release reviewer",
    objective: (project) => `Assess release readiness, rollback planning, and unresolved risks for: ${project}`,
    criterion: "Return a release recommendation, required owner approvals, rollback notes, and unresolved risks.",
  },
};

function clean(value, max = 4000) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function findWorkspace(ownerId, workspaceId) {
  return workspaceId ? atlas.getWorkspace(ownerId, workspaceId) : atlas.findWorkspace(ownerId);
}

function normalizeRoles(roles) {
  const requested = Array.isArray(roles) ? roles.map((role) => String(role).toLowerCase().trim()) : [];
  const selected = requested.filter((role, index) => ROLE_ORDER.includes(role) && requested.indexOf(role) === index);
  return selected.length ? selected : ROLE_ORDER.slice();
}

function packetDefinitions(objective, roles, budgets = {}) {
  const maxAttempts = Math.max(1, Math.min(3, Number(budgets.maxAttemptsPerPacket) || 2));
  const timeoutMs = Math.max(1000, Math.min(15 * 60 * 1000, Number(budgets.maxDurationMs) || 15 * 60 * 1000));
  return roles.map((role) => ({
    id: "packet_" + crypto.randomUUID(),
    role,
    status: "pending",
    objective: ROLE_DEFS[role].objective(objective),
    criterion: ROLE_DEFS[role].criterion,
    inputHandoffIds: [],
    missionId: null,
    outputHandoffId: null,
    evidenceIds: [],
    attempts: 0,
    maxAttempts,
    timeoutMs,
    startedAt: 0,
    completedAt: 0,
    blockedReason: "",
    recoveryProposal: "",
    result: "",
    lastReconciledStatus: null,
    lastReconciledAt: 0,
  }));
}

function createOperatorTeam(ownerId, workspaceId, input = {}) {
  const workspace = findWorkspace(ownerId, workspaceId);
  if (!workspace) return null;
  const objective = clean(input.objective || input.title || workspace.contract.outcome, 800);
  const roles = normalizeRoles(input.roles);
  return atlas.addOperatorTeam(ownerId, workspace.id, {
    objective,
    state: "draft",
    currentPacketIndex: 0,
    packets: packetDefinitions(objective, roles, input.budgets),
    handoffs: [],
    budgets: input.budgets,
  });
}

function getTeam(ownerId, workspaceId, teamId) {
  return atlas.getOperatorTeam(ownerId, workspaceId, teamId);
}

function latestTeam(ownerId, workspaceId) {
  return atlas.listOperatorTeams(ownerId, workspaceId)[0] || null;
}

function patchPacket(ownerId, workspaceId, teamId, packetId, patch) {
  const team = getTeam(ownerId, workspaceId, teamId);
  if (!team) return null;
  const packets = team.packets.map((packet) => packet.id === packetId ? { ...packet, ...patch } : packet);
  return atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { packets });
}

function teamApproval(team, role) {
  return {
    id: "team_approval_" + crypto.randomUUID(),
    prompt: `The ${ROLE_DEFS[role].label} packet is ready for the next bounded step. Approve only this packet; no commit, deploy, external post, permission change, spending, or deletion will happen automatically.`,
    decision: null,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    resolvedAt: 0,
  };
}

function acceptedHandoffs(team, packet) {
  return (packet.inputHandoffIds || [])
    .map((id) => team.handoffs.find((handoff) => handoff.id === id))
    .filter((handoff) => handoff && handoff.status === "accepted");
}

function missionObjective(team, packet) {
  const handoffs = acceptedHandoffs(team, packet).map((handoff) => `From ${handoff.fromRole}: ${handoff.summary}`).join("\n\n");
  const handoffContext = handoffs ? `\n\nAccepted handoffs:\n${handoffs.slice(0, 9000)}` : "\n\nNo prior handoff exists; establish the first bounded result.";
  return [
    `You are the ${ROLE_DEFS[packet.role].label} role in an ARIA Atlas operator team.`,
    `Team objective: ${team.objective}`,
    `Your bounded packet: ${packet.objective}`,
    `Acceptance criterion: ${packet.criterion}`,
    handoffContext,
    "Return exactly these headings:",
    "STATUS: PASS | BLOCKED | NEEDS_REVIEW",
    "SUMMARY: concise concrete result",
    "EVIDENCE: facts, checks, or sources actually obtained",
    "HANDOFF: what the next role can safely use",
    "DECISIONS: owner decisions required, or NONE",
    "UNRESOLVED: remaining questions, or NONE",
    "Do not claim to have committed, deployed, posted, changed permissions, spent money, or deleted data unless an explicitly approved tool actually performed it.",
  ].join("\n");
}

function parseRoleResult(result) {
  const text = clean(result, 4000);
  const statusMatch = text.match(/(?:^|\n)\s*STATUS\s*:\s*(PASS|BLOCKED|NEEDS_REVIEW)\b/i);
  const status = statusMatch?.[1]?.toLowerCase() || "needs_review";
  const summary = clean(text.match(/(?:^|\n)\s*SUMMARY\s*:\s*([\s\S]*?)(?=\n\s*(?:EVIDENCE|HANDOFF|DECISIONS|UNRESOLVED)\s*:|$)/i)?.[1] || text, 1200);
  const evidence = clean(text.match(/(?:^|\n)\s*EVIDENCE\s*:\s*([\s\S]*?)(?=\n\s*(?:HANDOFF|DECISIONS|UNRESOLVED)\s*:|$)/i)?.[1] || text, 1600);
  const handoff = clean(text.match(/(?:^|\n)\s*HANDOFF\s*:\s*([\s\S]*?)(?=\n\s*(?:DECISIONS|UNRESOLVED)\s*:|$)/i)?.[1] || summary, 1600);
  const decisionsText = text.match(/(?:^|\n)\s*DECISIONS\s*:\s*([\s\S]*?)(?=\n\s*UNRESOLVED\s*:|$)/i)?.[1] || "NONE";
  const unresolvedText = text.match(/(?:^|\n)\s*UNRESOLVED\s*:\s*([\s\S]*)$/i)?.[1] || "NONE";
  const list = (value) => value.split(/\s*[;|]\s*|\n/).map((item) => clean(item, 400)).filter((item) => item && !/^none$/i.test(item)).slice(0, 12);
  return { status, hasStatus: Boolean(statusMatch), summary, evidence, handoff, decisions: list(decisionsText), unresolvedQuestions: list(unresolvedText), text };
}

function formatTeam(team) {
  if (!team) return "No operator team exists for this workspace yet.";
  const rows = team.packets.map((packet, index) => `${packet.status === "completed" ? "✅" : packet.status === "running" ? "▶️" : packet.status === "blocked" ? "⛔" : packet.status === "awaiting_approval" ? "🛑" : "○"} ${index + 1}. ${ROLE_DEFS[packet.role]?.label || packet.role} — ${packet.status} · ${packet.attempts}/${packet.maxAttempts} attempts`).join("\n");
  const current = team.packets[team.currentPacketIndex];
  return `🧩 *Operator team ${team.id}*\nState: ${team.state}\nObjective: ${team.objective}\nCurrent role: ${current ? ROLE_DEFS[current.role]?.label || current.role : "none"}\n${team.blockedReason ? `Blocked: ${team.blockedReason}\n` : ""}${team.recoveryProposal ? `Recovery: ${team.recoveryProposal}\n` : ""}\n*Role packets*\n${rows || "No role packets."}`;
}

function formatHandoff(team) {
  if (!team || !team.handoffs.length) return "No accepted operator-team handoff exists yet.";
  const handoff = team.handoffs[team.handoffs.length - 1];
  return `🔁 *Latest team handoff*\n${handoff.fromRole} → ${handoff.toRole}\nStatus: ${handoff.status}\n\n${handoff.summary}\n\nEvidence: ${handoff.evidenceIds.join(", ") || "none"}${handoff.unresolvedQuestions.length ? `\nUnresolved: ${handoff.unresolvedQuestions.join("; ")}` : ""}`;
}

function startPacket(ownerId, workspaceId, teamId) {
  const team = getTeam(ownerId, workspaceId, teamId);
  if (!team) return { ok: false, message: "Operator team not found." };
  const packet = team.packets[team.currentPacketIndex];
  if (!packet) return { ok: false, message: "The operator team has no current packet." };
  if (packet.status === "running") return { ok: true, team, message: "That role packet is already running." };
  if (packet.status === "completed") return { ok: false, message: "That role packet has already completed." };
  if (packet.attempts >= packet.maxAttempts) return blockTeam(ownerId, workspaceId, team.id, packet.id, "The role packet exhausted its retry budget.");
  const nextAttempts = packet.attempts + 1;
  const missionId = missions.createMission(ownerId, ownerId, missionObjective(team, packet), {
    metadata: {
      atlasWorkspaceId: workspaceId,
      atlasOwnerId: ownerId,
      operatorTeamId: team.id,
      operatorPacketId: packet.id,
      operatorRole: packet.role,
      actionLevel: READ_ONLY_ROLES.has(packet.role) ? "prepare" : "propose",
    },
  });
  const updated = patchPacket(ownerId, workspaceId, team.id, packet.id, { status: "running", missionId, attempts: nextAttempts, startedAt: Date.now(), blockedReason: "", recoveryProposal: "" });
  atlas.updateOperatorTeam(ownerId, workspaceId, team.id, { state: "running", approval: null });
  missions.executeMission(missionId);
  return { ok: true, team: updated || atlas.getOperatorTeam(ownerId, workspaceId, team.id), missionId, message: `${ROLE_DEFS[packet.role].label} packet started. Mission: ${missionId}` };
}

function blockTeam(ownerId, workspaceId, teamId, packetId, reason) {
  const team = getTeam(ownerId, workspaceId, teamId);
  if (!team) return { ok: false, message: "Operator team not found." };
  const packet = team.packets.find((item) => item.id === packetId);
  const updated = patchPacket(ownerId, workspaceId, teamId, packetId, { status: "blocked", blockedReason: clean(reason, 800), recoveryProposal: "Narrow the packet, attach the missing evidence, or approve one bounded retry." });
  atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { state: "blocked", blockedReason: clean(reason, 1000), recoveryProposal: "Narrow the blocked packet, attach the missing evidence, or approve one bounded retry." });
  return { ok: false, team: updated || atlas.getOperatorTeam(ownerId, workspaceId, teamId), message: `${ROLE_DEFS[packet?.role]?.label || "Role"} packet blocked: ${reason}` };
}

function beginOperatorTeam(ownerId, workspaceId, teamId) {
  const team = getTeam(ownerId, workspaceId, teamId);
  if (!team) return { ok: false, message: "Operator team not found." };
  if (!["draft", "paused"].includes(team.state)) return { ok: false, message: `Operator team is already ${team.state}.` };
  const packet = team.packets[team.currentPacketIndex];
  if (!packet) return { ok: false, message: "Operator team has no pending role packet." };
  if (!READ_ONLY_ROLES.has(packet.role)) {
    const approval = teamApproval(team, packet.role);
    const updated = atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { state: "awaiting_approval", approval });
    return { ok: true, requiresApproval: true, team: updated, message: `The ${ROLE_DEFS[packet.role].label} packet needs your approval before it starts. Say “approve team ${teamId}”.` };
  }
  return startPacket(ownerId, workspaceId, teamId);
}

function approveOperatorTeam(ownerId, workspaceId, teamId, decision = "approve") {
  const team = getTeam(ownerId, workspaceId, teamId);
  if (!team || team.state !== "awaiting_approval" || !team.approval) return { ok: false, message: "That operator team is not waiting for approval." };
  if (team.approval.expiresAt && Date.now() > team.approval.expiresAt) {
    const cancelled = atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { state: "cancelled", approval: { ...team.approval, decision: "expired", resolvedAt: Date.now() } });
    return { ok: false, team: cancelled, message: "The team approval expired and the team was cancelled." };
  }
  if (decision !== "approve") {
    const rejected = atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { state: "cancelled", approval: { ...team.approval, decision: "rejected", resolvedAt: Date.now() } });
    return { ok: true, team: rejected, message: "Operator team approval rejected. No consequential role work was started." };
  }
  const approved = atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { approval: { ...team.approval, decision: "approved", resolvedAt: Date.now() }, state: "running" });
  const started = startPacket(ownerId, workspaceId, teamId);
  return { ok: started.ok, team: started.team || approved, message: started.message || `Operator team ${teamId} approved.` };
}

function pauseOperatorTeam(ownerId, workspaceId, teamId) {
  const team = getTeam(ownerId, workspaceId, teamId);
  if (!team || ["completed", "cancelled"].includes(team.state)) return { ok: false, message: "That operator team is not active." };
  const packet = team.packets[team.currentPacketIndex];
  if (packet?.missionId) missions.cancelMission(packet.missionId);
  const paused = atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { state: "paused" });
  if (packet?.id) patchPacket(ownerId, workspaceId, teamId, packet.id, { status: "pending", missionId: null });
  return { ok: true, team: paused, message: `Operator team ${teamId} paused. No new role packet will start until resumed.` };
}

function retryOperatorTeam(ownerId, workspaceId, teamId) {
  const team = getTeam(ownerId, workspaceId, teamId);
  const packet = team?.packets?.[team.currentPacketIndex];
  if (!team || !packet || !["blocked", "needs_review"].includes(packet.status)) return { ok: false, message: "There is no blocked role packet ready for a bounded retry." };
  if (packet.attempts >= packet.maxAttempts) return blockTeam(ownerId, workspaceId, teamId, packet.id, "The role packet retry budget is exhausted.");
  patchPacket(ownerId, workspaceId, teamId, packet.id, { status: "pending", blockedReason: "", recoveryProposal: "" });
  atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { state: "running", blockedReason: "", recoveryProposal: "" });
  return startPacket(ownerId, workspaceId, teamId);
}

function retrospectOperatorTeam(ownerId, workspaceId, teamId) {
  const team = getTeam(ownerId, workspaceId, teamId);
  if (!team) return { ok: false, message: "Operator team not found." };
  const retro = atlas.addRetrospective(ownerId, workspaceId, {
    executionId: team.id,
    outcome: team.state === "completed" ? "Operator team completed." : `Operator team ended in ${team.state}.`,
    highlights: team.handoffs.filter((handoff) => handoff.status === "accepted").map((handoff) => `${handoff.fromRole} → ${handoff.toRole}`),
    failures: team.packets.filter((packet) => ["blocked", "needs_review"].includes(packet.status)).map((packet) => packet.role),
    nextImprovement: team.recoveryProposal || "Keep role acceptance criteria explicit and keep handoffs concise.",
  });
  atlas.updateOperatorTeam(ownerId, workspaceId, team.id, { retrospectiveId: retro.id });
  return { ok: true, retrospective: retro, message: `Retrospective recorded for operator team ${team.id}.` };
}

function advanceAfterPacket(ownerId, workspaceId, teamId, packetIndex) {
  const team = getTeam(ownerId, workspaceId, teamId);
  const nextIndex = packetIndex + 1;
  if (!team || nextIndex >= team.packets.length) {
    if (team) atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { state: "completed", currentPacketIndex: team.packets.length, blockedReason: "", recoveryProposal: "" });
    return { completed: true };
  }
  const next = team.packets[nextIndex];
  const prior = team.packets[packetIndex];
  const inputHandoffIds = team.handoffs.filter((handoff) => handoff.toRole === next.role && handoff.status === "accepted").map((handoff) => handoff.id);
  const packets = team.packets.map((packet, index) => index === nextIndex ? { ...packet, inputHandoffIds } : packet);
  atlas.updateOperatorTeam(ownerId, workspaceId, teamId, { currentPacketIndex: nextIndex, packets, state: READ_ONLY_ROLES.has(next.role) ? "running" : "awaiting_approval", approval: READ_ONLY_ROLES.has(next.role) ? null : teamApproval(team, next.role) });
  if (READ_ONLY_ROLES.has(next.role)) return startPacket(ownerId, workspaceId, teamId);
  return { awaitingApproval: true, nextRole: next.role, priorRole: prior.role };
}

function reconcileOperatorTeamPass(ownerId) {
  let scanned = 0;
  let reconciled = 0;
  for (const workspace of atlas.listWorkspaces(ownerId, { state: "active" })) {
    for (const team of atlas.listOperatorTeams(ownerId, workspace.id)) {
      if (!team || team.state !== "running") continue;
      const packet = team.packets[team.currentPacketIndex];
      if (!packet?.missionId || packet.status !== "running") continue;
      scanned++;
      const mission = missions.getMission(packet.missionId);
      if (!mission || !TERMINAL_MISSIONS.has(mission.status) || packet.lastReconciledStatus === mission.status) continue;
      const parsed = parseRoleResult(mission.result || mission.error || mission.progress || "");
      const acceptedByCompletion = mission.status === "completed" && (parsed.status === "pass" || (packet.role !== "verifier" && !parsed.hasStatus));
      const evidence = atlas.addEvidence(ownerId, workspace.id, { kind: "operator_handoff", title: `${ROLE_DEFS[packet.role].label} packet result`, summary: parsed.text, source: "v6-operator-team" });
      const accepted = acceptedByCompletion;
      const handoffStatus = accepted ? "accepted" : (parsed.status === "blocked" || mission.status === "failed" ? "blocked" : "needs_review");
      const handoff = atlas.addOperatorHandoff(ownerId, workspace.id, team.id, { fromRole: packet.role, toRole: team.packets[team.currentPacketIndex + 1]?.role || "owner", summary: parsed.handoff, evidenceIds: evidence ? [evidence.id] : [], decisions: parsed.decisions, unresolvedQuestions: parsed.unresolvedQuestions, status: handoffStatus });
      patchPacket(ownerId, workspace.id, team.id, packet.id, { status: accepted ? "completed" : handoffStatus, outputHandoffId: handoff?.id || null, evidenceIds: evidence ? [evidence.id] : [], result: parsed.text, completedAt: accepted ? Date.now() : 0, blockedReason: accepted ? "" : (mission.error || "Role output did not pass its acceptance gate."), recoveryProposal: accepted ? "" : "Narrow the role packet, attach missing evidence, or request an owner decision.", lastReconciledStatus: mission.status, lastReconciledAt: Date.now() });
      reconciled++;
      if (accepted) {
        advanceAfterPacket(ownerId, workspace.id, team.id, team.currentPacketIndex);
      } else {
        atlas.updateOperatorTeam(ownerId, workspace.id, team.id, { state: "blocked", blockedReason: `${ROLE_DEFS[packet.role].label} packet needs review.`, recoveryProposal: "Narrow the blocked packet, attach missing evidence, or approve a bounded retry." });
      }
    }
  }
  return { scanned, reconciled };
}

function handleOperatorTeams(ownerId, text, options = {}) {
  const input = clean(text, 1200);
  const lower = input.toLowerCase();
  const workspace = findWorkspace(ownerId, options.workspaceId);
  if (!workspace) return { kind: "text", text: "I need an active Atlas project before I can coordinate an operator team." };
  const id = input.match(/\bteam\s+(team_[a-z0-9_-]+)\b/i)?.[1];
  const team = id ? getTeam(ownerId, workspace.id, id) : latestTeam(ownerId, workspace.id);
  if (/\b(?:show|check|what is|what's)\b.*\bteam\s+status\b|\bteam\s+status\b/i.test(lower)) return { kind: "text", text: formatTeam(team) };
  if (/\b(?:show|check|what is|what's)\b.*\b(?:team handoff|current handoff)\b|\bteam handoff\b/i.test(lower)) return { kind: "text", text: formatHandoff(team) };
  if (/\brelease\s+readiness\b|\breview\b.*\b(?:operator\s+)?team\b/i.test(lower)) return { kind: "text", text: team ? `${formatTeam(team)}\n\nRelease review remains recommendation-only. The owner must approve any consequential release action.` : "No operator team exists for this workspace yet." };
  if (/\b(?:why|what).*(?:team|role).*(?:blocked|stuck)|\bteam\s+blocked\b/i.test(lower)) return { kind: "text", text: team?.blockedReason ? `The operator team is blocked because: ${team.blockedReason}\n\nRecovery: ${team.recoveryProposal || "Review the current packet and evidence."}` : "The operator team is not currently blocked." };
  if (/\b(?:retrospect|retrospective)\b.*\b(?:team|operator)\b/i.test(lower)) return { kind: "text", text: retrospectOperatorTeam(ownerId, workspace.id, team?.id).message };
  if (/\b(?:retry|recover|resume)\b.*\b(?:team|role|packet)\b/i.test(lower)) return { kind: "text", text: retryOperatorTeam(ownerId, workspace.id, team?.id).message };
  if (/\b(?:pause|stop)\b.*\b(?:team|operator)\b/i.test(lower)) return { kind: "text", text: pauseOperatorTeam(ownerId, workspace.id, team?.id).message };
  if (/\b(?:approve|reject)\b.*\b(?:team|role|packet)\b/i.test(lower)) return { kind: "text", text: approveOperatorTeam(ownerId, workspace.id, team?.id, /\breject\b/i.test(lower) ? "reject" : "approve").message };
  if (/\b(?:start|begin|run|create|delegate)\b.*\b(?:operator\s+)?team\b/i.test(lower)) {
    const roles = /\bresearch(?:er)?\s+team\b/i.test(lower) ? ["researcher"] : /\bverify(?:er|ication)?\s+team\b/i.test(lower) ? ["verifier"] : ROLE_ORDER;
    const objective = clean(input.replace(/^.*?\bteam\b\s*(?:for|on|to)?\s*/i, "") || workspace.contract.outcome, 800);
    const created = createOperatorTeam(ownerId, workspace.id, { objective, roles });
    const started = beginOperatorTeam(ownerId, workspace.id, created.id);
    return { kind: "text", text: `🧩 Operator team ${created.id} created for ${created.objective}.\n\n${started.message}` };
  }
  return { kind: "text", text: "V6 operator teams can start a researcher/design/build/verifier/release-review sequence, show team status or handoffs, pause, approve, retry, recover, and retrospect a team." };
}

module.exports = {
  ROLE_ORDER,
  READ_ONLY_ROLES,
  ROLE_DEFS,
  createOperatorTeam,
  beginOperatorTeam,
  approveOperatorTeam,
  pauseOperatorTeam,
  retryOperatorTeam,
  retrospectOperatorTeam,
  reconcileOperatorTeamPass,
  formatTeam,
  formatHandoff,
  handleOperatorTeams,
  parseRoleResult,
};
