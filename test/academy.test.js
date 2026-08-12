// Academy integration tests — curriculum, evidence, mastery, recall,
// adaptive tutor, prerequisite gating, hidden tests, projects, incidents,
// company simulation, and XP. Runs with Node's built-in test runner.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "../../data");
// Cleanup helper — remove academy state files after each test file.
function cleanup(...files) {
  for (const f of files) {
    try { fs.unlinkSync(path.join(DATA, f)); } catch (_) {}
  }
}

test("curriculum: loads tracks + lessons + challenges", () => {
  const ce = require("../src/tools/academy/curriculumEngine");
  const overviews = ce.allTrackOverviews();
  assert.ok(overviews.length >= 15, `expected >=15 tracks, got ${overviews.length}`);
  // Every track overview has lessons.
  for (const t of overviews) {
    assert.ok(t.totalLessons >= 1, `${t.id} has no lessons`);
  }
  // Level defs exist.
  assert.ok(Object.keys(ce.LEVEL_DEFS).includes("beginner"));
});

test("evidence: no evidence = 0% mastery", () => {
  const lm = require("../src/tools/academy/learnerModel");
  const ee = require("../src/tools/academy/evidenceEngine");
  const uid = "EV-NONE-" + Date.now();
  assert.strictEqual(ee.computeEvidenceMastery(uid, "backend", "intermediate").percent, 0);
  cleanup("learnerModel.json");
});

test("evidence: mastery grows with real assessments (weighted + breadth)", () => {
  const { recordEvidence } = require("../src/tools/academy/learnerModel");
  const ee = require("../src/tools/academy/evidenceEngine");
  const uid = "EV-" + Date.now();
  // One perfect quiz should NOT be 100% (breadth-capped).
  recordEvidence(uid, { track: "b", level: "i", type: "quiz", correct: true, score: 100, skill: "x" });
  const low = ee.computeEvidenceMastery(uid, "b", "i").percent;
  assert.ok(low < 100, `one perfect quiz gave ${low}% (should be breadth-capped)`);
  // Solid breadth + a project → high mastery.
  for (let i = 0; i < 3; i++) recordEvidence(uid, { track: "b", level: "i", type: "quiz", correct: true, score: 100, skill: "x" });
  for (let i = 0; i < 2; i++) recordEvidence(uid, { track: "b", level: "i", type: "challenge", correct: true, score: 100, skill: "x" });
  recordEvidence(uid, { track: "b", level: "i", type: "project", correct: true, score: 90, skill: "x" });
  const high = ee.computeEvidenceMastery(uid, "b", "i").percent;
  assert.ok(high >= 60, `expected strong evidence ~>=60%, got ${high}%`);
  cleanup("learnerModel.json");
});

test("recall: known-but-decayed is 'due', never-mastered is not", () => {
  const { recordAttempt, learner } = require("../src/tools/academy/learnerModel");
  const fe = require("../src/tools/academy/forgettingEngine");
  const uid = "RC-" + Date.now();
  // Rusty: genuinely known (100%) then aged.
  for (let i = 0; i < 3; i++) recordAttempt(uid, { track: "x", level: "x", lessonId: "x", sectionType: "quiz", correct: true, skill: "rusty-skill" });
  // Never mastered (failed).
  recordAttempt(uid, { track: "x", level: "x", lessonId: "x", sectionType: "quiz", correct: false, skill: "weak-skill" });
  // Age the rusty skill 40 days via live reference.
  const l = learner(uid);
  l.attempts.forEach((a) => { if (a.skill === "rusty-skill") a.ts = Date.now() - 40 * 86400000; });
  const mem = fe.skillMemory(uid);
  const rusty = mem.find((m) => m.skill === "rusty-skill");
  const weak = mem.find((m) => m.skill === "weak-skill");
  assert.strictEqual(rusty.due, true, "known-but-decayed should be due for recall");
  assert.strictEqual(weak.due, false, "never-mastered should NOT be due (it's weak, not rusty)");
  cleanup("learnerModel.json");
});

test("adaptive tutor: recall fires before weak-skill drill", () => {
  const { recordAttempt, learner } = require("../src/tools/academy/learnerModel");
  const { recommend } = require("../src/tools/academy/adaptiveTutor");
  const uid = "AD-" + Date.now();
  recordAttempt(uid, { track: "x", level: "x", lessonId: "x", sectionType: "quiz", correct: false, skill: "weak-skill" });
  for (let i = 0; i < 3; i++) recordAttempt(uid, { track: "x", level: "x", lessonId: "x", sectionType: "quiz", correct: true, skill: "rusty-skill" });
  const l = learner(uid);
  l.attempts.forEach((a) => { if (a.skill === "rusty-skill") a.ts = Date.now() - 40 * 86400000; });
  const r = recommend(uid);
  assert.strictEqual(r.type, "recall", `expected recall to win, got ${r.type}`);
  assert.ok(r.action, "recommendation should carry a concrete action");
  cleanup("learnerModel.json");
});

