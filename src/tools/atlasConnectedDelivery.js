// Atlas V8 Connected Delivery: verified provider awareness and owner proposals.
// This module observes signed Sentinel signals and never performs provider-side
// commits, merges, deploys, rollbacks, or configuration changes.

const atlas = require("./atlasStore");

const STATUS_ORDER = ["not_configured", "observing", "needs_review", "blocked", "ready_for_owner_review", "approved_no_side_effect", "released_verified", "unknown"];
const PROBLEM_SEVERITIES = new Set(["high", "critical"]);

function clean(value, max = 600) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function ownerWorkspace(ownerId, query = "") {
  return atlas.findWorkspace(ownerId, query);
}

function sourceMapping(workspace) {
  return {
    github: clean(workspace?.connectedDelivery?.github?.repository || workspace?.sentinel?.sources?.github?.repository, 160).toLowerCase() || null,
    render: clean(workspace?.connectedDelivery?.render?.serviceId || workspace?.sentinel?.sources?.render?.serviceId, 140) || null,
  };
}

function activeSignals(workspace) {
  return (workspace?.signals || [])
    .filter((signal) => !["resolved", "ignored"].includes(String(signal.status || "").toLowerCase()))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

function healthProblem(workspace) {
  return ["github", "render"].some((source) => {
    const status = workspace?.sentinel?.health?.[source]?.status;
    return status === "misconfigured" || status === "failed";
  });
}

function assessment(workspace, delivery) {
  const mapping = sourceMapping(workspace);
  if (!delivery.enabled || (!mapping.github && !mapping.render)) return "not_configured";
  const signals = activeSignals(workspace);
  const severe = signals.find((signal) => PROBLEM_SEVERITIES.has(signal.severity));
  if (healthProblem(workspace) || severe) return severe?.severity === "critical" ? "blocked" : "needs_review";
  const openBrief = (workspace.briefs || []).find((brief) => !["resolved", "rejected"].includes(brief.status) && ["medium", "high", "critical"].includes(brief.severity || "medium"));
  if (openBrief) return "needs_review";
  const renderDeploy = delivery.render?.lastDeploy;
  const githubDeploy = delivery.github?.lastEvent?.kind === "deployment_status" ? delivery.github.lastEvent : null;
  const successfulDeploy = [renderDeploy, githubDeploy].find((event) => event && ["success", "succeeded"].includes(String(event.status || event.action || "").toLowerCase()));
  if (successfulDeploy) return "released_verified";
  return "ready_for_owner_review";
}

function dedupeIds(values, max = 30) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))].slice(-max);
}

function eventSnapshot(signal) {
  return {
    id: clean(signal.id || signal.sourceId, 160) || null,
    source: clean(signal.source, 40) || null,
    kind: clean(signal.kind, 80) || null,
    action: clean(signal.action, 80) || null,
    status: clean(signal.source === "render" ? (signal.action || signal.state || signal.status) : (signal.status && signal.status !== "new" ? signal.status : signal.conclusion || signal.state || signal.action), 60) || null,
    title: clean(signal.title, 240),
    at: Number(signal.at) || Date.now(),
  };
}

function updateProviderSnapshot(current, signal) {
  const snapshot = eventSnapshot(signal);
  const next = { ...current };
  if (signal.source === "github") {
    next.lastEvent = snapshot;
    if (["check_run", "check_suite"].includes(signal.kind)) next.lastCheck = snapshot;
    if (signal.kind === "pull_request") next.lastPullRequest = snapshot;
    if (signal.kind === "deployment_status" && ["success", "succeeded"].includes(String(signal.action || "").toLowerCase())) next.lastEvent = snapshot;
    if (signal.kind === "pull_request" && signal.action === "closed" && signal.merged) next.lastMergeAt = snapshot.at;
  }
  if (signal.source === "render") {
    next.lastEvent = snapshot;
    if (signal.kind === "build_ended") next.lastBuild = snapshot;
    if (signal.kind === "deploy_ended") next.lastDeploy = snapshot;
    if (String(signal.kind || "").startsWith("server_")) next.availability = signal.kind === "server_failed" ? "failed" : "available";
  }
  return next;
}

