"use strict";

/**
 * Macaly sign-in for ARIA, one account per WhatsApp user (like the GitHub connect).
 *
 * The bot discovers Macaly's OAuth endpoints itself (RFC 9728 / RFC 8414) and registers
 * itself automatically (RFC 7591) unless MACALY_OAUTH_CLIENT_ID is set.
 *   - If Macaly offers a device-code flow, the user gets a link plus a one-time code
 *     (exactly like the GitHub connect).
 *   - Otherwise the user gets a sign-in link, and approval lands on a small callback
 *     server started by the bot (needs MACALY_OAUTH_REDIRECT_URI).
 *
 * Environment (all optional):
 *   MACALY_MCP_URL             MCP server URL (default: Macaly Cloud endpoint)
 *   MACALY_OAUTH_CLIENT_ID     Use a pre-registered OAuth client instead of auto-registering
 *   MACALY_OAUTH_SCOPE         Scope to request (default: none, server decides)
 *   MACALY_OAUTH_REDIRECT_URI  Public URL of the callback, e.g. https://bot.example.com/macaly/callback
 *   MACALY_CALLBACK_PORT       Local port for the callback server (default 8765)
 *   MACALY_CALLBACK_HOST       Local bind address (default 0.0.0.0)
 */

const crypto = require("crypto");
const http = require("http");
const vault = require("./macalyCredentialVault");

const DEFAULT_MCP_URL = "https://www.macaly.com/api/cloud/claude/mcp";
const PROTOCOL_VERSION = "2025-03-26";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const MIN_POLL_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const REFRESH_MARGIN_MS = 60 * 1000;

const pending = new Map(); // actorJid -> { cancel }
const pendingAuth = new Map(); // state -> flow (link + callback mode)
const refreshing = new Map(); // actorJid -> Promise
let callbackServer = null;
let callbackKey = "";

function cleanError(value) {
  return String(value || "Macaly sign-in failed").replace(/[\r\n]+/g, " ").slice(0, 240);
}
function mcpUrl(env = process.env) { return String(env.MACALY_MCP_URL || DEFAULT_MCP_URL).trim(); }
function b64url(buffer) { return Buffer.from(buffer).toString("base64url"); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function fetchOf(deps) { return deps.fetchImpl || globalThis.fetch; }

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch (_) { return null; }
}

async function getJson(url, deps) {
  try {
    const res = await fetchOf(deps)(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { ok: res.ok, status: res.status, data: await readJson(res) };
  } catch (_) {
    return { ok: false, status: 0, data: null };
  }
}

async function postForm(url, fields, deps) {
  const body = new URLSearchParams(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => [key, String(value)])).toString();
  const res = await fetchOf(deps)(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, data: (await readJson(res)) || {} };
}

async function postJson(url, payload, deps) {
  const res = await fetchOf(deps)(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, data: (await readJson(res)) || {} };
}

