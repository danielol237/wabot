// ── Log Stream ────────────────────────────────────────────────────
// Lightweight in-memory ring buffer + EventEmitter for live logs.
// Hooked into src/utils/logger so every log/error/warn/debug call feeds
// the dashboard's SSE log console. Keeps the last N entries for replay.

const { EventEmitter } = require("events");

const MAX_ENTRIES = 500;
const emitter = new EventEmitter();
let buffer = [];

function push(level, message) {
  const entry = {
    id: (buffer.length ? buffer[buffer.length - 1].id : 0) + 1,
    level,
    message: String(message || ""),
    ts: Date.now(),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  emitter.emit("log", entry);
  return entry;
}

function getRecent(limit = 100, filter = {}) {
  let out = buffer;
  if (filter.level) out = out.filter((e) => e.level === filter.level);
  if (filter.search) out = out.filter((e) => e.message.toLowerCase().includes(filter.search.toLowerCase()));
  return out.slice(-limit);
}

function subscribe(fn) {
  emitter.on("log", fn);
  return () => emitter.off("log", fn);
}

module.exports = { push, getRecent, subscribe };
