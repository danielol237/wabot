// ARIA Atlas V3 Sentinel — durable signal intake and decision briefs.
// Provider payloads are normalized before persistence; unverified webhook
// authentication is handled by atlasWebhooks.js.

const atlas = require("./atlasStore");
const { getSock } = require("./missionSock");

const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;
const STALL_MS = 30 * 60 * 1000;

function clean(value, max = 1000) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function ownerJid(ownerId) {
  const value = String(ownerId || "").trim();
  return value ? (value.includes("@") ? value : value + "@s.whatsapp.net") : null;
}

function severityRank(value) {
  return { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[value] ?? 0;
}

function actionLevel(severity) {
  if (severity === "critical") return "propose";
  if (severity === "high") return "propose";
  if (severity === "medium") return "prepare";
  return "observe";
}

function githubRepository(payload) {
  return clean(payload?.repository?.full_name || payload?.repository?.fullName, 160).toLowerCase();
}

function renderServiceId(payload) {
  return clean(payload?.data?.serviceId || payload?.serviceId, 120);
}

function findWorkspaceForSignal(ownerId, source, identity) {
  const workspaces = atlas.listWorkspaces(ownerId, { state: "active" });
  return workspaces.find((workspace) => {
    if (!workspace.sentinel?.enabled) return false;
    if (source === "github") return String(workspace.sentinel.sources?.github?.repository || "").toLowerCase() === String(identity || "").toLowerCase();
    if (source === "render") return String(workspace.sentinel.sources?.render?.serviceId || "") === String(identity || "");
    return true;
  }) || null;
}

function githubSignal(payload, eventName, deliveryId) {
  const action = clean(payload?.action || "event", 60).toLowerCase();
  const repo = githubRepository(payload);
  const checkConclusion = clean(payload?.check_run?.conclusion || payload?.check_suite?.conclusion, 40).toLowerCase();
  const deploymentState = clean(payload?.deployment_status?.state, 40).toLowerCase();
  let severity = "low";
  let title = `${eventName} ${action}`;
  let summary = `GitHub reported ${eventName}/${action} for ${repo || "the configured repository"}.`;

  if ((eventName === "check_run" || eventName === "check_suite") && ["failure", "timed_out", "cancelled", "action_required"].includes(checkConclusion)) {
    severity = "high";
    title = `GitHub checks failed: ${repo || "configured repository"}`;
    summary = `The ${eventName} concluded with ${checkConclusion}. Inspect the failed checks before treating the change as verified.`;
  } else if (eventName === "deployment_status" && ["failure", "error"].includes(deploymentState)) {
    severity = "critical";
    title = `GitHub deployment failed: ${repo || "configured repository"}`;
    summary = `Deployment status is ${deploymentState}. Release health needs owner review.`;
  } else if (eventName === "pull_request" && ["opened", "synchronize", "reopened"].includes(action)) {
    severity = "medium";
    title = `Pull request needs review: ${repo || "configured repository"}`;
    summary = `A pull request was ${action}. Review the change and its checks before merging.`;
  } else if (eventName === "pull_request" && action === "closed" && payload?.pull_request?.merged) {
    severity = "info";
    title = `Pull request merged: ${repo || "configured repository"}`;
    summary = "A pull request was merged. Atlas can record the change as release evidence.";
  } else if (eventName === "deployment_status" && ["success", "succeeded"].includes(deploymentState)) {
    severity = "info";
    title = `Deployment succeeded: ${repo || "configured repository"}`;
    summary = "GitHub reported a successful deployment status.";
  }

  return {
    source: "github",
    kind: eventName,
    action,
    sourceId: deliveryId,
    dedupeKey: `github:${deliveryId}`,
    title,
    summary,
    severity,
    at: Date.now(),
    repository: repo,
  };
}

function renderSignal(payload) {
  const type = clean(payload?.type || "render_event", 80).toLowerCase();
  const status = clean(payload?.data?.status, 40).toLowerCase();
  const service = clean(payload?.data?.serviceName || "configured Render service", 160);
  const eventId = clean(payload?.data?.id || payload?.id, 160);
  let severity = "low";
  let title = `Render ${type}: ${service}`;
  let summary = `Render reported ${type} for ${service}.`;

  if (type === "deploy_ended" && ["failed", "canceled", "cancelled"].includes(status)) {
    severity = "critical";
    title = `Render deployment failed: ${service}`;
    summary = `The Render deployment ended with status ${status}. Release health needs owner review.`;
  } else if (type === "deploy_ended" && ["succeeded", "success"].includes(status)) {
    severity = "info";
    title = `Render deployment succeeded: ${service}`;
    summary = "The Render deployment completed successfully.";
  } else if (type === "build_ended" && ["failed", "canceled", "cancelled"].includes(status)) {
    severity = "high";
    title = `Render build failed: ${service}`;
    summary = `The Render build ended with status ${status}. Inspect build output before retrying.`;
  }

  return {
    source: "render",
    kind: type,
    action: status,
    sourceId: eventId,
    dedupeKey: `render:${eventId || `${type}:${payload?.timestamp || Date.now()}`}`,
    title,
    summary,
    severity,
    at: Date.parse(payload?.timestamp) || Date.now(),
    serviceId: renderServiceId(payload),
  };
}

function localMissionSignal(mission) {
  const updated = mission.updatedAt || mission.createdAt || Date.now();
  return {
    source: "local",
    kind: "mission_stalled",
    action: "review",
    sourceId: mission.id,
    dedupeKey: `local:mission-stalled:${mission.id}:${Math.floor(updated / (6 * 60 * 60 * 1000))}`,
    title: `Mission stalled: ${clean(mission.objective || mission.id, 180)}`,
    summary: `Mission ${mission.id} has been running for more than 30 minutes without a durable update. Review whether to retry, revise, or cancel it.`,
    severity: "high",
    at: Date.now(),
  };
}

function addDerivedState(ownerId, workspace, result) {
  const signal = result.signal;
  const evidence = atlas.addEvidence(ownerId, workspace.id, {
    kind: "sentinel_signal",
    title: signal.title,
    summary: signal.summary,
    source: `sentinel:${signal.source}`,
  });
  let risk = null;
  if (severityRank(signal.severity) >= severityRank("high")) {
    risk = atlas.addRisk(ownerId, workspace.id, {
      title: signal.title,
      likelihood: signal.severity === "critical" ? 4 : 3,
      impact: signal.severity === "critical" ? 5 : 4,
      mitigation: signal.summary,
    });
  }
  let brief = null;
  if (severityRank(signal.severity) >= severityRank("medium")) {
    brief = atlas.addBrief(ownerId, workspace.id, {
      sourceSignalId: signal.id,
      title: signal.title,
      impact: signal.summary,
      recommendation: signal.severity === "critical" ? "Pause release-side changes and review the failure before taking action." : "Inspect the evidence, confirm the impact, and decide whether the related task should be retried or revised.",
      actionLevel: actionLevel(signal.severity),
    });
  }
  const linked = atlas.updateSignal(ownerId, workspace.id, signal.id, {
    evidenceId: evidence?.id,
    riskId: risk?.id,
    briefId: brief?.id,
  });
  return { signal: linked || signal, evidence, risk, brief };
}

async function maybeNotify(ownerId, workspace, derived, options = {}) {
  const signal = derived.signal;
  if (!options.notify || severityRank(signal.severity) < severityRank("high")) return false;
  const now = Date.now();
  if (workspace.sentinel?.lastNotifiedAt && now - workspace.sentinel.lastNotifiedAt < NOTIFY_COOLDOWN_MS) return false;
  const sock = getSock();
  const target = ownerJid(ownerId);
  if (!sock || !target) return false;
  const brief = derived.brief;
  const text = `🛰️ *Atlas Sentinel alert*\n\n*${signal.title}*\n${signal.summary}\n\nSeverity: ${signal.severity}${brief ? `\nDecision brief: ${brief.id}\nRecommendation: ${brief.recommendation}` : ""}\n\nReply “show Sentinel” to inspect it. Consequential actions still require your explicit approval.`;
  try {
    await sock.sendMessage(target, { text });
    atlas.updateSignal(ownerId, workspace.id, signal.id, { notifiedAt: now });
    atlas.configureSentinel(ownerId, workspace.id, { lastNotifiedAt: now });
    return true;
  } catch (_) {
    return false;
  }
}

function ingestNormalized(ownerId, source, identity, normalized, options = {}) {
  const workspace = findWorkspaceForSignal(ownerId, source, identity);
  if (!workspace) return { status: "ignored", reason: "no enabled Sentinel workspace matches this source" };
  const recorded = atlas.recordSignal(ownerId, workspace.id, normalized);
  if (!recorded) return { status: "missing_workspace" };
  if (recorded.duplicate) return { status: "duplicate", workspaceId: workspace.id, signal: recorded.signal };
  const derived = addDerivedState(ownerId, workspace, recorded);
  const current = atlas.getWorkspace(ownerId, workspace.id) || workspace;
  maybeNotify(ownerId, current, derived, options).catch(() => {});
  return { status: "accepted", workspaceId: workspace.id, ...derived };
}

function ingestGithub(ownerId, payload, eventName, deliveryId, options = {}) {
  const signal = githubSignal(payload, eventName, deliveryId);
  return ingestNormalized(ownerId, "github", signal.repository, signal, options);
}

function ingestRender(ownerId, payload, options = {}) {
  const signal = renderSignal(payload);
  return ingestNormalized(ownerId, "render", signal.serviceId, signal, options);
}

function ingestLocal(ownerId, workspaceId, signal, options = {}) {
  const workspace = atlas.getWorkspace(ownerId, workspaceId);
  if (!workspace || !workspace.sentinel?.enabled) return { status: "ignored", reason: "Sentinel is disabled for this workspace" };
  const recorded = atlas.recordSignal(ownerId, workspace.id, signal);
  if (!recorded) return { status: "missing_workspace" };
  if (recorded.duplicate) return { status: "duplicate", workspaceId: workspace.id, signal: recorded.signal };
  const derived = addDerivedState(ownerId, workspace, recorded);
  maybeNotify(ownerId, workspace, derived, options).catch(() => {});
  return { status: "accepted", workspaceId: workspace.id, ...derived };
}

function signalList(workspace) {
  return (workspace?.signals || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
}

function integrationDiagnostic(workspace, source) {
  const health = workspace?.sentinel?.health?.[source] || {};
  const mapping = source === "github" ? workspace?.sentinel?.sources?.github?.repository : workspace?.sentinel?.sources?.render?.serviceId;
  const status = health.status || (mapping ? "attention" : "unconfigured");
  const next = status === "healthy" ? "No action needed; verified deliveries are arriving." : status === "misconfigured" ? `Check the provider secret and redeploy the running service. Reason: ${health.reasonCode || "configuration mismatch"}.` : status === "unconfigured" ? `Map a ${source} source in the Atlas dashboard if you want external events.` : status === "disabled" ? "Enable Sentinel from the dashboard before expecting monitoring." : "Send a provider test delivery, then inspect the delivery response and runtime logs.";
  return { source, status, reasonCode: health.reasonCode || "unknown", message: health.message || "No diagnostic available.", mapping: mapping || null, lastAttemptAt: health.lastAttemptAt || 0, lastSuccessAt: health.lastSuccessAt || 0, lastFailureAt: health.lastFailureAt || 0, lastHttpStatus: health.lastHttpStatus || null, attempts: health.attempts || 0, successes: health.successes || 0, failures: health.failures || 0, next };
}

function sentinelDiagnostics(ownerId, query = "") {
  const workspace = atlas.findWorkspace(ownerId, query);
  if (!workspace) return null;
  const sources = [integrationDiagnostic(workspace, "github"), integrationDiagnostic(workspace, "render")];
  const deliveries = (workspace.sentinel?.deliveries || []).slice().sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0)).slice(0, 8);
  return { workspaceId: workspace.id, title: workspace.title, enabled: Boolean(workspace.sentinel?.enabled), sources, deliveries };
}

