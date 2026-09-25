const express = require("express");
const path = require("path");
const fs = require("fs");
const { checkAuth, requirePermission, csrfGuard } = require("./middleware");
const connectorRegistry = require("../tools/connectorRegistry");
const ariaEventBus = require("../utils/eventBus");

const router = express.Router();

function tryRequire(modulePath) {
  try { return require(modulePath); } catch (_) { return null; }
}

// 1. GET /api/dashboard/overview
router.get("/dashboard/overview", checkAuth, requirePermission("dashboard.read"), async (req, res) => {
  const index = tryRequire("../index");
  const sock = index && index.getSock ? index.getSock() : null;
  const isWhatsappConnected = !!(sock && sock.user);

  const botAdmin = tryRequire("../tools/botAdmin");
  const stats = botAdmin ? botAdmin.getStats() : null;

  const durable = tryRequire("../tools/durableMissions");
  const allMissions = durable && durable.getAllMissions ? durable.getAllMissions() : [];
  const activeMissions = allMissions.filter((m) => m.status === "running" || m.status === "pending").length;
  const completedMissions = allMissions.filter((m) => m.status === "completed").length;
  const failedMissions = allMissions.filter((m) => m.status === "failed").length;

  const registry = await connectorRegistry.getConnectorRegistrySummary();

  const companionEvents = tryRequire("../companionEvents");
  const companionDevices = companionEvents && companionEvents.getConnectedDevices ? companionEvents.getConnectedDevices() : [];

  const attentionCount = (registry.summary.degraded || 0) + (registry.summary.offline || 0) + failedMissions;

  return res.json({
    aria: {
      status: isWhatsappConnected ? "online" : "offline",
      state: activeMissions > 0 ? "executing" : "idle",
      currentTask: activeMissions > 0 ? (allMissions.find(m => m.status === "running")?.objective || "Processing tasks") : null,
      since: new Date(Date.now() - process.uptime() * 1000).toISOString()
    },
    system: {
      uptimeSeconds: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      cpuPercent: 4,
      environment: process.env.NODE_ENV || "development"
    },
    whatsapp: {
      status: isWhatsappConnected ? "connected" : "disconnected",
      lastActivity: new Date().toISOString()
    },
    missions: {
      active: activeMissions,
      pending: allMissions.filter(m => m.status === "pending").length,
      completed: completedMissions,
      failed: failedMissions
    },
    connectors: registry.summary,
    companion: {
      devices: companionDevices.length,
      connected: companionDevices.filter(d => d.status === "connected").length
    },
    attention: attentionCount
  });
});

// 2. GET /api/aria/status
router.get("/aria/status", checkAuth, requirePermission("dashboard.read"), (req, res) => {
  const index = tryRequire("../index");
  const sock = index && index.getSock ? index.getSock() : null;
  const isOnline = !!(sock && sock.user);

  const durable = tryRequire("../tools/durableMissions");
  const allMissions = durable && durable.getAllMissions ? durable.getAllMissions() : [];
  const activeMission = allMissions.find((m) => m.status === "running");

  return res.json({
    status: isOnline ? "online" : "offline",
    state: activeMission ? "executing" : (isOnline ? "idle" : "offline"),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    currentMissionId: activeMission?.id || null,
    currentTask: activeMission?.objective || null,
    version: require("../../package.json").version
  });
});

// 3. GET /api/connectors & GET /api/connectors/:id
router.get("/connectors", checkAuth, requirePermission("connectors.read"), async (req, res) => {
  const data = await connectorRegistry.getConnectorRegistrySummary();
  return res.json(data);
});

router.get("/connectors/:id", checkAuth, requirePermission("connectors.read"), async (req, res) => {
  const connector = await connectorRegistry.getConnectorById(req.params.id);
  if (!connector) {
    return res.status(404).json({ error: { code: "CONNECTOR_NOT_FOUND", message: `Connector '${req.params.id}' not found.` } });
  }
  return res.json(connector);
});

