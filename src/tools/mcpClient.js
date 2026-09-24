// ── Generic MCP (Model Context Protocol) client — Streamable HTTP ──────
// A small, dependency-free (axios-only) client for any MCP server that
// implements the Streamable HTTP transport: one HTTP endpoint, JSON-RPC 2.0
// requests, and a response that is either a plain JSON object or a
// text/event-stream. This is written against the protocol, not against any
// one vendor, so the same client serves Composio's MCP gateway today and any
// other remote MCP server later without new per-server code.
//
// A "server" object here is a plain mutable record — see mcpServers.js —
// with at least { id, url, headers }. This module attaches `sessionId` and
// `initialized` onto that same object as it learns them, so the caller only
// needs to keep one object per server around, not manage state itself.

const axios = require("axios");

let requestCounter = 0;
function nextId() {
  requestCounter += 1;
  return requestCounter;
}

// A Streamable HTTP response body is either a single JSON object or an SSE
// stream of `data: <json>` lines. Either way, pull out the JSON-RPC payload
// that answers our request (the last parseable event, if there are several).
function parseResponseBody(contentType, raw) {
  if (String(contentType || "").includes("text/event-stream")) {
    const events = String(raw)
      .split(/\r?\n\r?\n/)
      .map((block) => block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join(""))
      .filter(Boolean);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      try { return JSON.parse(events[i]); } catch (_) { /* keep looking at earlier events */ }
    }
    throw new Error("MCP server sent an event stream with no parseable JSON-RPC payload.");
  }
  if (typeof raw === "object" && raw !== null) return raw;
  const text = String(raw || "").trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function rpc(server, method, params, { isNotification = false, timeout = 20000 } = {}) {
  const body = { jsonrpc: "2.0", method, params };
  if (!isNotification) body.id = nextId();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(server.sessionId ? { "Mcp-Session-Id": server.sessionId } : {}),
    ...(server.headers || {}),
  };
  const response = await axios.post(server.url, body, {
    headers,
    timeout,
    responseType: "text",
    transformResponse: [(data) => data],
    validateStatus: () => true,
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`MCP server ${server.id} rejected the request (HTTP ${response.status}) — check its API key/auth.`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`MCP server ${server.id} returned HTTP ${response.status}: ${String(response.data || "").slice(0, 300)}`);
  }
  const sessionId = response.headers?.["mcp-session-id"];
  if (sessionId) server.sessionId = sessionId;
  if (isNotification || !response.data) return null;
  const parsed = parseResponseBody(response.headers?.["content-type"], response.data);
  if (parsed.error) throw new Error(`MCP server ${server.id} error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  return parsed.result;
}

// Required MCP handshake, once per server object: initialize, then the
// notifications/initialized notification. Safe to call before every
// operation — it no-ops once server.initialized is set.
async function ensureInitialized(server) {
  if (server.initialized) return;
  await rpc(server, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "aria-wabot", version: "1.0.0" },
  });
  await rpc(server, "notifications/initialized", {}, { isNotification: true });
  server.initialized = true;
}

async function listTools(server) {
  await ensureInitialized(server);
  const result = await rpc(server, "tools/list", {});
  return Array.isArray(result?.tools) ? result.tools : [];
}

async function callTool(server, name, args = {}) {
  await ensureInitialized(server);
  const result = await rpc(server, "tools/call", { name, arguments: args || {} }, { timeout: 45000 });
  const text = (result?.content || [])
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return { isError: Boolean(result?.isError), text: text || (result?.isError ? "The tool reported an error with no message." : ""), raw: result };
}

module.exports = { listTools, callTool, ensureInitialized };
