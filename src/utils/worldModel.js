// ── ARIA Personal World Model ──────────────────────────────────
// The moat of ARIA Aegis: a structured entity-relationship model of the
// user's world — people, projects, devices, apps, tasks, events, preferences,
// permissions, decisions — with provenance and confidence on every fact.
//
// Unlike raw chat history or keyword memory, this is a typed graph. ARIA
// doesn't just "remember words" — she maintains a model of WHO the user is,
// WHAT they're working on, and HOW things relate.
//
// Every fact carries: source, timestamp, confidence, scope, and whether it
// was inferred or explicitly stated. Nothing is treated as permanent truth
// unless the user confirms it.

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { log, error, warn } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "worldModel.json");

// Structure:
// {
//   [userId]: {
//     entities: { [entityId]: { type, name, properties, createdAt, updatedAt } },
//     relations: [ { id, from, to, type, properties, confidence, source, ts } ],
//     goals: [ { id, text, status, createdAt } ],
//     permissions: [ { id, action, scope, granted, ts } ],
//   }
// }
let db = {};
try {
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  error("World model file corrupt, starting fresh:", err.message);
  db = {};
}

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); } catch (err) { error("Failed to save world model:", err.message); }
}

function getUserModel(userId) {
  if (!db[userId]) {
    db[userId] = { entities: {}, relations: [], goals: [], permissions: [] };
    save();
  }
  return db[userId];
}

// ── Entity management ─────────────────────────────────────────
function addEntity(userId, type, name, properties = {}, opts = {}) {
  const model = getUserModel(userId);
  // Reuse an existing entity of same type+name instead of duplicating
  const existing = Object.values(model.entities).find(
    (e) => e.type === type && e.name.toLowerCase() === String(name).toLowerCase()
  );
  if (existing) {
    existing.properties = { ...existing.properties, ...properties };
    existing.updatedAt = Date.now();
    save();
    return existing.id;
  }
  const id = uuidv4().slice(0, 8);
  model.entities[id] = {
    id, type, name, properties,
    createdAt: Date.now(), updatedAt: Date.now(),
    confidence: opts.confidence ?? 0.8,
    source: opts.source || "user",   // user | inferred | extracted
  };
  save();
  return id;
}

function getEntity(userId, id) {
  return getUserModel(userId).entities[id] || null;
}

// ── Relations ─────────────────────────────────────────────────
function addRelation(userId, from, to, type, properties = {}, opts = {}) {
  const model = getUserModel(userId);
  // #20: dedupe identical relations (same from/to/type) — re-extraction would
  // otherwise grow the relation array unboundedly with duplicate "is_user"
  // edges. Update the existing edge's timestamp + properties instead.
  const existing = model.relations.find((r) => r.from === from && r.to === to && r.type === type);
  if (existing) {
    existing.ts = Date.now();
    existing.confidence = Math.max(existing.confidence, opts.confidence ?? 0.7);
    existing.properties = { ...existing.properties, ...properties };
    save();
    return existing.id;
  }
  const rel = {
    id: uuidv4().slice(0, 8),
    from, to, type,
    properties,
    confidence: opts.confidence ?? 0.7,
    source: opts.source || "inferred",
    ts: Date.now(),
  };
  model.relations.push(rel);
  save();
  return rel.id;
}

function getRelations(userId, entityId) {
  const model = getUserModel(userId);
  return model.relations.filter((r) => r.from === entityId || r.to === entityId);
}

// ── Goals ─────────────────────────────────────────────────────
function addGoal(userId, text) {
  const model = getUserModel(userId);
  const g = { id: uuidv4().slice(0, 8), text, status: "active", createdAt: Date.now() };
  model.goals.push(g);
  save();
  return g.id;
}

function getActiveGoals(userId) {
  return getUserModel(userId).goals.filter((g) => g.status === "active");
}

function completeGoal(userId, id) {
  const model = getUserModel(userId);
  const g = model.goals.find((x) => x.id === id);
  if (g) { g.status = "completed"; save(); }
  return !!g;
}

// ── Permissions ───────────────────────────────────────────────
function grantPermission(userId, action, scope) {
  const model = getUserModel(userId);
  const existing = model.permissions.find((p) => p.action === action && p.scope === scope);
  if (existing) { existing.granted = true; save(); return existing.id; }
  const p = { id: uuidv4().slice(0, 8), action, scope, granted: true, ts: Date.now() };
  model.permissions.push(p);
  save();
  return p.id;
}

