const express = require("express");
const path = require("path");

const authRoutes = require("./authRoutes");
const apiRoutes = require("./apiRoutes");
const legacyRoutes = require("./legacyRoutes");
const { checkAuth } = require("./middleware");
const views = require("./views");
const components = require("./viewComponents");

const connectorRegistry = require("../tools/connectorRegistry");
const auth = require("../utils/dashboardAuth");

const router = express.Router();

// Static assets (CSS)
router.use("/styles", express.static(path.join(__dirname, "styles")));

// Mount JSON Auth, API, and Legacy Routes
router.use("/", authRoutes);
router.use("/api", apiRoutes);
router.use("/", legacyRoutes);

// Page renderers
router.get("/setup", (req, res) => {
  if (auth.hasOwnerAccount()) return res.redirect("/dashboard/login");
  return res.send(views.renderSetupPage());
});

router.get("/login", (req, res) => {
  if (!auth.hasOwnerAccount()) return res.redirect("/dashboard/setup");
  return res.send(views.renderLoginPage());
});

router.get("/", checkAuth, async (req, res) => {
  const activeView = String(req.query.view || "home").toLowerCase();
  const token = req.cookies?.["aria_session"];
  const csrfToken = auth.generateCsrfToken(token);

  let innerContent = "";

  if (activeView === "home") {
    const data = await fetchOverviewData(req);
    innerContent = components.renderHomeView(data);
  } else if (activeView === "missions") {
    const missionsData = fetchMissionsData();
    innerContent = components.renderMissionsView(missionsData);
  } else if (activeView === "connectors") {
    const data = await connectorRegistry.getConnectorRegistrySummary();
    innerContent = components.renderConnectorsView(data);
  } else if (activeView === "github") {
    const ghData = { connected: true };
    const repoData = { fullName: process.env.GITHUB_REPOSITORY || "danielol237/wabot", branch: "main" };
    innerContent = components.renderGitHubView(ghData, repoData);
  } else if (activeView === "companion") {
    const companionData = { devices: [] };
    innerContent = components.renderCompanionView(companionData);
  } else if (activeView === "activity") {
    const tel = tryRequire("../tools/dashboardTelemetry");
    const rawEvents = tel && tel.recentActivity ? tel.recentActivity(20) : [];
    innerContent = components.renderActivityView({
      events: rawEvents.map((evt, idx) => ({
        id: `evt-${idx + 100}`,
        timestamp: evt.at ? new Date(evt.at).toISOString() : new Date().toISOString(),
        title: evt.label || "System Activity",
        description: evt.detail || ""
      }))
    });
  } else if (activeView === "runtime") {
    const os = require("os");
    const loadAvg = os.loadavg ? os.loadavg()[0] : null;
    const cpuCount = os.cpus().length || 1;
    const estimatedCpuPercent = loadAvg !== null ? Math.min(100, Math.round((loadAvg / cpuCount) * 100)) : null;
    innerContent = components.renderRuntimeView({
      runtime: {
        nodeVersion: process.version,
        platform: os.platform(),
        pid: process.pid,
        uptimeSeconds: Math.floor(process.uptime())
      },
      resources: {
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        memoryPercent: Math.round((process.memoryUsage().rss / os.totalmem()) * 100),
        cpuPercent: estimatedCpuPercent
      }
    });
  } else if (activeView === "services") {
    innerContent = components.renderServicesView({
      services: [
        { id: "aria", name: "WhatsApp Engine", status: "running" },
        { id: "mission-engine", name: "Autonomous Mission Engine", status: "running" },
        { id: "memory-engine", name: "Semantic Memory Engine", status: "running" }
      ]
    });
  } else if (activeView === "memory") {
    const mem = tryRequire("../utils/semanticMemory");
    let memories = [];
    try {
      const store = mem && mem.getUserStore ? mem.getUserStore("*") : null;
      memories = store?.memories || [];
    } catch (_) {}
    innerContent = components.renderMemoryView({
      memories: memories.slice(-20).map((m, i) => ({
        id: `mem-${i + 1}`,
        type: m.type || "technical",
        title: m.text ? (m.text.slice(0, 40) + "...") : "Memory record",
        content: m.text || "",
        createdAt: m.ts ? new Date(m.ts).toISOString() : new Date().toISOString()
      }))
    });
  } else if (activeView === "research") {
    innerContent = components.renderResearchView();
  } else if (activeView === "pairing") {
    innerContent = components.renderPairingView();
  } else if (activeView === "settings") {
    innerContent = components.renderSettingsView(req.user);
  } else {
    const data = await fetchOverviewData(req);
    innerContent = components.renderHomeView(data);
  }

  return res.send(views.renderShell({
    user: req.user,
    activeView,
    content: innerContent,
    csrfToken
  }));
});

async function fetchOverviewData(req) {
  const durable = tryRequire("../tools/durableMissions");
  const allMissions = durable && durable.getAllMissions ? durable.getAllMissions() : [];
  const registry = await connectorRegistry.getConnectorRegistrySummary();

  return {
    aria: {
      status: "online",
      state: "idle",
      currentTask: null
    },
    system: {
      uptimeSeconds: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
    },
    connectors: registry.summary,
    missions: {
      active: allMissions.filter(m => m.status === "running").length,
      completed: allMissions.filter(m => m.status === "completed").length
    }
  };
}

function fetchMissionsData() {
  const durable = tryRequire("../tools/durableMissions");
  const allMissions = durable && durable.getAllMissions ? durable.getAllMissions() : [];
  return { missions: allMissions };
}

function tryRequire(mod) {
  try { return require(mod); } catch (_) { return null; }
}

module.exports = router;
