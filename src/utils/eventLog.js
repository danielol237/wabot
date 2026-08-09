// ── ARIA Event Timeline ─────────────────────────────────────────
// A live, append-only log of everything ARIA does: missions, tool calls,
// decisions, errors, memory changes, approvals. Written to disk so it survives
// restarts and can be surfaced in the dashboard / via commands.

const fs = require("fs");
const path = require("path");
const { log, error } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "eventLog.json");

let events = [];
try {
  if (fs.existsSync(FILE)) events = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  error("Event log file corrupt, starting fresh:", err.message);
  events = [];
}
if (!Array.isArray(events)) events = [];

const MAX_EVENTS = 500; // keep the most recent 500 events in memory

// Record an event. types: mission, tool, decision, error, memory, approval, system, chat
function track(type, summary, meta = {}) {
  const ev = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    type,
    summary,
    meta,
    ts: Date.now(),
  };
  events.push(ev);
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  save();
  return ev;
}

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(events, null, 2)); } catch (err) { error("Failed to save event log:", err.message); }
}

function getEvents(filter = {}, limit = 50) {
  let list = events;
  if (filter.type) list = list.filter((e) => e.type === filter.type);
  if (filter.since) list = list.filter((e) => e.ts >= filter.since);
  return list.slice(-limit).reverse();
}

function getStats() {
  const byType = {};
  for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
  return { total: events.length, byType };
}

module.exports = { track, getEvents, getStats };
