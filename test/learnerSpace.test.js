// Learner Space engine tests — ARIA's per-learner personal profile.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

function cleanup() {
  for (const f of ["learnerModel.json", "academyState.json"]) {
    try { fs.unlinkSync(path.join(__dirname, "../data", f)); } catch (_) {}
  }
}

test("learnerSpace: builds a complete profile for a new learner", () => {
  const ls = require("../src/tools/academy/learnerSpace");
  const s = ls.buildLearnerSpace("LS-NEW-" + Date.now());
  assert.ok(s.identity && typeof s.identity.xp === "number");
  assert.ok(Array.isArray(s.insights) && s.insights.length >= 1);
  assert.ok(s.pace && s.pace.label);
  assert.ok(s.next && s.next.text);
  cleanup();
});

test("learnerSpace: generates strengths + weak-spot insights from attempts", () => {
  const lm = require("../src/tools/academy/learnerModel");
  const ls = require("../src/tools/academy/learnerSpace");
  const uid = "LS-AT-" + Date.now();
  lm.updateProfile(uid, { name: "Test", nickname: "T" });
  lm.recordAttempt(uid, { track: "python", level: "beginner", lessonId: "x", sectionType: "quiz", correct: true, skill: "python-basics" });
  lm.recordAttempt(uid, { track: "python", level: "beginner", lessonId: "x", sectionType: "quiz", correct: true, skill: "python-basics" });
  lm.recordAttempt(uid, { track: "python", level: "beginner", lessonId: "x", sectionType: "quiz", correct: false, skill: "functions" });
  lm.recordAttempt(uid, { track: "python", level: "beginner", lessonId: "x", sectionType: "quiz", correct: false, skill: "functions" });
  const s = ls.buildLearnerSpace(uid);
  assert.ok(s.skills.strong.some((x) => x.skill === "python-basics"), "identifies strong skill");
  assert.ok(s.skills.focus.some((x) => x.skill === "functions"), "identifies weak skill");
  assert.ok(s.insights.some((i) => i.tag === "strength"), "has a strength insight");
  assert.ok(s.insights.some((i) => i.tag === "focus"), "has a focus insight");
  cleanup();
});

test("learnerSpace: updateProfile + addAriaNote persist personalization", () => {
  const lm = require("../src/tools/academy/learnerModel");
  const uid = "LS-PROF-" + Date.now();
  lm.updateProfile(uid, { name: "Alex", goals: ["Learn JS"], style: "visual" });
  lm.addAriaNote(uid, "Alex struggled with closures");
  const p = lm.getProfile(uid);
  assert.strictEqual(p.name, "Alex");
  assert.deepStrictEqual(p.goals, ["Learn JS"]);
  assert.ok(Array.isArray(p.ariaNotes) && p.ariaNotes.length === 1);
  cleanup();
});

test("learnerSpace: recordAttempt auto-generates ARIA notes", () => {
  const lm = require("../src/tools/academy/learnerModel");
  const ls = require("../src/tools/academy/learnerSpace");
  const uid = "LS-AUTONOTE-" + Date.now();
  lm.recordAttempt(uid, { track: "js", level: "beginner", lessonId: "x", sectionType: "quiz", correct: false, skill: "closures" });
  lm.recordAttempt(uid, { track: "js", level: "beginner", lessonId: "x", sectionType: "quiz", correct: false, skill: "closures" });
  const s = ls.buildLearnerSpace(uid);
  assert.ok(s.ariaNotes.some((n) => n.tag === "first"), "records first-step note");
  assert.ok(s.ariaNotes.some((n) => n.tag === "focus"), "records weak-skill note");
  const view = ls.learnerSpaceView(s);
  assert.ok(view.includes("Learner Space"), "!learner view renders");
  assert.ok(view.includes("closures"), "view mentions the weak skill");
  cleanup();
});