test("adaptive tutor: prerequisite diagnosis finds the real gap", () => {
  const { recordAttempt } = require("../src/tools/academy/learnerModel");
  const { recommend } = require("../src/tools/academy/adaptiveTutor");
  const uid = "PR-" + Date.now();
  // Strong functions/callbacks, weak on promises (the prerequisite of async-await).
  for (const s of ["functions", "callbacks"]) recordAttempt(uid, { track: "x", level: "x", lessonId: "x", sectionType: "quiz", correct: true, skill: s });
  recordAttempt(uid, { track: "x", level: "x", lessonId: "x", sectionType: "quiz", correct: false, skill: "async-await" });
  const r = recommend(uid, { currentSkill: "async-await" });
  // Should either drill async-await or its prerequisite — both are valid, but
  // the key is it returns a drill/prerequisite with a skill, not 'start'.
  assert.ok(r.type === "drill" || r.type === "prerequisite", `unexpected type ${r.type}`);
  assert.ok(r.skill, "should have a target skill");
  cleanup("learnerModel.json");
});

test("assessment: hidden tests require passing all inputs", async () => {
  const { gradeChallenge } = require("../src/tools/academy/assessmentEngine");
  const uid = "HT-" + Date.now();
  const challenge = {
    lang: "js",
    tests: [
      { input: "3 4", expected: "7" },
      { input: "10 5", expected: "15" },
      { input: "-1 1", expected: "0" },
    ],
  };
  // Hardcoded single-output should fail when multiple hidden tests exist.
  // In CI Docker may be absent → result.blocked. The point: it must not pass
  // for the wrong reason, and the harness must not crash.
  const r = await gradeChallenge(uid, { track: "x", level: "i", lessonId: "x", skill: "x" }, 'console.log("5")', challenge);
  assert.ok(r.blocked || r.correct === false, "hardcoded output must not pass hidden tests (or be safely blocked)");
  cleanup("learnerModel.json");
});

test("prerequisite gating: advanced level blocked without evidence-mastered prior levels", async () => {
  const orch = require("../src/tools/academy/academyOrchestrator");
  const uid = "GATE-" + Date.now();
  orch.startFlow("ch", uid);
  const track = await orch.handleReply("ch", uid, "3"); // pick a track
  assert.ok(track.text.includes("Choose your level"), "should reach level menu");
  const adv = await orch.handleReply("ch", uid, "3"); // try advanced
  assert.ok(adv.text.includes("Prerequisite not met"), "advanced should be gated");
  cleanup("academyState.json", "learnerModel.json");
});

test("XP: no XP for merely entering a level (no menu farming)", async () => {
  const orch = require("../src/tools/academy/academyOrchestrator");
  const { getStats } = require("../src/tools/academy/learnerModel");
  const uid = "XP-" + Date.now();
  orch.startFlow("ch", uid);
  await orch.handleReply("ch", uid, "3");
  // beginner (level 1) should be allowed (no prior prerequisite) but grant no XP.
  await orch.handleReply("ch", uid, "1");
  assert.strictEqual(getStats(uid).xp, 0, "entering beginner should not grant XP");
  cleanup("academyState.json", "learnerModel.json");
});

test("project: 'done' alone does not pass; real submission grades against rubric", async () => {
  const pw = require("../src/tools/academy/projectWorkspace");
  const { getMastery } = require("../src/tools/academy/learnerModel");
  const uid = "PJ-" + Date.now();
  pw.startProject("ch", uid, "backend", "intermediate");
  const done = await pw.handleProjectReply("ch", uid, "done");
  assert.ok(done.score < 75, `'done' scored ${done.score} (should be needs-work)`);
  assert.ok(getMastery(uid, "backend", "intermediate") < 80, "mastery should not jump from 'done'");
  // Real submission → should grade higher (AI path or deterministic fallback).
  pw.startProject("ch", uid, "backend", "intermediate");
  const work = "Built REST API with Express. register/login uses bcrypt hashed passwords. Postgres with users schema. Protected /api/private with auth middleware checking JWT. 6 jest integration tests pass. Returns 200/401/400 status codes.";
  const sub = await pw.handleProjectReply("ch", uid, work);
  assert.ok(sub.score >= done.score, "real submission should score >= a bare 'done'");
  cleanup("academyProjects.json", "learnerModel.json");
});