function formatDiagnostics(ownerId, query = "") {
  const diagnostics = sentinelDiagnostics(ownerId, query);
  if (!diagnostics) return "I don’t have an Atlas workspace yet. Create one, then enable Sentinel from the dashboard.";
  let text = `🧭 *Atlas integration diagnostics — ${diagnostics.title}*\n\nSentinel: ${diagnostics.enabled ? "enabled" : "disabled"}`;
  text += "\n\n" + diagnostics.sources.map((source) => `*${source.source}*: ${source.status}\n${source.message}\nNext: ${source.next}`).join("\n\n");
  if (diagnostics.deliveries.length) text += `\n\n*Latest deliveries*\n${diagnostics.deliveries.slice(0, 5).map((delivery) => `• ${delivery.source}/${delivery.eventName} · ${delivery.status} · ${delivery.reasonCode}${delivery.httpStatus ? ` · HTTP ${delivery.httpStatus}` : ""}`).join("\n")}`;
  else text += "\n\nNo provider delivery attempts have been recorded yet.";
  return text;
}

function formatSentinel(ownerId, query = "") {
  const workspace = atlas.findWorkspace(ownerId, query);
  if (!workspace) return "I don’t have an Atlas workspace with Sentinel enabled yet. Create a project, then enable Sentinel from the dashboard.";
  const signals = signalList(workspace).slice(0, 6);
  const briefs = (workspace.briefs || []).filter((brief) => !["resolved", "rejected"].includes(brief.status)).slice(-5).reverse();
  const enabled = Boolean(workspace.sentinel?.enabled);
  const githubRepository = workspace.sentinel?.sources?.github?.repository;
  const renderService = workspace.sentinel?.sources?.render?.serviceId;
  let text = `🛰️ *Atlas Sentinel — ${workspace.title}*\n\nStatus: ${enabled ? "enabled and watching" : "disabled"}`;
  if (enabled) {
    text += "\n\nSentinel is a monitor, not a second chatbot. A quiet screen is normal: it means no tracked problem has fired yet.";
    text += "\n\n*Watching now*\n• stalled Atlas missions\n• repeated runtime errors\n• all-provider AI outages";
    text += `\n\n*External sources*\n• GitHub: ${githubRepository ? `connected to ${githubRepository}` : "not connected"}\n• Render: ${renderService ? "connected" : "not connected"}`;
    if (!githubRepository && !renderService) text += "\n\nYou do not need webhooks for local monitoring. Add GitHub or Render only if you want deployment/check alerts.";
  } else {
    text += "\n\nEnable it from the Atlas dashboard to start local monitoring. Enabling Sentinel does not create a plan or take actions by itself.";
  }
  text += signals.length ? `\n\n*Recent signals*\n${signals.map((signal) => `• ${signal.id} · ${signal.severity} · ${signal.status}\n  ${signal.title}`).join("\n")}` : "\n\n*Recent signals*\n• None. No tracked issue has been recorded.";
  text += briefs.length ? `\n\n*Decision briefs*\n${briefs.map((brief) => `• ${brief.id} · ${brief.actionLevel} · ${brief.status}\n  ${brief.title}\n  ${brief.recommendation}`).join("\n")}` : "\n\n*Decision briefs*\n• None waiting for your approval.";
  text += "\n\nWhen a real signal appears, say “acknowledge signal <id>”, “resolve signal <id>”, or “approve brief <id>”.";
  return text;
}