function revokePermission(userId, action, scope) {
  const model = getUserModel(userId);
  const p = model.permissions.find((x) => x.action === action && x.scope === scope);
  if (p) { p.granted = false; save(); return true; }
  return false;
}

function isPermissionGranted(userId, action, scope) {
  const model = getUserModel(userId);
  return model.permissions.some((p) => p.action === action && p.scope === scope && p.granted);
}

// ── Auto-extract from conversation ────────────────────────────
// Cheap, deterministic extraction of entities/relations from a message.
function extractFromMessage(userId, senderName, text) {
  const lower = text.toLowerCase();

  // Person entities ("I'm Daniel", "my name is Daniel") — reject verbs that
  // follow "i am" ("i am building...") so they aren't mistaken for names.
  const NOT_A_NAME = /^(working|building|making|creating|developing|going|trying|planning|just|not|very|about|trying to|starting)$/i;
  let name = senderName;
  const nameMatch = text.match(/\b(?:call me|my name is|i am|i'm)\s+([a-z][a-z0-9]{0,15})\b/i);
  if (nameMatch && !NOT_A_NAME.test(nameMatch[1])) name = nameMatch[1];
  const userEntity = addEntity(userId, "person", name, {}, { source: "user", confidence: 0.95 });
  addRelation(userId, userEntity, userEntity, "is_user", {}, { source: "user", confidence: 1.0 });

  // Project entities ("working on X", "building X", "making X")
  const projMatch = text.match(/\b(?:working on|building|developing|making|creating)\s+(?:an?\s+)?([a-z][a-z0-9 _\-]{1,20})\b/i);
  if (projMatch && !projMatch[1].endsWith(" on")) {
    const proj = addEntity(userId, "project", projMatch[1], {}, { source: "extracted", confidence: 0.6 });
    addRelation(userId, userEntity, proj, "is_working_on", {}, { source: "extracted", confidence: 0.6 });
  }

  // Tech preferences (PostgreSQL, React, Node, etc.)
  const techMatch = lower.match(/\b(prefers|using|love|like|hates|hate)\s+(postgres|react|node|vue|angular|python|javascript|typescript|mysql|mongodb|docker|vercel|render|flask|django|express)\b/);
  if (techMatch) {
    const tech = addEntity(userId, "technology", techMatch[2], {}, { source: "extracted", confidence: 0.5 });
    const verb = techMatch[1];
    const relType = /hate|hates/.test(verb) ? "dislikes" : "prefers";
    addRelation(userId, userEntity, tech, relType, {}, { source: "extracted", confidence: 0.5 });
  }

  // Goals ("I want to", "my goal is", "planning to")
  const goalMatch = text.match(/\b(i want to|my goal is to|i'm trying to|planning to|aiming to)\s+(.{5,60})/i);
  if (goalMatch) {
    addGoal(userId, goalMatch[0].trim());
  }
}

// ── Context rendering ─────────────────────────────────────────
// Build a readable context block from the world model for prompt injection.
function getWorldContext(userId) {
  const model = getUserModel(userId);
  if (!model) return "";
  const parts = [];

  const entities = Object.values(model.entities);
  if (entities.length > 0) {
    parts.push("Known entities: " + entities.slice(-15).map((e) => `${e.type}:${e.name}`).join(", "));
  }
  if (model.relations.length > 0) {
    parts.push("Relations: " + model.relations.slice(-15).map((r) => {
      const from = model.entities[r.from]?.name || r.from;
      const to = model.entities[r.to]?.name || r.to;
      return `${from} ${r.type} ${to}`;
    }).join("; "));
  }
  const activeGoals = getActiveGoals(userId);
  if (activeGoals.length > 0) {
    parts.push("Active goals: " + activeGoals.map((g) => g.text).join(" | "));
  }
  if (parts.length === 0) return "";
  return "\n\n[Personal World Model] " + parts.join(". ") + ".";
}

module.exports = {
  addEntity, getEntity, getRelations, addRelation,
  addGoal, getActiveGoals, completeGoal,
  grantPermission, revokePermission, isPermissionGranted,
  extractFromMessage, getWorldContext, getUserModel,
};
