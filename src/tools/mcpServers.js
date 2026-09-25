// Composio MCP Gateway Integration & Per-User Session Manager
const axios = require("axios");
const mcpClient = require("./mcpClient");
const { log, warn, error } = require("../utils/logger");

const SESSION_ENDPOINT = "https://backend.composio.dev/api/v1/mcp/generate-session";
const SESSION_TTL_MS = 50 * 60 * 1000; // 50 minutes (sessions expire in ~60m)
const TOOL_CACHE_MS = 5 * 60 * 1000;   // 5 minutes

function clean(value, max = 260) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function composioApiKey() {
  return String(process.env.COMPOSIO_API_KEY || "").trim();
}

function isConfigured() {
  return Boolean(composioApiKey());
}

function configuredToolkits() {
  return String(process.env.COMPOSIO_TOOLKITS || "")
    .split(",")
    .map((toolkit) => toolkit.trim())
    .filter(Boolean);
}

const sessionsByUser = new Map();

async function createSessionForUser(actorJid) {
  const apiKey = composioApiKey();
  if (!apiKey) return null;
  const body = { user_id: actorJid, mcp: true };
  const toolkits = configuredToolkits();
  if (toolkits.length) body.toolkits = toolkits.map((toolkit) => ({ toolkit }));

  const response = await axios.post(SESSION_ENDPOINT, body, {
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Composio session creation failed (HTTP ${response.status}): ${clean(JSON.stringify(response.data), 260)}`);
  }

  const data = response.data || {};
  const mcpUrl = data.mcp?.url || data.mcp_url || data.mcpUrl || data.url;
  const mcpHeaders = data.mcp?.headers || data.mcp_headers || data.headers || {};
  if (!mcpUrl) throw new Error("Composio did not return an MCP URL for this session.");

  return {
    id: `composio:${actorJid}`,
    url: mcpUrl,
    headers: mcpHeaders,
    initialized: false,
    sessionId: null,
    composioSessionId: data.session_id || data.id || null,
    createdAt: Date.now(),
  };
}

async function getSessionForUser(actorJid) {
  if (!actorJid || !isConfigured()) return null;
  const cached = sessionsByUser.get(actorJid);
  if (cached && Date.now() - cached.createdAt < SESSION_TTL_MS) return cached;
  const created = await createSessionForUser(actorJid);
  if (created) sessionsByUser.set(actorJid, created);
  return created;
}

let toolCache = new Map(); // actorJid -> { at, tools }

async function listAllTools(actorJid, { forceRefresh = false } = {}) {
  if (!actorJid || !isConfigured()) return [];
  const cached = toolCache.get(actorJid);
  if (!forceRefresh && cached && Date.now() - cached.at < TOOL_CACHE_MS) return cached.tools;
  let tools = [];
  try {
    const server = await getSessionForUser(actorJid);
    if (server) {
      tools = (await mcpClient.listTools(server)).map((tool) => ({
        server: "composio",
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || {},
      }));
    }
  } catch (err) {
    warn(`Composio session/tool list failed for user ${actorJid}: ${err.message}`);
  }
  toolCache.set(actorJid, { at: Date.now(), tools });
  return tools;
}

async function callTool(actorJid, serverId, toolName, args) {
  const server = await getSessionForUser(actorJid);
  if (!server) throw new Error("Composio is not configured, or this user has no active session.");
  return mcpClient.callTool(server, toolName, args);
}

async function requestConnectLink(actorJid, toolkitHint) {
  const apiKey = composioApiKey();
  if (!apiKey) throw new Error("COMPOSIO_API_KEY is not configured in the bot environment.");
  const server = await getSessionForUser(actorJid);
  if (!server) throw new Error("Could not create Composio session for user.");

  let tools = [];
  try { tools = await mcpClient.listTools(server); } catch (_) {}

  const manageTool = tools.find((tool) => /manage_connections|initiate_connection|create_connection|connect_account|authorize/i.test(tool.name));
  if (manageTool) {
    const result = await mcpClient.callTool(server, manageTool.name, toolkitHint ? { toolkit: toolkitHint } : {});
    if (!result.isError && result.text) return result.text;
  }

  // Fallback REST endpoint for Composio authorization link
  const app = toolkitHint || "gmail";
  try {
    const res = await axios.post(
      "https://backend.composio.dev/api/v1/connectedAccounts",
      { user_uuid: actorJid, app_name: app },
      { headers: { "x-api-key": apiKey }, timeout: 15000, validateStatus: () => true }
    );
    if (res.data && res.data.redirectUrl) {
      return `🔗 Authorize *${app.toUpperCase()}* for your Composio integration:\n${res.data.redirectUrl}`;
    }
  } catch (_) {}

  return `🔗 To connect *${app.toUpperCase()}*, use your Composio dashboard or request authorization link.`;
}

async function diagnoseComposio(actorJid) {
  const apiKey = composioApiKey();
  const configured = Boolean(apiKey);
  if (!configured) {
    return `🛠️ *Composio Diagnostic Report*\n\nAPI Status: *NOT_CONFIGURED*\nCOMPOSIO_API_KEY: missing\n\nTo enable Composio app integrations, add COMPOSIO_API_KEY to your bot environment.`;
  }

  let sessionStatus = "FAILED";
  let toolsCount = 0;
  let errMessage = null;

  try {
    const server = await getSessionForUser(actorJid);
    if (server) {
      sessionStatus = "ACTIVE";
      const tools = await listAllTools(actorJid, { forceRefresh: true });
      toolsCount = tools.length;
    }
  } catch (err) {
    errMessage = err.message;
  }

  return `🛠️ *Composio Diagnostic Report*\n\nAPI Key: *CONFIGURED* (${apiKey.slice(0, 4)}...)\nUser Session: *${sessionStatus}*\nConnected Tools: *${toolsCount}*\n${errMessage ? `Error: *${errMessage}*` : "Health: *HEALTHY*"}`;
}

module.exports = {
  listAllTools,
  callTool,
  requestConnectLink,
  diagnoseComposio,
  isConfigured,
  _test: { createSessionForUser, getSessionForUser },
};