function proposalForSignal(signal) {
  if (!PROBLEM_SEVERITIES.has(signal.severity)) return null;
  const kind = `${signal.source}_${signal.kind}_${signal.action || "event"}`;
  return {
    id: `delivery_${signal.id}`,
    kind,
    title: `Review connected delivery: ${clean(signal.title, 180)}`,
    rationale: clean(signal.summary || "A verified provider signal needs owner review before release work continues.", 1400),
    evidenceIds: signal.evidenceId ? [signal.evidenceId] : [],
    signalIds: signal.id ? [signal.id] : [],
    actionLevel: signal.severity === "critical" ? "propose" : "prepare",
    status: "open",
  };
}

function recordVerifiedSignal(ownerId, workspaceId, signal = {}) {
  const workspace = atlas.getWorkspace(ownerId, workspaceId);
  if (!workspace || !signal?.source) return null;
  const current = atlas.getConnectedDelivery(ownerId, workspaceId) || {};
  const mapping = sourceMapping(workspace);
  const next = {
    ...current,
    enabled: current.enabled !== false,
    github: signal.source === "github" ? updateProviderSnapshot({ ...current.github, repository: current.github?.repository || mapping.github }, signal) : current.github,
    render: signal.source === "render" ? updateProviderSnapshot({ ...current.render, serviceId: current.render?.serviceId || mapping.render }, signal) : current.render,
    release: {
      ...(current.release || {}),
      signalIds: dedupeIds([...(current.release?.signalIds || []), signal.id]),
      evidenceIds: dedupeIds([...(current.release?.evidenceIds || []), signal.evidenceId]),
      lastAssessedAt: Date.now(),
    },
    lastVerifiedAt: Number(signal.at) || Date.now(),
  };
  const stored = atlas.updateConnectedDelivery(ownerId, workspaceId, next);
  const proposal = proposalForSignal(signal);
  if (proposal) atlas.addConnectedProposal(ownerId, workspaceId, proposal);
  const refreshed = atlas.getWorkspace(ownerId, workspaceId);
  const latest = atlas.getConnectedDelivery(ownerId, workspaceId) || stored;
  if (latest) {
    const status = assessment(refreshed, latest);
    atlas.updateConnectedDelivery(ownerId, workspaceId, { status, release: { ...(latest.release || {}), status, lastAssessedAt: Date.now() } });
  }
  return atlas.getConnectedDelivery(ownerId, workspaceId);
}

function configureConnectedDelivery(ownerId, query, input = {}) {
  const workspace = ownerWorkspace(ownerId, query);
  if (!workspace) return null;
  const github = clean(input.repository || input.githubRepository || input.github, 160).toLowerCase() || null;
  const serviceId = clean(input.serviceId || input.renderServiceId || input.render, 140) || null;
  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);
  const current = atlas.getConnectedDelivery(ownerId, workspace.id) || {};
  const next = atlas.updateConnectedDelivery(ownerId, workspace.id, {
    enabled,
    status: enabled && (github || serviceId) ? "observing" : "not_configured",
    github: { ...(current.github || {}), ...(github ? { repository: github } : {}) },
    render: { ...(current.render || {}), ...(serviceId ? { serviceId } : {}) },
  });
  if (github || serviceId) atlas.configureSentinel(ownerId, workspace.id, { enabled: true, sources: { github: { repository: github || current.github?.repository || null }, render: { serviceId: serviceId || current.render?.serviceId || null } } });
  return next;
}

