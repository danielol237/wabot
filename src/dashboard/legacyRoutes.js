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
    return res.json({ workspaces, brief });
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

module.exports = router;
