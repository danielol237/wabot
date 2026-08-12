// Learning digest tests.
const test = require("node:test");
const assert = require("node:assert");

test("digest: builds a weekly summary with the expected shape", () => {
  const { buildDigest, digestView } = require("../src/tools/academy/learningDigest");
  const d = buildDigest("D-" + Date.now(), { days: 7 });
  assert.ok(d.uid, "has uid");
  assert.strictEqual(d.days, 7);
  assert.ok(Array.isArray(d.masteryRows), "masteryRows array");
  assert.ok(Array.isArray(d.decaying), "decaying array");
  const view = digestView(d, d.uid);
  assert.ok(view.includes("digest"), "view renders a digest header");
});

test("digest: after recorded attempts, shows recent activity", () => {
  const lm = require("../src/tools/academy/learnerModel");
  const ld = require("../src/tools/academy/learningDigest");
  const uid = "DA-" + Date.now();
  lm.recordAttempt(uid, { track: "html", level: "beginner", lessonId: "x", sectionType: "quiz", correct: true, skill: "html-basics" });
  lm.addXp(uid, 15, "Quiz");
  const d = ld.buildDigest(uid, { days: 7 });
  assert.ok(d.totalRecent >= 1, "records the recent attempt");
  assert.strictEqual(d.accuracy, 100, "one correct attempt = 100% accuracy");
  // cleanup
  const fs = require("fs"), path = require("path");
  for (const f of ["learnerModel.json"]) { try { fs.unlinkSync(path.join(__dirname, "../data", f)); } catch (_) {} }
});
