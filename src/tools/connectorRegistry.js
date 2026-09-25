const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

function tryRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (_) {
    return null;
  }
}

// Connector health check routines
async function checkGitHubHealth() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || "danielol237/wabot";
  if (!token) {
    return {
      status: "auth_required",
      health: "unknown",
      latencyMs: 0,
      capabilities: ["repository.read", "repository.write", "files.read", "files.write", "commits.read"],
      error: "GITHUB_TOKEN not configured"
    };
  }
  const start = Date.now();
  try {
    const res = await globalThis.fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "ARIA-Operator-Console"
      },
      signal: AbortSignal.timeout(3000)
      }
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    return {
      status: "connected",
      health: "healthy",
      latencyMs,
      capabilities: ["repository.read", "repository.write", "files.read", "files.write", "commits.read"],
      error: null
    };
  } catch (err) {
    return {
      status: "degraded",
      health: "unhealthy",
      latencyMs: Date.now() - start,
      capabilities: ["repository.read"],
      error: err.message
    };
  }
}

async function checkWhatsAppHealth() {
  const start = Date.now();
  try {
    const pairing = tryRequire("../utils/whatsappPairing");
    const pStatus = pairing && pairing.getStatus ? pairing.getStatus() : null;
    if (pStatus && pStatus.ready) {
      return {
        status: "connected",
        health: "healthy",
        latencyMs: 15,
        capabilities: ["messaging.read", "messaging.send"],
        error: null
      };
    }
    return {
      status: pStatus?.pending ? "auth_required" : "offline",
      health: "unhealthy",
      latencyMs: Date.now() - start,
      capabilities: ["messaging.read", "messaging.send"],
      error: pStatus?.lastError || "WhatsApp socket disconnected"
    };
  } catch (err) {
    return {
      status: "offline",
      health: "unhealthy",
      latencyMs: Date.now() - start,
      capabilities: ["messaging.read", "messaging.send"],
      error: err.message
    };
  }
}

async function checkDockerHealth() {
  const start = Date.now();
  return new Promise((resolve) => {
    // Probe docker CLI availability without hanging on container execution if sandbox overlays are restricted
    exec("docker --version", { timeout: 2000 }, (error, stdout) => {
      const latencyMs = Date.now() - start;
      if (!error && stdout.includes("Docker")) {
        return resolve({
          status: "available",
          health: "healthy",
          latencyMs,
          capabilities: ["containers.run", "containers.isolate", "code.execution"],
          error: null
        });
      }
      return resolve({
        status: "offline",
        health: "unhealthy",
        latencyMs,
        capabilities: ["containers.run"],
        error: error ? error.message : "Docker unavailable"
      });
    });
  });
}

async function checkCompanionHealth() {
  const start = Date.now();
  try {
    const companionEvents = tryRequire("../companionEvents");
    const devices = companionEvents && companionEvents.getConnectedDevices ? companionEvents.getConnectedDevices() : [];
    if (devices && devices.length > 0) {
      return {
        status: "connected",
        health: "healthy",
        latencyMs: devices[0].latencyMs || 42,
        capabilities: ["voice", "overlay", "notifications", "commands", "sync"],
        error: null,
        activeDevicesCount: devices.length
      };
    }
    return {
      status: "available",
      health: "healthy",
      latencyMs: Date.now() - start,
      capabilities: ["voice", "overlay", "notifications", "commands", "sync"],
      error: null,
      activeDevicesCount: 0
    };
  } catch (err) {
    return {
      status: "offline",
      health: "unknown",
      latencyMs: Date.now() - start,
      capabilities: ["voice", "commands"],
      error: err.message,
      activeDevicesCount: 0
    };
  }
}

async function checkAiProvidersHealth() {
  const start = Date.now();
  try {
    const providerHealth = tryRequire("./providerHealth");
    if (providerHealth && providerHealth.getHealth) {
      const h = providerHealth.getHealth();
      const results = h.results || [];
      const configured = results.filter((r) => r.ok).length;
      return {
        status: configured > 0 ? "connected" : "auth_required",
        health: configured > 0 ? "healthy" : "degraded",
        latencyMs: Date.now() - start,
        capabilities: ["chat.completion", "code.generation", "multimodal.vision", "telemetry"],
        error: configured === 0 ? "No AI provider keys configured" : null
      };
    }
    const gemini = process.env.GEMINI_API_KEY;
    const mistral = process.env.MISTRAL_API_KEY;
    const groq = process.env.GROQ_API_KEY;
    const isConfigured = !!(gemini || mistral || groq);
    return {
      status: isConfigured ? "connected" : "auth_required",
      health: isConfigured ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
      capabilities: ["chat.completion", "code.generation"],
      error: isConfigured ? null : "Missing AI provider credentials"
    };
  } catch (err) {
    return {
      status: "offline",
      health: "unhealthy",
      latencyMs: Date.now() - start,
      capabilities: ["chat.completion"],
      error: err.message
    };
  }
}

