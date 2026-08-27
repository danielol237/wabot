// ── ARIA Event Timeline ─────────────────────────────────────────
// Durable, bounded operational and conversation events. The timeline stores
// metadata and short summaries—not secrets or raw media—so it can support
// debugging, continuity, and dashboard views without becoming a transcript dump.

const fs = require("fs");
const path = require("path");
const { log, error } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = process.env.ARIA_EVENT_LOG_FILE || path.join(DATA_DIR, "eventLog.json");
const MAX_EVENTS = 1000;
const MAX_META_STRING = 240;
let events = [];
try {
  if (fs.existsSync(FILE)) events = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  error("Event log file corrupt, starting fresh:", err.message);
}
if (!Array.isArray(events)) events = [];

function redact(value, depth = 0) {
  if (depth > 2) return "[truncated]";
  if (typeof value === "string") {
    if (/(?:api[_-]?key|token|password|secret|authorization|cookie)/i.test(value)) return "[redacted]";
    return value.length > MAX_META_STRING ? `${value.slice(0, MAX_META_STRING)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) {
      output[key] = /(?:api[_-]?key|token|password|secret|authorization|cookie)/i.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return output;
  }
  return value;
}

function track(type, summary, meta = {}) {
  const now = Date.now();
  const event = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    type: String(type || "system").slice(0, 40),
    summary: String(summary || "").slice(0, MAX_META_STRING),
    meta: redact(meta),
    ts: now,
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  save();
  return event;
}

function trackConversationEvent(chatId, kind, summary, meta = {}) {
  return track("chat", summary, { ...meta, chatId, kind, conversation: true });
}

function trackOperation(type, operation, status, meta = {}) {
  return track(type, `${operation}: ${status}`, { ...meta, operation, status });
}

function recordError(errorValue, meta = {}) {
  const message = typeof errorValue === "string" ? errorValue : errorValue?.message || "unknown error";
  return track("error", message, { ...meta, errorClass: errorValue?.name || meta.errorClass || "Error" });
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE, JSON.stringify(events, null, 2), { mode: 0o600 });
  } catch (err) {
    log("Event log persistence failed:", err.message);
  }
}

function getEvents(filter = {}, limit = 50) {
  const max = Math.max(1, Math.min(200, Number(limit) || 50));
  let list = events;
  if (filter.type) list = list.filter((event) => event.type === filter.type);
  if (filter.kind) list = list.filter((event) => event.meta?.kind === filter.kind);
  if (filter.chatId) list = list.filter((event) => event.meta?.chatId === filter.chatId);
  if (filter.correlationId) list = list.filter((event) => event.meta?.correlationId === filter.correlationId);
  if (filter.since) list = list.filter((event) => event.ts >= Number(filter.since));
  return list.slice(-max).reverse();
}

function getConversation(chatId, limit = 20) {
  return getEvents({ chatId, type: "chat" }, limit);
}

function getStats() {
  const byType = {};
  for (const event of events) byType[event.type] = (byType[event.type] || 0) + 1;
  return { total: events.length, byType, oldest: events[0]?.ts || null, newest: events.at(-1)?.ts || null };
}

module.exports = { track, trackConversationEvent, trackOperation, recordError, getEvents, getConversation, getStats, _test: { redact } };
