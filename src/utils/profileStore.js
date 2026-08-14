// ── Unified ProfileStore (audit #18 — full persistence merge) ──
// ONE persistence layer for all user-keyed memory. Previously the stores
// (semanticMemory, userMemory, learnedFacts, userPreferences, worldModel) each
// wrote their own JSON file, so there was no single "user" record and the AI
// could read contradictory state. Now they all read/write through THIS store,
// which keeps one `data/userProfiles.json` with one object per user.
//
//   data/userProfiles.json
//   { "<userId>": {
//       user:    { firstSeen, name, facts[], interactions, lastSeen, preferences{}, birthday, notes[] },
//       facts:   [ ...learnedFacts entries ... ],
//       prefs:   [ ...userPreferences entries ... ],
//       semantic:{ memories[], profile{} },
//       world:   { entities, relationships, ... }
//     }
//   }
//
// Each legacy module is now a thin adapter over this store. Their public APIs
// are unchanged, so no caller needs to change. A one-time migration imports any
// existing legacy files so nothing is lost.
//
// SAFETY: writes are atomic (write-temp-then-rename), and every mutation goes
// through here so there's a single source of truth.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "userProfiles.json");
const TMP_FILE = FILE + ".tmp";

// In-memory cache, loaded once.
let db = {};
try {
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (_) { db = {}; }

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(TMP_FILE, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(TMP_FILE, FILE); // atomic replace
    try { fs.chmodSync(FILE, 0o600); } catch (_) {}
  } catch (_) {}
}

// Get (or lazily create) the full record for a user. Each section is
// initialized empty so adapters can write into it without null checks.
function getUserRecord(userId) {
  if (!db[userId]) {
    db[userId] = { user: {}, facts: [], prefs: [], semantic: { memories: [], profile: {} }, world: {} };
  }
  return db[userId];
}

// Section accessors — used by the legacy adapter modules.
function getSection(userId, key) {
  const rec = getUserRecord(userId);
  if (!rec[key]) rec[key] = key === "user" ? {} : key === "semantic" ? { memories: [], profile: {} } : {};
  return rec[key];
}
function setSection(userId, key, value) {
  const rec = getUserRecord(userId);
  rec[key] = value;
  persist();
}
function save() {
  persist();
}

// ── One-time migration from the legacy per-store files ────────
function migrateLegacy() {
  const candidates = [
    ["userMemory.json", "userMemory", "user"],
    ["learnedFacts.json", "learnedFacts", "facts"],
    ["userPreferences.json", "userPreferences", "prefs"],
    ["semanticMemory.json", "semanticMemory", "semantic"],
    ["worldModel.json", "worldModel", "world"],
  ];
  let migrated = false;
  for (const [file, src, section] of candidates) {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) continue;
    try {
      const legacy = JSON.parse(fs.readFileSync(fp, "utf8"));
      for (const [userId, val] of Object.entries(legacy || {})) {
        const rec = getUserRecord(userId);
        if (section === "user" && !rec.user.firstSeen && val && typeof val === "object") rec.user = val;
        else if (section === "facts" && !rec.facts.length && Array.isArray(val)) rec.facts = val;
        else if (section === "prefs" && !rec.prefs.length && Array.isArray(val)) rec.prefs = val;
        else if (section === "semantic" && !rec.semantic.memories.length && val && typeof val === "object") rec.semantic = val;
        else if (section === "world" && !rec.world.entities && val && typeof val === "object") rec.world = val;
      }
      migrated = true;
    } catch (_) {}
  }
  if (migrated) persist();
}

module.exports = {
  getUserRecord,
  getSection,
  setSection,
  save,
  migrateLegacy,
  _reset: () => { db = {}; },
  _file: FILE,
  _getDb: () => db,
};