// Finds the authorization server that protects the MCP endpoint.
async function discover(url, deps = {}) {
  const target = new URL(url);
  const candidates = [];
  try {
    const probe = await fetchOf(deps)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "aria-wabot", version: "1.0.0" } } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const match = /resource_metadata="([^"]+)"/i.exec(probe.headers.get("www-authenticate") || "");
    if (match) candidates.push(match[1]);
    await probe.text().catch(() => "");
  } catch (_) { /* fall back to well-known locations */ }
  const suffix = target.pathname === "/" ? "" : target.pathname;
  candidates.push(`${target.origin}/.well-known/oauth-protected-resource${suffix}`, `${target.origin}/.well-known/oauth-protected-resource`);

  let resourceMeta = null;
  for (const candidate of candidates) {
    const result = await getJson(candidate, deps);
    if (result.ok && result.data) { resourceMeta = result.data; break; }
  }
  const issuer = String(resourceMeta?.authorization_servers?.[0] || target.origin);
  const issuerUrl = new URL(issuer);
  const issuerPath = issuerUrl.pathname.replace(/\/$/, "");
  const metaCandidates = [
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerPath}`,
    `${issuerUrl.origin}/.well-known/openid-configuration${issuerPath}`,
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
  ];
  for (const candidate of metaCandidates) {
    const result = await getJson(candidate, deps);
    if (result.ok && result.data?.token_endpoint) return { issuer, meta: result.data, resource: String(resourceMeta?.resource || url) };
  }
  throw new Error("Could not find Macaly's sign-in endpoints.");
}

async function ensureClient(found, { redirectUri = null, device = false } = {}, deps = {}) {
  const env = deps.env || process.env;
  const preset = String(env.MACALY_OAUTH_CLIENT_ID || "").trim();
  if (preset) return { client_id: preset };
  const key = `${found.issuer}|${redirectUri || "device"}`;
  const cached = vault.getClient(key);
  if (cached?.client_id) return cached;
  const endpoint = found.meta.registration_endpoint;
  if (!endpoint) throw new Error("Macaly does not offer automatic app registration. Set MACALY_OAUTH_CLIENT_ID to a client you registered.");
  const result = await postJson(endpoint, {
    client_name: "ARIA WhatsApp assistant",
    redirect_uris: redirectUri ? [redirectUri] : [],
    grant_types: [...(redirectUri ? ["authorization_code"] : []), "refresh_token", ...(device ? [DEVICE_GRANT] : [])],
    response_types: redirectUri ? ["code"] : [],
    token_endpoint_auth_method: "none",
  }, deps);
  if (!result.ok || !result.data.client_id) throw new Error(cleanError(result.data.error_description || result.data.error || `Macaly registration failed (HTTP ${result.status})`));
  const client = { client_id: result.data.client_id };
  vault.setClient(key, client);
  return client;
}

function saveTokens(user, tokens, info, previous = null) {
  vault.setForUser(user, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || previous?.refresh_token || null,
    expires_at: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null,
    token_type: tokens.token_type || "Bearer",
    client_id: info.client_id,
    token_endpoint: info.token_endpoint,
    resource: info.resource,
    issuer: info.issuer,
  });
}

async function pollDevice({ device, client, found, state }, deps) {
  const deadline = Date.now() + Math.min(MAX_WAIT_MS, Number(device.expires_in || 600) * 1000);
  const bump = deps.pollMs ?? 5000;
  let interval = deps.pollMs ?? Math.max(Number(device.interval || 5) * 1000, MIN_POLL_MS);
  while (Date.now() < deadline) {
    await sleep(interval);
    if (state.cancelled) throw new Error("The Macaly sign-in was cancelled.");
    const result = await postForm(found.meta.token_endpoint, { grant_type: DEVICE_GRANT, device_code: device.device_code, client_id: client.client_id }, deps);
    const data = result.data || {};
    if (data.access_token) return data;
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") { interval += bump; continue; }
    if (data.error === "expired_token") throw new Error("The Macaly code expired. Start again.");
    if (data.error === "access_denied") throw new Error("Macaly access was denied.");
    throw new Error(cleanError(data.error_description || data.error || `Macaly returned HTTP ${result.status}`));
  }
  throw new Error("The Macaly sign-in window expired. Start again when ready.");
}

async function startDevice({ user, found, notify, onLinked }, deps) {
  const env = deps.env || process.env;
  const client = await ensureClient(found, { device: true }, deps);
  const response = await postForm(found.meta.device_authorization_endpoint, { client_id: client.client_id, scope: env.MACALY_OAUTH_SCOPE, resource: found.resource }, deps);
  const device = response.data;
  if (!response.ok || !device.device_code) throw new Error(cleanError(device.error_description || device.error || `Macaly returned HTTP ${response.status}`));
  const minutes = Math.max(1, Math.round(Number(device.expires_in || 600) / 60));
  const link = device.verification_uri || device.verification_uri_complete;
  const state = { cancelled: false };
  pending.set(user, { cancel: () => { state.cancelled = true; } });
  await notify(`🔐 *Connect Macaly*\n\n1. Open: ${link}\n2. Enter this one-time code: *${device.user_code}*\n3. Approve access to your Macaly account.\n\nThis code expires in about ${minutes} minutes. ARIA never asks you to paste a token.`);
  (async () => {
    try {
      const tokens = await pollDevice({ device, client, found, state }, deps);
      saveTokens(user, tokens, { client_id: client.client_id, token_endpoint: found.meta.token_endpoint, resource: found.resource, issuer: found.issuer });
      pending.delete(user);
      await notify("✅ Macaly is now linked to your WhatsApp account. ARIA stored the credential encrypted, just for you; no token was shown or sent through WhatsApp.");
      if (onLinked) await onLinked();
    } catch (error) {
      pending.delete(user);
      await notify(`❌ Macaly linking did not complete: ${cleanError(error.message)}`);
    }
  })().catch(() => pending.delete(user));
  return { success: true, pending: true, mode: "device" };
}

function page(message) {
  const safe = String(message).replace(/[<>&]/g, "");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARIA</title><body style="font-family:sans-serif;text-align:center;padding:3rem"><h2>${safe}</h2>`;
}

