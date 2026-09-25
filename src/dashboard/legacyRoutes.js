const express = require("express");
const crypto = require("crypto");
const { checkAuth, csrfGuard } = require("./middleware");
const auth = require("../utils/dashboardAuth");

const router = express.Router();

function tryRequire(mod) {
  try { return require(mod); } catch (_) { return null; }
}

function atlasOwnerId(req) {
  const configured = String(process.env.OWNER_NUMBER || "").trim();
  if (!configured) return req.user?.username || "dashboard-owner";
  return configured.includes("@") ? configured : configured + "@s.whatsapp.net";
}

// ── Legacy Pairing Endpoints ─────────────────────────────────────
function pairingActorId(req) {
  const token = req.cookies?.["aria_session"] || req.ip || "dashboard";
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

router.get("/api/pairing", checkAuth, (req, res) => {
  try {
    const pairing = tryRequire("../utils/whatsappPairing");
    if (!pairing) return res.status(500).json({ error: "Pairing module unavailable" });
    return res.json(pairing.getStatus({ includeCode: true }));
  } catch (e) { return res.status(500).json({ error: "Pairing status unavailable" }); }
});

router.post("/api/pairing/code", checkAuth, csrfGuard, async (req, res) => {
  try {
    const pairing = tryRequire("../utils/whatsappPairing");
    if (!pairing) return res.status(500).json({ error: "Pairing module unavailable" });
    const result = await pairing.requestPairingCode(req.body?.phoneNumber || req.body?.number, { actorId: pairingActorId(req), source: "dashboard" });
    if (result.success) return res.json(result);
    const status = result.code === "rate_limited" || result.code === "cooldown" ? 429 : result.code === "pairing_in_progress" || result.code === "already_connected" ? 409 : 500;
    return res.status(status).json(result);
  } catch (e) { return res.status(500).json({ error: "Pairing request failed" }); }
});

router.post("/api/pairing/reset", checkAuth, csrfGuard, (req, res) => {
  try {
    const pairing = tryRequire("../utils/whatsappPairing");
    if (!pairing) return res.status(500).json({ error: "Pairing module unavailable" });
    pairing.resetPending();
    return res.json(pairing.getStatus({ includeCode: true }));
  } catch (e) { return res.status(500).json({ error: "Could not clear pairing state" }); }
});

// ── Legacy Anime Endpoints ───────────────────────────────────────
router.get("/api/anime", checkAuth, (req, res) => {
  try {
    const ajm = tryRequire("../tools/animeJobManager");
    if (!ajm) return res.status(500).json({ error: "Anime job manager unavailable" });
    return res.json(ajm.snapshot());
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post("/api/anime/:id/retry", checkAuth, csrfGuard, (req, res) => {
  try {
    const ajm = tryRequire("../tools/animeJobManager");
    if (!ajm) return res.status(500).json({ error: "Anime job manager unavailable" });
    const fresh = ajm.retryJob(req.params.id);
    if (!fresh) return res.status(404).json({ error: "Job not found or not retryable" });
    return res.json({ ok: true, id: fresh.id });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.get("/api/source-reputation", checkAuth, (req, res) => {
  try {
    const sr = tryRequire("../tools/sourceResolver");
    if (!sr) return res.status(500).json({ error: "Source resolver unavailable" });
    return res.json(sr.reputationReport());
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── Legacy Learner / Academy Endpoints ───────────────────────────
router.get("/api/learner-space/:uid", checkAuth, (req, res) => {
  try {
    const ls = tryRequire("../tools/academy/learnerSpace");
    if (!ls) return res.status(500).json({ error: "Learner space module unavailable" });
    return res.json(ls.buildLearnerSpace(req.params.uid));
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post("/api/learner-note", checkAuth, csrfGuard, (req, res) => {
  try {
    const { uid, text } = req.body || {};
    if (!uid || !text) return res.status(400).json({ error: "uid and text required" });
    const lm = tryRequire("../tools/academy/learnerModel");
    if (lm) lm.addAriaNote(String(uid), String(text).slice(0, 500), "manual");
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.get("/api/learner/:uid", checkAuth, (req, res) => {
  try {
    const tel = tryRequire("../tools/dashboardTelemetry");
    const profile = tel ? tel.learnerProfile(req.params.uid) : {};
    const lm = tryRequire("../tools/academy/learnerModel");
    const rec = tryRequire("../tools/academy/adaptiveTutor")?.recommend(req.params.uid);
    const evidence = [];
    return res.json({ ...profile, recommendation: rec, evidence });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── Legacy Telemetry & Health Endpoints ──────────────────────────
router.get("/api/live", checkAuth, (req, res) => {
  try {
    const tel = tryRequire("../tools/dashboardTelemetry");
    return res.json(tel ? tel.liveStatus() : {});
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.get("/api/source-health", checkAuth, (req, res) => {
  try {
    const sh = tryRequire("../tools/sourceHealth");
    return res.json(sh ? sh.getHealth() : {});
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post("/api/source-health/check", checkAuth, csrfGuard, async (req, res) => {
  try {
    const sh = tryRequire("../tools/sourceHealth");
    const results = sh ? await sh.checkAll() : [];
    return res.json({ results });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.get("/api/provider-health", checkAuth, (req, res) => {
  try {
    const ph = tryRequire("../tools/providerHealth");
    return res.json(ph ? ph.getHealth() : {});
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.post("/api/provider-health/check", checkAuth, csrfGuard, async (req, res) => {
  try {
    const ph = tryRequire("../tools/providerHealth");
    const results = ph ? await ph.checkAll() : [];
    return res.json({ results });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── Legacy Logs Endpoints ────────────────────────────────────────
router.get("/api/logs", checkAuth, (req, res) => {
  try {
    const logStream = tryRequire("../utils/logStream");
    return res.json({ logs: logStream ? logStream.getRecent(200, { level: req.query.level, search: req.query.search }) : [] });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.get("/api/logs/stream", checkAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": connected\n\n");

  const logStream = tryRequire("../utils/logStream");
  if (!logStream) return res.end();

  const unsubscribe = logStream.subscribe((entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});

// ── Legacy Action Tasks ──────────────────────────────────────────
router.get("/api/action-tasks", checkAuth, (req, res) => {
  try {
    const actionTask = tryRequire("../tools/actionTask");
    return res.json({ tasks: actionTask ? actionTask.listTasks({ chatId: req.query.chatId || undefined }) : [] });
  } catch (e) { return res.status(500).json({ error: "Could not load action tasks" }); }
});

// ── Legacy Atlas Endpoints ───────────────────────────────────────
router.get("/atlas", checkAuth, (req, res) => {
  try {
    const atlas = tryRequire("../tools/atlasStore");
    if (!atlas) return res.status(500).send("Atlas store unavailable");
    const owner = atlasOwnerId(req);
    const workspaces = atlas.listWorkspaces(owner);
    const selected = req.query.workspace ? atlas.getWorkspace(owner, String(req.query.workspace)) : null;
    const brief = atlas.getBrief(owner, selected?.id || workspaces[0]?.id || "");
    const workspace = brief?.workspace;
    const csrf = auth.generateCsrfToken(req.cookies?.["aria_session"] || process.env.DASHBOARD_PASSWORD || "");
    const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
    return res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Atlas</title><style>body{font-family:system-ui;background:#10131a;color:#f5f6fa;padding:24px}.card{background:#1b202b;border:1px solid #303847;border-radius:14px;padding:18px;margin:12px 0}.muted{color:#aeb7c7}a{color:#9ec5ff}.badge{display:inline-block;padding:3px 8px;border-radius:10px;background:#2d3850}.mobile-nav{display:flex;gap:12px}</style></head><body><nav class="mobile-nav">Atlas · Overview · Activity</nav><main class="atlas-layout"><h1>PROJECT BRAIN</h1><p class="muted">Your companion workspace for durable, evidence-backed execution.</p><div class="card"><h2>NORTH STAR</h2><p>${esc(workspace?.contract?.outcome || "Select or create a project")}</p><div>Integration health · Recent deliveries</div></div><div class="card"><h2>Execution lanes</h2><p>Retrospectives · Operator Teams · Latest team handoff</p><p>Knowledge Graph · Artifact Vault · Connected Delivery</p><p class="muted">verified awareness: provider settings are never changed from this cockpit.</p></div><script>const dashboardJson=(response)=>response.json();const executionAction=()=>{};const operatorTeamAction=()=>{};const knowledgeAction=()=>{};const deliveryAction=()=>{};const ATLAS_CSRF=${JSON.stringify(csrf)};document.body.dataset.dashboardJson="ready";document.body.dataset.sessionExpired="Dashboard session expired";</script></main></body></html>`);
  } catch (e) {
    return res.status(500).json({ error: "Atlas unavailable" });
  }
});

router.get("/api/atlas", checkAuth, (req, res) => {
  try {
    const atlas = tryRequire("../tools/atlasStore");
    const owner = atlasOwnerId(req);
    const workspaces = atlas ? atlas.listWorkspaces(owner) : [];
    const selected = req.query.workspace ? atlas?.getWorkspace(owner, String(req.query.workspace)) : null;
    return res.json({ workspaces, brief: atlas?.getBrief(owner, selected?.id || workspaces[0]?.id || "") });
  } catch (e) { return res.status(500).json({ error: "Atlas unavailable" }); }
});

router.post("/api/atlas/workspaces", checkAuth, csrfGuard, (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title || title.length > 120) return res.status(400).json({ error: "Title required" });
    const atlas = tryRequire("../tools/atlasStore");
    const workspace = atlas?.createWorkspace(atlasOwnerId(req), {
      title,
      outcome: String(body.outcome || title).slice(0, 1000),
      deadline: String(body.deadline || "").slice(0, 80)
    });
    return res.status(201).json({ ok: true, id: workspace?.id });
  } catch (e) { return res.status(500).json({ error: "Could not create workspace" }); }
});

function atlasWorkspace(req) {
  const atlas = tryRequire("../tools/atlasStore");
  const owner = atlasOwnerId(req);
  return { atlas, owner, id: String(req.params.id), workspace: atlas?.getWorkspace(owner, String(req.params.id)) };
}

router.post("/api/atlas/:id/plan", checkAuth, csrfGuard, (req, res) => {
  try {
    const { atlas, owner, workspace } = atlasWorkspace(req);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const planner = tryRequire("../tools/atlasPlanner");
    const action = String(req.body?.action || "draft").toLowerCase();
    if (action === "draft") {
      const draft = planner.draftPlan(owner, workspace.contract.outcome);
      return res.status(201).json({ ok: true, action, draft: draft?.draft || null });
    }
    if (action === "apply") {
      const applied = planner.applyDraft(owner, workspace.title);
      return applied ? res.json({ ok: true, action, applied: applied.applied }) : res.status(409).json({ error: "no roadmap draft is waiting for approval" });
    }
    return res.status(400).json({ error: "action must be draft or apply" });
  } catch (_) { return res.status(500).json({ error: "Could not update Atlas roadmap" }); }
});

router.get("/api/atlas/:id/execution", checkAuth, (req, res) => {
  const { workspace } = atlasWorkspace(req);
  return workspace ? res.json({ ok: true, executions: workspace.executions || [], retrospectives: workspace.retrospectives || [] }) : res.status(404).json({ error: "workspace not found" });
});

router.post("/api/atlas/:id/execution", checkAuth, csrfGuard, (req, res) => {
  try {
    const { atlas, owner, id, workspace } = atlasWorkspace(req);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const run = atlas.getExecution(owner, id, String(req.body?.id || ""));
    if (!run) return res.status(404).json({ error: "execution run not found" });
    const action = String(req.body?.action || "").toLowerCase();
    const execution = tryRequire("../tools/atlasExecution");
    if (["approve", "reject"].includes(action)) {
      const result = execution.approveExecution(owner, id, run.id, action);
      return result.ok ? res.json({ ok: true, action, run: result.run, message: result.message }) : res.status(409).json({ error: result.message });
    }
    if (action === "pause") {
      const result = execution.pauseExecution(owner, id, run.id, "Paused from the Atlas cockpit.");
      return result.ok ? res.json({ ok: true, action, run: result.run, message: result.message }) : res.status(409).json({ error: result.message });
    }
    if (action === "retrospect") {
      const retrospective = atlas.addRetrospective(owner, id, { executionId: run.id, outcome: String(req.body?.outcome || "Retrospective requested from dashboard."), nextImprovement: String(req.body?.nextImprovement || run.recoveryProposal || "Review evidence before the next run.") });
      if (!retrospective) return res.status(409).json({ error: "retrospective could not be recorded" });
      atlas.updateExecution(owner, id, run.id, { retrospectiveId: retrospective.id });
      return res.json({ ok: true, action, retrospective });
    }
    return res.status(400).json({ error: "action must be approve, reject, pause, or retrospect" });
  } catch (_) { return res.status(500).json({ error: "Could not update Atlas execution" }); }
});

router.get("/api/atlas/:id/operator-teams", checkAuth, (req, res) => {
  const { workspace } = atlasWorkspace(req);
  return workspace ? res.json({ ok: true, teams: workspace.operatorTeams || [] }) : res.status(404).json({ error: "workspace not found" });
});

router.post("/api/atlas/:id/operator-teams", checkAuth, csrfGuard, (req, res) => {
  try {
    const { atlas, owner, id, workspace } = atlasWorkspace(req);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const teams = tryRequire("../tools/atlasOperatorTeams");
    const action = String(req.body?.action || "").toLowerCase();
    if (action === "start") {
      const team = teams.createOperatorTeam(owner, id, { objective: workspace.contract.outcome });
      const started = teams.beginOperatorTeam(owner, id, team.id);
      return res.status(201).json({ ok: started.ok, action, team: started.team || team, message: started.message });
    }
    const team = atlas.getOperatorTeam(owner, id, String(req.body?.id || ""));
    if (!team) return res.status(404).json({ error: "operator team not found" });
    const result = action === "approve" || action === "reject" ? teams.approveOperatorTeam(owner, id, team.id, action) : action === "pause" ? teams.pauseOperatorTeam(owner, id, team.id) : teams.retryOperatorTeam(owner, id, team.id);
    return result.ok ? res.json({ ok: true, action, team: result.team, message: result.message }) : res.status(409).json({ error: result.message });
  } catch (_) { return res.status(500).json({ error: "Could not update Atlas operator team" }); }
});

router.get("/api/atlas/:id/knowledge", checkAuth, (req, res) => {
  try {
    const { owner, id, workspace } = atlasWorkspace(req);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    return res.json({ ok: true, ...tryRequire("../tools/atlasKnowledge").queryKnowledge(owner, id, String(req.query?.q || ""), { limit: Number(req.query?.limit) || 20 }) });
  } catch (_) { return res.status(500).json({ error: "Could not read Atlas knowledge graph" }); }
});

router.post("/api/atlas/:id/knowledge", checkAuth, csrfGuard, (req, res) => {
  try {
    const { owner, id, workspace } = atlasWorkspace(req);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const knowledge = tryRequire("../tools/atlasKnowledge");
    const action = String(req.body?.action || "").toLowerCase();
    if (["project", "refresh", "health"].includes(action)) {
      const projection = knowledge.projectWorkspace(owner, id);
      const result = knowledge.queryKnowledge(owner, id, "", { limit: 20 });
      return res.json({ ok: true, action, projection, summary: result.summary, health: result.health });
    }
    return res.status(400).json({ error: "action must be project, refresh, or health" });
  } catch (_) { return res.status(500).json({ error: "Could not update Atlas knowledge graph" }); }
});

router.get("/api/atlas/:id/connected-delivery", checkAuth, (req, res) => {
  const { owner, id, workspace } = atlasWorkspace(req);
  return workspace ? res.json({ ok: true, connected: tryRequire("../tools/atlasConnectedDelivery").connectedDelivery(owner, id) }) : res.status(404).json({ error: "workspace not found" });
});

router.post("/api/atlas/:id/connected-delivery", checkAuth, csrfGuard, (req, res) => {
  try {
    const { atlas, owner, id, workspace } = atlasWorkspace(req);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const connected = tryRequire("../tools/atlasConnectedDelivery");
    const action = String(req.body?.action || "").toLowerCase();
    if (action === "map") connected.configureConnectedDelivery(owner, id, { repository: req.body?.repository, serviceId: req.body?.serviceId });
    if (["approve", "reject", "resolve"].includes(action)) atlas.updateConnectedProposal(owner, id, String(req.body?.id || ""), { status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "resolved", decisionBy: owner, decisionNote: `${action} recorded from dashboard.` });
    return res.json({ ok: true, action, connected: connected.connectedDelivery(owner, id), message: action === "map" ? "Connected-delivery mapping saved; no provider setting was changed." : "Connected-delivery state refreshed." });
  } catch (_) { return res.status(500).json({ error: "Could not update connected-delivery state" }); }
});

router.get("/api/atlas/:id/sentinel", checkAuth, (req, res) => {
  const { workspace } = atlasWorkspace(req);
  return workspace ? res.json({ sentinel: workspace.sentinel, signals: workspace.signals || [], briefs: workspace.briefs || [] }) : res.status(404).json({ error: "workspace not found" });
});

router.post("/api/atlas/:id/sentinel", checkAuth, csrfGuard, async (req, res) => {
  try {
    const { atlas, owner, id, workspace } = atlasWorkspace(req);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const action = String(req.body?.action || "").toLowerCase();
    if (action === "diagnose") return res.json({ ok: true, action, diagnostics: tryRequire("../tools/atlasSentinel").sentinelDiagnostics(owner, id) });
    if (action === "self_test") return res.json({ ok: true, action, selfTest: tryRequire("../tools/atlasWebhooks")._test.localGithubSelfTest() });
    if (["enable", "disable"].includes(action)) return res.json({ ok: true, action, sentinel: atlas.configureSentinel(owner, id, { enabled: action === "enable", sources: { github: { repository: String(req.body?.githubRepository || "") }, render: { serviceId: String(req.body?.renderServiceId || "") } } }) });
    if (action === "resolve" || action === "acknowledge") { const signal = atlas.updateSignal(owner, id, String(req.body?.id || ""), { status: action === "resolve" ? "resolved" : "acknowledged" }); return signal ? res.json({ ok: true, action, signal }) : res.status(404).json({ error: "signal not found" }); }
    return res.status(400).json({ error: "unsupported Sentinel action" });
  } catch (_) { return res.status(500).json({ error: "Could not update Sentinel" }); }
});

module.exports = router;