function targetId(text, kind) {
  const re = kind === "brief" ? /\b(?:brief\s+)?(brief_[a-z0-9_-]+)\b/i : /\b(?:signal\s+)?(signal_[a-z0-9_-]+)\b/i;
  return String(text || "").match(re)?.[1] || null;
}

function handleSentinel(ownerId, text) {
  const input = clean(text, 500);
  const workspace = atlas.findWorkspace(ownerId);
  if (!workspace) return { kind: "text", text: formatSentinel(ownerId) };
  const lower = input.toLowerCase();
  if (/\b(?:diagnose|inspect|check)\b.*\b(?:sentinel|integration|webhook|connection|delivery)\b/i.test(lower) || /\b(?:sentinel|integration|webhook|connection)\b.*\b(?:health|status|diagnostic|working)\b/i.test(lower)) {
    return { kind: "text", text: formatDiagnostics(ownerId) };
  }
  if (/\b(?:enable|turn on)\s+sentinel\b/i.test(lower)) {
    const configured = atlas.configureSentinel(ownerId, workspace.id, { enabled: true });
    return { kind: "text", text: configured ? `Sentinel is now enabled for *${workspace.title}*. Configure a GitHub repository or Render service in the dashboard to receive signed external events.` : "I couldn't enable Sentinel for this workspace." };
  }
  if (/\b(?:disable|turn off)\s+sentinel\b/i.test(lower)) {
    const configured = atlas.configureSentinel(ownerId, workspace.id, { enabled: false });
    return { kind: "text", text: configured ? `Sentinel is now disabled for *${workspace.title}*. Existing signal history remains available.` : "I couldn't disable Sentinel for this workspace." };
  }
  if (/\b(?:acknowledge|ack)\s+(?:signal\s+)?signal_/i.test(lower)) {
    const id = targetId(input, "signal");
    const updated = id && atlas.updateSignal(ownerId, workspace.id, id, { status: "acknowledged" });
    return { kind: "text", text: updated ? `Acknowledged Sentinel signal *${id}*. I’ll keep its evidence attached without treating it as resolved.` : `I couldn’t find Sentinel signal *${id || ""}* in ${workspace.title}.` };
  }
  if (/\bresolve\s+(?:signal\s+)?signal_/i.test(lower)) {
    const id = targetId(input, "signal");
    const signal = id && atlas.updateSignal(ownerId, workspace.id, id, { status: "resolved" });
    if (signal?.riskId) atlas.updateRisk(ownerId, workspace.id, signal.riskId, { status: "closed" });
    if (signal?.briefId) atlas.updateBrief(ownerId, workspace.id, signal.briefId, { status: "resolved" });
    return { kind: "text", text: signal ? `Resolved Sentinel signal *${id}* and closed its linked risk/brief where available.` : `I couldn’t find Sentinel signal *${id || ""}* in ${workspace.title}.` };
  }
  if (/\bapprove\s+(?:brief\s+)?brief_/i.test(lower)) {
    const id = targetId(input, "brief");
    const brief = id && atlas.updateBrief(ownerId, workspace.id, id, { status: "approved" });
    return { kind: "text", text: brief ? `Approved decision brief *${id}*. I recorded approval; no commit, deploy, post, or other side effect was started automatically.` : `I couldn’t find decision brief *${id || ""}* in ${workspace.title}.` };
  }
  return { kind: "text", text: formatSentinel(ownerId) };
}

async function runSentinelPass(ownerId, options = {}) {
  const durable = require("./durableMissions");
  const workspaces = atlas.listWorkspaces(ownerId, { state: "active" }).filter((workspace) => workspace.sentinel?.enabled);
  const results = [];
  for (const workspace of workspaces) {
    atlas.markSentinelPass(ownerId, workspace.id, Date.now());
    const missions = durable.getAllMissions ? durable.getAllMissions() : [];
    for (const mission of missions) {
      const metadata = mission.metadata || {};
      if (metadata.atlasWorkspaceId !== workspace.id || metadata.atlasOwnerId !== ownerId) continue;
      if (mission.status !== "running") continue;
      if (Date.now() - (mission.updatedAt || mission.createdAt || 0) <= STALL_MS) continue;
      results.push(ingestLocal(ownerId, workspace.id, localMissionSignal(mission), { notify: options.notify !== false }));
    }
  }
  return { workspaces: workspaces.length, signals: results };
}

module.exports = {
  githubSignal,
  renderSignal,
  findWorkspaceForSignal,
  ingestGithub,
  ingestRender,
  ingestLocal,
  runSentinelPass,
  formatSentinel,
  sentinelDiagnostics,
  formatDiagnostics,
  handleSentinel,
  severityRank,
};