async function completeAuth(query) {
  const flow = pendingAuth.get(String(query.state || ""));
  if (!flow) return { status: 400, html: page("This sign-in link is invalid or has expired. Ask ARIA to connect Macaly again.") };
  pendingAuth.delete(String(query.state));
  clearTimeout(flow.timer);
  pending.delete(flow.user);
  if (query.error || !query.code) {
    setImmediate(() => flow.notify(`❌ Macaly linking did not complete: ${cleanError(query.error_description || query.error || "no approval was given")}`).catch(() => {}));
    return { status: 400, html: page("Macaly access was not approved. You can close this page.") };
  }
  try {
    const result = await postForm(flow.found.meta.token_endpoint, {
      grant_type: "authorization_code",
      code: query.code,
      redirect_uri: flow.redirectUri,
      client_id: flow.client.client_id,
      code_verifier: flow.verifier,
      resource: flow.found.resource,
    }, flow.deps);
    if (!result.data.access_token) throw new Error(cleanError(result.data.error_description || result.data.error || `Macaly returned HTTP ${result.status}`));
    saveTokens(flow.user, result.data, { client_id: flow.client.client_id, token_endpoint: flow.found.meta.token_endpoint, resource: flow.found.resource, issuer: flow.found.issuer });
    setImmediate(async () => {
      try {
        await flow.notify("✅ Macaly is now linked to your WhatsApp account. ARIA stored the credential encrypted, just for you; no token was shown or sent through WhatsApp.");
        if (flow.onLinked) await flow.onLinked();
      } catch (_) { /* nothing more to do */ }
    });
    return { status: 200, html: page("Macaly is connected. You can return to WhatsApp.") };
  } catch (error) {
    setImmediate(() => flow.notify(`❌ Macaly linking did not complete: ${cleanError(error.message)}`).catch(() => {}));
    return { status: 500, html: page("Something went wrong finishing the sign-in. Ask ARIA to try again.") };
  }
}

async function ensureCallbackServer(redirectUri, env) {
  const port = Number(env.MACALY_CALLBACK_PORT || 8765);
  const host = env.MACALY_CALLBACK_HOST || "0.0.0.0";
  const route = new URL(redirectUri).pathname;
  const key = `${host}:${port}${route}`;
  if (callbackServer && callbackKey === key) return;
  await stopCallbackServer();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method !== "GET" || url.pathname !== route) { res.writeHead(404).end("Not found"); return; }
    const result = await completeAuth(Object.fromEntries(url.searchParams));
    res.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" }).end(result.html);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  server.unref();
  callbackServer = server;
  callbackKey = key;
}

function stopCallbackServer() {
  const server = callbackServer;
  callbackServer = null;
  callbackKey = "";
  return server ? new Promise((resolve) => server.close(resolve)) : Promise.resolve();
}

