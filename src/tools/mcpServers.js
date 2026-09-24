// ── MCP server registry — per-user Composio sessions ────────────────
// Composio's actual multi-tenant mechanism is a "session" scoped to a
// user_id (https://backend.composio.dev/api/v3.1/tool_router/session),
// which hands back an MCP url+headers scoped to THAT user's own connected
// accounts. That's the same per-individual shape githubOAuth.js already
// uses for GitHub (one WhatsApp user, one credential, never shared) — so
// this file keys everything off actorJid, the same identity vault.js keys
// GitHub tokens off, rather than one bot-wide identity.
//
// mcpClient.js needed NO changes for this: it was already written generic
// enough to take any { id, url, headers } server record, whether that
// record is one shared server (as originally built) or one created fresh
// per user (as corrected here).

const axios = require("axios");
const mcpClient = require("./mcpClient");
const { warn } = require("../utils/logger");

const SESSION_ENDPOINT = "https://backend.composio.dev/api/v3.1/tool_router/session";
const SESSION_TTL_MS = 55 * 60 * 1000; // recreate the session before a likely ~1h expiry
const TOOL_CACHE_MS = 5 * 60 * 1000;

function clean(value, max = 300) {
  return String(value || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function composioApiKey() {
  return String(process.env.COMPOSIO_API_KEY || "").trim();
}

function isConfigured() {
  return Boolean(composioApiKey());
}

// Optional: restrict which toolkits a session can see, via
// COMPOSIO_TOOLKITS="gmail,slack,notion". Unset = whatever the Composio
// project has enabled for this API key, no per-toolkit code needed here.
function configuredToolkits() {
  return String(process.env.COMPOSIO_TOOLKITS || "")
    .split(",")
    .map((toolkit) => toolkit.trim())
    .filter(Boolean);
}

// One Composio session per WhatsApp user, cached and reused until it's
// close to expiry. Each entry is an mcpClient-compatible server record
// PLUS composioSessionId/createdAt for our own bookkeeping — kept as
// separate fields from mcpClient's own `sessionId` (the MCP-protocol
// Mcp-Session-Id header) so the two never collide.
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
  // Defensive field lookup: I have solid documentation that a session
  // response carries an MCP url+headers, but not a byte-exact field-name
  // guarantee, so check the plausible shapes rather than assume one.
  const mcpUrl = data.mcp?.url || data.mcp_url || data.mcpUrl || data.url;
  const mcpHeaders = data.mcp?.headers || data.mcp_headers || data.headers || {};
  if (!mcpUrl) throw new Error("Composio did not return an MCP URL for this session — its response shape may have changed since this was written.");
  return {
    id: `composio:${actorJid}`,
    url: mcpUrl,
    headers: mcpHeaders,
    initialized: false,
    sessionId: null, // mcpClient's own Mcp-Session-Id bookkeeping, not Composio's
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

// Returns [{ server: "composio", name, description, inputSchema }] for
// THIS user's own connected accounts only — never another user's.
async function listAllTools(actorJid, { forceRefresh = false } = {}) {
  if (!actorJid || !isConfigured()) return [];
  const cached = toolCache.get(actorJid);
  if (!forceRefresh && cached && Date.now() - cached.at < TOOL_CACHE_MS) return cached.tools;
  let tools = [];
  try {
    const server = await getSessionForUser(actorJid);
    if (server) tools = (await mcpClient.listTools(server)).map((tool) => ({ server: "composio", name: tool.name, description: tool.description || "", inputSchema: tool.inputSchema || {} }));
  } catch (err) {
    // One user's session failing must never break another user's request,
    // and must never crash the classifier — just fewer live tools this round.
    warn(`Composio session/tool list failed for a user: ${err.message}`);
  }
  toolCache.set(actorJid, { at: Date.now(), tools });
  return tools;
}

async function callTool(actorJid, serverId, toolName, args) {
  const server = await getSessionForUser(actorJid);
  if (!server) throw new Error("Composio is not configured, or this user has no session.");
  return mcpClient.callTool(server, toolName, args);
}

// "Connect my gmail" style requests. Composio's session exposes an
// in-chat-authentication meta-tool (documented as COMPOSIO_MANAGE_CONNECTIONS)
// that generates a Connect Link for a given toolkit — this searches for it
// by name pattern rather than assuming the exact string, since that's the
// one piece I could not confirm byte-for-byte. Whatever text it returns
// (expected to contain a link) is relayed to the user as-is; ARIA does not
// parse or rewrite it, since the exact wording/URL matters for the user to
// actually complete the connection.
async function requestConnectLink(actorJid, toolkitHint) {
  const server = await getSessionForUser(actorJid);
  if (!server) throw new Error("Composio is not configured.");
  const tools = await mcpClient.listTools(server);
  const manageTool = tools.find((tool) => /manage_connections|initiate_connection|create_connection|connect_account/i.test(tool.name));
  if (!manageTool) throw new Error("This Composio session has no connection-management tool available — the app may need to be connected from the Composio dashboard instead.");
  const result = await mcpClient.callTool(server, manageTool.name, toolkitHint ? { toolkit: toolkitHint } : {});
  if (result.isError) throw new Error(result.text || "Composio could not start that connection.");
  return result.text || "Composio did not return a connection link.";
}

module.exports = { listAllTools, callTool, requestConnectLink, isConfigured, _test: { createSessionForUser, getSessionForUser } };