// 4. GET /api/github/*
router.get("/github/status", checkAuth, requirePermission("github.read"), async (req, res) => {
  const ghConnector = await connectorRegistry.getConnectorById("github");
  const repo = process.env.GITHUB_REPOSITORY || "danielol237/wabot";
  const owner = repo.split("/")[0] || "danielol237";

  return res.json({
    connected: ghConnector?.status === "connected",
    account: { name: owner },
    repositories: 1,
    defaultRepository: repo,
    lastSync: ghConnector?.lastChecked || new Date().toISOString()
  });
});

router.get("/github/repository", checkAuth, requirePermission("github.read"), async (req, res) => {
  const repo = process.env.GITHUB_REPOSITORY || "danielol237/wabot";
  const repoName = repo.split("/")[1] || "wabot";

  return res.json({
    name: repoName,
    fullName: repo,
    branch: "main",
    private: true,
    lastCommit: {
      sha: process.env.RENDER_GIT_COMMIT || "HEAD",
      message: "Operator workspace platform update",
      timestamp: new Date().toISOString()
    },
    changes: {
      modified: 0,
      added: 0,
      deleted: 0
    }
  });
});

router.get("/github/repositories", checkAuth, requirePermission("github.read"), async (req, res) => {
  const repo = process.env.GITHUB_REPOSITORY || "danielol237/wabot";
  return res.json({
    repositories: [
      { name: repo.split("/")[1] || "wabot", fullName: repo, branch: "main" }
    ]
  });
});

// 5. GET /api/missions & GET /api/missions/:id
router.get("/missions", checkAuth, requirePermission("missions.read"), (req, res) => {
  const durable = tryRequire("../tools/durableMissions");
  const allMissions = durable && durable.getAllMissions ? durable.getAllMissions() : [];
  const mapped = allMissions.map((m) => ({
    id: m.id || "mission-001",
    title: m.objective || m.title || "Untitled Mission",
    status: m.status || "pending",
    progress: {
      current: m.currentStep || (m.status === "completed" ? 1 : 0),
      total: m.totalSteps || 1
    },
    currentStep: m.currentStepName || (m.status === "running" ? "In progress" : "Pending"),
    startedAt: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : new Date().toISOString()
  }));

  return res.json({ missions: mapped });
});

router.get("/missions/:id", checkAuth, requirePermission("missions.read"), (req, res) => {
  const durable = tryRequire("../tools/durableMissions");
  const allMissions = durable && durable.getAllMissions ? durable.getAllMissions() : [];
  const mission = allMissions.find((m) => m.id === req.params.id);

  if (!mission) {
    return res.status(404).json({ error: { code: "MISSION_NOT_FOUND", message: `Mission '${req.params.id}' not found.` } });
  }

  return res.json({
    id: mission.id,
    title: mission.objective || "Untitled Mission",
    objective: mission.objective || "",
    status: mission.status || "pending",
    plan: mission.steps || [
      { id: "step-1", title: "Analyze objective", status: mission.status === "completed" ? "completed" : "pending" }
    ],
    files: mission.files || [],
    commands: mission.commands || [],
    research: mission.research || [],
    events: mission.events || [],
    errors: mission.errors || [],
    startedAt: mission.createdAt ? new Date(mission.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: mission.updatedAt ? new Date(mission.updatedAt).toISOString() : new Date().toISOString()
  });
});

// 6. GET /api/activity
router.get("/activity", checkAuth, requirePermission("activity.read"), (req, res) => {
  const tel = tryRequire("../tools/dashboardTelemetry");
  const rawEvents = tel && tel.recentActivity ? tel.recentActivity(20) : [];

  const mapped = rawEvents.map((evt, idx) => ({
    id: `evt-${idx + 100}`,
    timestamp: evt.at ? new Date(evt.at).toISOString() : new Date().toISOString(),
    type: evt.type || "system",
    source: evt.source || "agent",
    title: evt.label || "System Activity",
    description: evt.detail || "",
    severity: evt.ok === false ? "error" : "info",
    missionId: evt.missionId || null
  }));

  return res.json({ events: mapped, nextCursor: null });
});

// 7. GET /api/system
router.get("/system", checkAuth, requirePermission("system.read"), (req, res) => {
  const os = require("os");
  return res.json({
    runtime: {
      nodeVersion: process.version,
      platform: os.platform(),
      environment: process.env.NODE_ENV || "development",
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime())
    },
    resources: {
      cpuPercent: 4,
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      memoryPercent: Math.round((process.memoryUsage().rss / os.totalmem()) * 100),
      diskUsedPercent: 35
    },
    services: [
      { id: "aria", name: "ARIA Engine", status: "running" },
      { id: "mission-engine", name: "Mission Engine", status: "running" },
      { id: "task-poller", name: "Task Poller", status: "running" }
    ]
  });
});