async function startCode({ user, found, notify, onLinked }, deps) {
  const env = deps.env || process.env;
  const redirectUri = String(env.MACALY_OAUTH_REDIRECT_URI || "").trim();
  if (!found.meta.authorization_endpoint) throw new Error("Macaly did not publish a sign-in page address.");
  if (!redirectUri) throw new Error("Sign-in by link needs MACALY_OAUTH_REDIRECT_URI (the public address of this bot's /macaly/callback). Ask the administrator to set it.");
  const client = await ensureClient(found, { redirectUri }, deps);
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const url = new URL(found.meta.authorization_endpoint);
  const params = { response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256", resource: found.resource, scope: env.MACALY_OAUTH_SCOPE };
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  await ensureCallbackServer(redirectUri, env);
  const timer = setTimeout(() => {
    if (pendingAuth.delete(state)) {
      pending.delete(user);
      notify("❌ Macaly linking did not complete: the sign-in link expired. Start again when ready.").catch(() => {});
    }
  }, deps.linkTtlMs ?? MAX_WAIT_MS);
  if (timer.unref) timer.unref();
  pendingAuth.set(state, { user, verifier, client, found, redirectUri, notify, onLinked, timer, deps });
  pending.set(user, { cancel: () => { clearTimeout(timer); pendingAuth.delete(state); } });
  await notify(`🔐 *Connect Macaly*\n\n1. Open: ${url.toString()}\n2. Sign in and approve access.\n\nThis link works once and expires in about 10 minutes. ARIA never asks you to paste a token.`);
  return { success: true, pending: true, mode: "link" };
}

// Starts linking this WhatsApp user to their own Macaly account.
async function startLink({ actorJid, notify, onLinked = null }, deps = {}) {
  const user = String(actorJid || "").trim();
  if (!user) return { success: false, error: "A WhatsApp user identity is required." };
  if (pending.has(user)) return { success: false, pending: true, error: "A Macaly sign-in is already waiting for you. Finish it or wait for it to expire." };
  try {
    const found = await discover(mcpUrl(deps.env || process.env), deps);
    const flow = { user, found, notify, onLinked };
    return found.meta.device_authorization_endpoint ? await startDevice(flow, deps) : await startCode(flow, deps);
  } catch (error) {
    return { success: false, error: cleanError(error.message) };
  }
}

function cancelLink(actorJid) {
  const user = String(actorJid || "").trim();
  const existing = pending.get(user);
  if (existing) existing.cancel();
  pending.delete(user);
  return Boolean(existing);
}

function isLinked(actorJid) {
  return Boolean(vault.getForUser(actorJid)?.access_token);
}

function unlink(actorJid) {
  cancelLink(actorJid);
  vault.clearForUser(actorJid);
}

async function refreshToken(actorJid, credential, deps) {
  const result = await postForm(credential.token_endpoint, { grant_type: "refresh_token", refresh_token: credential.refresh_token, client_id: credential.client_id, resource: credential.resource }, deps);
  if (result.data.access_token) {
    saveTokens(actorJid, result.data, credential, credential);
    return result.data.access_token;
  }
  if (result.status >= 400 && result.status < 500) { vault.clearForUser(actorJid); return null; }
  throw new Error(cleanError(result.data.error_description || result.data.error || `Macaly returned HTTP ${result.status}`));
}

// Returns a valid access token for this user, refreshing it when needed, or null if not linked.
async function getAccessToken(actorJid, deps = {}) {
  const credential = vault.getForUser(actorJid);
  if (!credential?.access_token) return null;
  if (!credential.expires_at || Date.now() < credential.expires_at - REFRESH_MARGIN_MS) return credential.access_token;
  if (!credential.refresh_token) { vault.clearForUser(actorJid); return null; }
  if (!refreshing.has(actorJid)) {
    refreshing.set(actorJid, refreshToken(actorJid, credential, deps).finally(() => refreshing.delete(actorJid)));
  }
  return refreshing.get(actorJid);
}

module.exports = {
  startLink,
  cancelLink,
  isLinked,
  unlink,
  getAccessToken,
  _test: { discover, stopCallbackServer, pending, pendingAuth, cleanError },
};
