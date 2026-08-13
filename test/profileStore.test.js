const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Full #18 regression: after the persistence merge, all four per-user memory
// stores write into ONE unified record in data/userProfiles.json. This proves
// the stores no longer fragment state across separate files — the core of the
// audit finding.
test("profileStore: all per-user stores share one unified record (audit #18)", () => {
  const ps = require("../src/utils/profileStore");
  const uid = "profile-merge-test@lid";
  ps._reset(); // start from a clean in-memory state

  const um = require("../src/utils/userMemory");
  const up = require("../src/utils/userPreferences");
  const wm = require("../src/utils/worldModel");
  const sm = require("../src/utils/semanticMemory");

  um.trackInteraction(uid, "Merge");
  um.rememberFact(uid, "loves tests");
  up.addPreference(uid, "prefers minimal");
  wm.addEntity(uid, "person", "Merge");
  sm.addMemory(uid, "working on consolidation", "project", 2);

  const db = ps._getDb();
  assert.ok(db[uid], "one unified record per user");
  assert.strictEqual(db[uid].user.name, "Merge", "userMemory landed in user.user");
  assert.ok(db[uid].user.facts.includes("loves tests"), "facts landed in user.facts");
  assert.ok(db[uid].prefs.preferences.includes("prefers minimal"), "preferences landed in prefs");
  assert.ok(Object.keys(db[uid].world.entities).length >= 1, "world entities landed in world");
  assert.ok(db[uid].semantic.memories.length >= 1, "semantic memories landed in semantic");
  // Only ONE user key — not separate files/sections scattered by store.
  assert.strictEqual(Object.keys(db).length, 1, "no cross-user bleed");

  // The unified file exists on disk after a write.
  assert.ok(fs.existsSync(ps._file), "unified userProfiles.json exists");
});

test("profileStore: legacy migration imports old per-store files", () => {
  const ps = require("../src/utils/profileStore");
  // Simulate a legacy userMemory.json then migrate.
  const dataDir = path.join(__dirname, "../data");
  const legacy = path.join(dataDir, "userMemory.json");
  const uid = "legacy-user@lid";
  fs.writeFileSync(legacy, JSON.stringify({ [uid]: { name: "Legacy", interactions: 5, facts: ["old fact"] } }));
  try {
    ps._reset();
    ps.migrateLegacy();
    const db = ps._getDb();
    assert.ok(db[uid], "legacy user imported");
    assert.strictEqual(db[uid].user.name, "Legacy", "name preserved from legacy file");
    assert.strictEqual(db[uid].user.interactions, 5, "interactions preserved");
  } finally {
    try { fs.unlinkSync(legacy); } catch (_) {}
    try { fs.unlinkSync(ps._file); } catch (_) {}
  }
});
