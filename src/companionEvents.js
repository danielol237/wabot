const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { verifyCompanionSession, supabaseConfig } = require("./companionSupabase");
const { ownerContext } = require("./core/productBridge");

const MAX_CLIENTS = 100;
const MAX_EVENT_BYTES = 32 * 1024;
const clients = new Set();
let wss = null;

function sameSecret(received, expected) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function bearerToken(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function authenticate(req) {
  const token = bearerToken(req);
  const claims = verifyCompanionSession(token);
  if (claims) return { userId: claims.sub, tenantId: claims.tid, authType: "supabase" };
  const expected = String(process.env.COMPANION_API_KEY || "");
  if (expected && sameSecret(req.headers["x-companion-key"], expected)) {
    const context = ownerContext("android-companion-legacy");
    if (context) return { userId: context.userId, tenantId: context.tenantId, authType: "legacy" };
  }
  return null;
}

function normalizeEvent(event) {
  const type = String(event?.type || "").slice(0, 60);
  const allowed = new Set(["whatsapp_message", "proactive_message", "connection_state", "task_started", "task_progress", "task_completed", "task_failed", "memory_updated"]);
  if (!allowed.has(type)) return null;
  return {
    type,
    eventId: String(event.eventId || crypto.randomUUID()),
    timestamp: event.timestamp || new Date().toISOString(),
    source: String(event.source || "wabot").slice(0, 40),
    conversationId: event.conversationId ? String(event.conversationId).slice(0, 120) : undefined,
    payload: event.payload && typeof event.payload === "object" ? event.payload : {},
  };
}

function publish(event, target = {}) {
  const normalized = normalizeEvent(event);
  if (!normalized) return { delivered: 0, ignored: true };
  const raw = JSON.stringify(normalized);
  if (Buffer.byteLength(raw, "utf8") > MAX_EVENT_BYTES) return { delivered: 0, ignored: true, reason: "event-too-large" };
  let delivered = 0;
  for (const client of clients) {
    if (target.userId && client.userId !== target.userId) continue;
    if (target.tenantId && client.tenantId !== target.tenantId) continue;
    if (client.readyState !== 1) continue;
    try {
      client.send(raw);
      delivered += 1;
    } catch (_) {}
  }
  return { delivered };
}

function attach(server, path = "/api/companion/events") {
  wss = new WebSocketServer({ noServer: true, maxPayload: MAX_EVENT_BYTES, clientTracking: false });
  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    if (requestUrl.pathname !== path) return;
    if (clients.size >= MAX_CLIENTS) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const auth = authenticate(req);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      client.userId = auth.userId;
      client.tenantId = auth.tenantId;
      client.authType = auth.authType;
      clients.add(client);
      client.send(JSON.stringify({ type: "connection_state", eventId: crypto.randomUUID(), timestamp: new Date().toISOString(), source: "wabot", payload: { state: "connected", auth: auth.authType } }));
      client.on("close", () => clients.delete(client));
      client.on("error", () => clients.delete(client));
      client.on("message", () => {}); // server-push channel; client commands are ignored
    });
  });
  return wss;
}

function close() {
  for (const client of clients) {
    try { client.close(1001, "server shutdown"); } catch (_) {}
  }
  clients.clear();
  if (wss) wss.close();
  wss = null;
}

module.exports = { attach, publish, close, _test: { clients, normalizeEvent, authenticate } };