function connectedDelivery(ownerId, query = "") {
  const workspace = ownerWorkspace(ownerId, query);
  if (!workspace) return null;
  const delivery = atlas.getConnectedDelivery(ownerId, workspace.id) || {};
  const mapping = sourceMapping(workspace);
  const proposals = atlas.listConnectedProposals(ownerId, workspace.id);
  const status = assessment(workspace, delivery);
  if (status !== delivery.status || status !== delivery.release?.status) {
    atlas.updateConnectedDelivery(ownerId, workspace.id, { status, release: { ...(delivery.release || {}), status, lastAssessedAt: Date.now() } });
  }
  return {
    workspaceId: workspace.id,
    title: workspace.title,
    enabled: Boolean(delivery.enabled),
    status,
    revision: delivery.revision || 0,
    mapping,
    github: delivery.github,
    render: delivery.render,
    release: { ...(delivery.release || {}), status },
    proposals,
    health: {
      github: workspace.sentinel?.health?.github || null,
      render: workspace.sentinel?.health?.render || null,
    },
  };
}

function formatTime(value) {
  if (!value) return "never";
  try { return new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC"; } catch (_) { return "unknown"; }
}

function formatConnected(ownerId, query = "") {
  const state = connectedDelivery(ownerId, query);
  if (!state) return "I don’t have an Atlas workspace yet. Create a project before connecting delivery signals.";
  const github = state.mapping.github ? `${state.mapping.github} · last verified ${formatTime(state.github?.lastEvent?.at)}` : "not mapped";
  const render = state.mapping.render ? `${state.mapping.render} · last verified ${formatTime(state.render?.lastEvent?.at)}` : "not mapped";
  const open = state.proposals.filter((proposal) => proposal.status === "open");
  let text = `🔗 *Atlas Connected Delivery — ${state.title}*\n\nStatus: *${state.status}*\nMode: ${state.enabled ? "observing verified provider signals" : "disabled"}\nRevision: ${state.revision}\n\n*GitHub*\n• ${github}\n• checks: ${state.github?.lastCheck?.title || "none recorded"}\n• pull request: ${state.github?.lastPullRequest?.title || "none recorded"}\n\n*Render*\n• ${render}\n• build: ${state.render?.lastBuild?.title || "none recorded"}\n• deploy: ${state.render?.lastDeploy?.title || "none recorded"}\n• availability: ${state.render?.availability || "unknown"}`;
  if (state.release?.evidenceIds?.length) text += `\n\nEvidence: ${state.release.evidenceIds.slice(-5).join(", ")}`;
  text += open.length ? `\n\n*Owner proposals*\n${open.slice(0, 5).map((proposal) => `• ${proposal.id} · ${proposal.title}\n  ${proposal.rationale}`).join("\n")}` : "\n\nOwner proposals: none open.";
  text += "\n\nThis is verified awareness and release guidance. It does not commit, merge, deploy, rollback, post, or change provider settings automatically.";
  return text;
}

function formatProposals(ownerId, query = "") {
  const state = connectedDelivery(ownerId, query);
  if (!state) return "No connected-delivery workspace is available.";
  const proposals = state.proposals.filter((proposal) => proposal.status === "open");
  if (!proposals.length) return `There are no open connected-delivery proposals for *${state.title}*.`;
  return `🔎 *Connected-delivery proposals — ${state.title}*\n\n${proposals.map((proposal) => `*${proposal.id}* · ${proposal.actionLevel}\n${proposal.title}\n${proposal.rationale}\nEvidence: ${proposal.evidenceIds.join(", ") || "none"}`).join("\n\n")}\n\nApprove records intent only; it does not trigger a provider-side action.`;
}

function proposalId(input) {
  return String(input || "").match(/\bdelivery_[a-z0-9_-]+\b/i)?.[0] || null;
}

function handleConnectedDelivery(ownerId, input, options = {}) {
  const text = clean(input, 800);
  const lower = text.toLowerCase();
  const query = options.query || "";
  if (/\b(?:map|connect|configure)\b.*\b(?:github|render|delivery)\b/i.test(lower)) {
    const repository = text.match(/(?:github\s+)?(?:repo(?:sitory)?\s+)?([a-z0-9_.-]+\/[a-z0-9_.-]+)/i)?.[1] || null;
    const serviceId = text.match(/\b(?:service|render)\s+(srv-[a-z0-9]+)\b/i)?.[1] || null;
    if (!repository && !serviceId) return { kind: "text", text: "Tell me the GitHub repository (`owner/repo`) and/or Render service ID (`srv-...`) to map into the current Atlas workspace. I will record the mapping and enable verified awareness; I will not create provider webhooks automatically." };
    const configured = configureConnectedDelivery(ownerId, query, { repository, serviceId });
    return { kind: "text", text: configured ? `Connected-delivery mapping saved for the current workspace. GitHub: ${configured.github.repository || "not mapped"}; Render: ${configured.render.serviceId || "not mapped"}. Add the signed webhook secrets and provider-side webhook entries separately, then say “show connected delivery”.` : "I couldn't save that mapping because no Atlas workspace was found." };
  }
  if (/\b(?:show|view|check|what(?:'s| is)|status|is)\b.*\b(?:connected delivery|delivery status|release ready|release readiness|deployment evidence|github|render)\b/i.test(lower) || /\b(?:release ready|release readiness|connected delivery|delivery status)\b/i.test(lower)) {
    return { kind: "text", text: formatConnected(ownerId, query) };
  }
  if (/\b(?:show|list|view|what are)\b.*\b(?:delivery )?(?:proposals|decisions)\b/i.test(lower)) {
    return { kind: "text", text: formatProposals(ownerId, query) };
  }
  if (/\b(?:approve|accept)\b.*\bdelivery[_ ]/i.test(lower)) {
    const id = proposalId(text);
    const workspace = ownerWorkspace(ownerId, query);
    const updated = workspace && id && atlas.updateConnectedProposal(ownerId, workspace.id, id, { status: "approved", decisionBy: ownerId, decisionNote: "Owner approved connected-delivery intent; no provider side effect executed.", decidedAt: Date.now() });
    if (!updated) return { kind: "text", text: `I couldn't find connected-delivery proposal *${id || ""}*.` };
    atlas.updateConnectedDelivery(ownerId, workspace.id, { status: "approved_no_side_effect", release: { status: "approved_no_side_effect", proposalId: id, lastAssessedAt: Date.now() } });
    return { kind: "text", text: `Approved *${id}* as an owner decision. No commit, merge, deploy, rollback, external post, or provider configuration change was executed.` };
  }
  if (/\b(?:reject|decline)\b.*\bdelivery[_ ]/i.test(lower) || /\bresolve\b.*\bdelivery[_ ]/i.test(lower)) {
    const id = proposalId(text);
    const workspace = ownerWorkspace(ownerId, query);
    const status = /\breject|decline\b/i.test(lower) ? "rejected" : "resolved";
    const updated = workspace && id && atlas.updateConnectedProposal(ownerId, workspace.id, id, { status, decisionBy: ownerId, decisionNote: `Owner marked this proposal ${status}.`, decidedAt: Date.now() });
    return { kind: "text", text: updated ? `Marked *${id}* as ${status}. This changed Atlas decision state only; no provider side effect was executed.` : `I couldn't find connected-delivery proposal *${id || ""}*.` };
  }
  if (/\b(?:what failed|failed|failure|problem|incident)\b.*\b(?:github|render|delivery|deployment|build|check)\b/i.test(lower)) return { kind: "text", text: formatConnected(ownerId, query) };
  return { kind: "text", text: formatConnected(ownerId, query) };
}

module.exports = {
  configureConnectedDelivery,
  connectedDelivery,
  formatConnected,
  formatProposals,
  handleConnectedDelivery,
  recordVerifiedSignal,
  assessment,
};