async function checkResearchHealth() {
  const start = Date.now();
  const tavily = process.env.TAVILY_API_KEY;
  const val = !!tavily;
  return {
    status: val ? "connected" : "available",
    health: "healthy",
    latencyMs: Date.now() - start,
    capabilities: ["web.search", "web.extract", "source.verification"],
    error: null
  };
}

async function checkGofileHealth() {
  const start = Date.now();
  const token = process.env.GOFILE_TOKEN;
  return {
    status: token ? "connected" : "available",
    health: "healthy",
    latencyMs: Date.now() - start,
    capabilities: ["file.upload", "file.exchange"],
    error: null
  };
}

async function checkFilesystemHealth() {
  const start = Date.now();
  try {
    const testPath = path.join(__dirname, "../../temp");
    fs.mkdirSync(testPath, { recursive: true });
    return {
      status: "connected",
      health: "healthy",
      latencyMs: Date.now() - start,
      capabilities: ["files.read", "files.write", "storage.local"],
      error: null
    };
  } catch (err) {
    return {
      status: "degraded",
      health: "unhealthy",
      latencyMs: Date.now() - start,
      capabilities: ["files.read"],
      error: err.message
    };
  }
}

// Central Connector Registry
const CONNECTORS_DEFINITIONS = [
  { id: "github", name: "GitHub", category: "development", description: "GitHub repository access and automated workflows", check: checkGitHubHealth },
  { id: "whatsapp", name: "WhatsApp", category: "communication", description: "Primary WhatsApp messaging channel and socket", check: checkWhatsAppHealth },
  { id: "research", name: "Web Research", category: "research", description: "Autonomous web search, scraping, and synthesis engine", check: checkResearchHealth },
  { id: "docker", name: "Docker", category: "development", description: "Isolated container execution environment for agent tasks", check: checkDockerHealth },
  { id: "companion", name: "Android Companion", category: "companion", description: "ARIA Companion mobile device integration surface", check: checkCompanionHealth },
  { id: "ai_provider", name: "AI Providers", category: "ai", description: "Inference provider network (Gemini, Mistral, Groq, Agnes)", check: checkAiProvidersHealth },
  { id: "gofile", name: "Gofile", category: "storage", description: "Temporary file upload and exchange service", check: checkGofileHealth },
  { id: "filesystem", name: "Local Filesystem", category: "storage", description: "Local workspace file storage and persistence", check: checkFilesystemHealth }
];

let connectorCache = new Map();
let lastRegistryCheck = 0;
const CACHE_TTL_MS = 15000; // Refresh checks at most every 15s

async function refreshConnectorRegistry(force = false) {
  const now = Date.now();
  if (!force && now - lastRegistryCheck < CACHE_TTL_MS && connectorCache.size > 0) {
    return Array.from(connectorCache.values());
  }

  const results = await Promise.all(
    CONNECTORS_DEFINITIONS.map(async (def) => {
      const healthInfo = await def.check();
      const entry = {
        id: def.id,
        name: def.name,
        category: def.category,
        description: def.description,
        status: healthInfo.status,
        health: healthInfo.health,
        capabilities: healthInfo.capabilities,
        lastChecked: new Date(now).toISOString(),
        latencyMs: healthInfo.latencyMs,
        error: healthInfo.error
      };
      connectorCache.set(def.id, entry);
      return entry;
    })
  );

  lastRegistryCheck = now;
  return results;
}

function calculateConnectorSummary(connectors) {
  const summary = {
    total: connectors.length,
    available: 0,
    connected: 0,
    healthy: 0,
    degraded: 0,
    offline: 0
  };

  for (const c of connectors) {
    if (c.status === "available" || c.status === "connected") summary.available++;
    if (c.status === "connected") summary.connected++;
    if (c.health === "healthy") summary.healthy++;
    if (c.health === "degraded" || c.status === "degraded") summary.degraded++;
    if (c.status === "offline" || c.health === "unhealthy") summary.offline++;
  }

  return summary;
}

async function getConnectorRegistrySummary() {
  const connectors = await refreshConnectorRegistry();
  return {
    summary: calculateConnectorSummary(connectors),
    connectors
  };
}

async function getConnectorById(id) {
  await refreshConnectorRegistry();
  return connectorCache.get(id) || null;
}

module.exports = {
  CONNECTORS_DEFINITIONS,
  refreshConnectorRegistry,
  getConnectorRegistrySummary,
  getConnectorById,
  calculateConnectorSummary
};