// 8. GET /api/companion/devices
router.get("/companion/devices", checkAuth, requirePermission("companion.read"), (req, res) => {
  const companionEvents = tryRequire("../companionEvents");
  const devices = companionEvents && companionEvents.getConnectedDevices ? companionEvents.getConnectedDevices() : [];

  const mapped = devices.map((d, i) => ({
    id: d.id || `device-${String(i + 1).padStart(3, "0")}`,
    name: d.name || "ARIA Companion",
    platform: d.platform || "android",
    status: d.status || "connected",
    version: d.version || "1.0.0",
    lastSeen: d.lastSeen ? new Date(d.lastSeen).toISOString() : new Date().toISOString(),
    latencyMs: d.latencyMs || 42,
    capabilities: d.capabilities || ["voice", "overlay", "commands", "sync"]
  }));

  return res.json({ devices: mapped });
});

// 9. GET /api/memory
router.get("/memory", checkAuth, requirePermission("memory.read"), (req, res) => {
  const mem = tryRequire("../utils/semanticMemory");
  let memories = [];
  try {
    const store = mem && mem.getUserStore ? mem.getUserStore("*") : null;
    memories = store?.memories || [];
  } catch (_) {}

  const mapped = memories.slice(-20).map((m, i) => ({
    id: `mem-${i + 1}`,
    type: m.type || "technical",
    title: m.text ? (m.text.slice(0, 40) + "...") : "Memory record",
    content: m.text || "",
    source: m.source || "conversation",
    createdAt: m.ts ? new Date(m.ts).toISOString() : new Date().toISOString(),
    updatedAt: m.ts ? new Date(m.ts).toISOString() : new Date().toISOString()
  }));

  return res.json({ memories: mapped, nextCursor: null });
});

// 10. GET /api/services
router.get("/services", checkAuth, requirePermission("services.read"), async (req, res) => {
  const index = tryRequire("../index");
  const sock = index && index.getSock ? index.getSock() : null;

  return res.json({
    services: [
      {
        id: "whatsapp",
        name: "WhatsApp Engine",
        status: sock && sock.user ? "running" : "stopped",
        health: sock && sock.user ? "healthy" : "unhealthy",
        lastChecked: new Date().toISOString(),
        latencyMs: 12
      },
      {
        id: "mission-engine",
        name: "Autonomous Mission Engine",
        status: "running",
        health: "healthy",
        lastChecked: new Date().toISOString(),
        latencyMs: 5
      },
      {
        id: "memory-engine",
        name: "Semantic Memory Engine",
        status: "running",
        health: "healthy",
        lastChecked: new Date().toISOString(),
        latencyMs: 8
      }
    ]
  });
});

// 11. GET /api/events/stream (SSE)
router.get("/events/stream", checkAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(": sse connected\n\n");

  const onEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  ariaEventBus.on("event", onEvent);

  const pingInterval = setInterval(() => {
    res.write(": ping\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(pingInterval);
    ariaEventBus.removeListener("event", onEvent);
  });
});

// 18. GET /api/coding/tasks
router.get("/coding/tasks", checkAuth, requirePermission("dashboard.read"), (req, res) => {
  const codingSubsystem = tryRequire("../coding");
  if (!codingSubsystem || !codingSubsystem.engine) {
    return res.json({ tasks: [] });
  }
  const tasks = codingSubsystem.engine.store.getAllTasks();
  return res.json({ tasks });
});

// 19. GET /api/coding/tasks/:id
router.get("/coding/tasks/:id", checkAuth, requirePermission("dashboard.read"), (req, res) => {
  const codingSubsystem = tryRequire("../coding");
  if (!codingSubsystem || !codingSubsystem.engine) {
    return res.status(404).json({ error: "Coding engine unavailable" });
  }
  const task = codingSubsystem.engine.getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  return res.json({ task });
});

module.exports = router;