test("incident: semantic grading resolves a correct diagnosis+fix", async () => {
  const inc = require("../src/tools/academy/incidentSimulator");
  const uid = "IN-" + Date.now();
  const start = inc.start("c", uid, "db-conn-pool");
  assert.ok(start.phase === "diagnosis");
  const d = await inc.handleReply("c", uid, "The search deploy runs SELECT * FROM orders with no index and opens a connection per request, exhausting the pool");
  assert.ok(d.phase === "fix", "diagnosis accepted, should ask for fix");
  const f = await inc.handleReply("c", uid, "add an index on orders, cap the query, reduce connection usage");
  assert.ok(f.graded === true, "incident should grade");
  assert.strictEqual(inc.hasActiveFlow("c"), false, "flow should close after grading");
  cleanup("incidentState.json", "learnerModel.json");
});

test("incident: anime resolver-race scenario loads with correct schema", async () => {
  const inc = require("../src/tools/academy/incidentSimulator");
  const i = inc.INCIDENTS.find((x) => x.id === "anime-resolver-race");
  assert.ok(i, "anime resolver-race incident present");
  assert.strictEqual(i.difficulty, "hard");
  assert.ok(Array.isArray(i.skills) && i.skills.includes("async-concurrency"));
  assert.ok(i.scenario.includes("sequence"));
  assert.ok(i.evidence.logs.length >= 4, "has evidence logs");
  assert.ok(Array.isArray(i.distractors) && i.distractors.length >= 3);
  // Root cause must reflect the architectural fix (validate + circuit breaker).
  assert.ok(/validat/i.test(i.rootCause), "root cause mentions validation");
  assert.ok(/circuit/i.test(i.correctFix), "correct fix mentions circuit breaker");
  // It should be selectable by name.
  const start = inc.start("c2", "INX-" + Date.now(), "anime-resolver-race");
  assert.ok(start.phase === "diagnosis");
  cleanup("incidentState.json", "learnerModel.json");
});

test("company: backlog weighted to learner strengths; full loop runs", () => {
  const { recordAttempt } = require("../src/tools/academy/learnerModel");
  const cs = require("../src/tools/academy/companySimulator");
  const uid = "CO-" + Date.now();
  // Backend-strong learner.
  for (const s of ["js-basics", "functions", "http", "node-http", "node-express", "node-db", "rest-apis", "json", "sql-basics", "sql-select"]) {
    recordAttempt(uid, { track: "x", level: "x", lessonId: "x", sectionType: "quiz", correct: true, skill: s });
  }
  const found = cs.foundCompany(uid, "TestCo");
  assert.ok(found.ok === true, "company should found");
  // Take first project and advance until it ships.
  const take = cs.takeProject(uid, 1);
  assert.ok(take.ok === true, "should take a project");
  let shipped = false;
  for (let i = 0; i < 12; i++) {
    const adv = cs.advance(uid);
    if (adv.text.includes("Shipped")) { shipped = true; break; }
  }
  assert.ok(shipped, "strong learner should ship within 12 weeks");
  cleanup("companyState.json", "learnerModel.json");
});

test("engineering DNA: backend profile → backend career fit", () => {
  const { recordAttempt } = require("../src/tools/academy/learnerModel");
  const dna = require("../src/tools/academy/engineeringDNA");
  const uid = "DNA-" + Date.now();
  for (const s of ["js-basics", "variables", "functions", "scope", "closures", "callbacks", "promises", "async-await", "http", "node-http", "node-express", "node-db", "rest-apis", "json", "sql-basics", "sql-select", "sql-joins", "sql-index"]) {
    recordAttempt(uid, { track: "x", level: "x", lessonId: "x", sectionType: "quiz", correct: true, skill: s });
  }
  const fit = dna.careerFit(uid);
  assert.strictEqual(fit.top.role, "Backend Engineer", `expected Backend Engineer, got ${fit.top.role}`);
  assert.ok(fit.top.fit >= 50, "backend fit should be substantial");
  cleanup("learnerModel.json");
});

test("XP system: level tiers + breakdown + leaderboard", () => {
  const { addXp, getAllLearners } = require("../src/tools/academy/learnerModel");
  const xp = require("../src/tools/academy/xpSystem");
  const uid = "XP2-" + Date.now();
  addXp(uid, 100, "Quiz");
  addXp(uid, 40, "Incident");
  const tier = xp.tierFor(140);
  assert.strictEqual(tier.level, 2, "140 XP should be level 2 (Apprentice)");
  const view = xp.xpView(uid);
  assert.ok(view.includes("Quiz"), "breakdown should show Quiz source");
  assert.ok(getAllLearners().length >= 1, "learner should appear in leaderboard pool");
  cleanup("learnerModel.json");
});
