const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("../src/utils/commandRouter");

test("natural routing resolves owner build requests without a prefix", () => {
  const action = router.resolveNaturalAction("ARIA, build me a landing page for ARIA");
  assert.equal(action.intent, "build");
  assert.equal(action.args, "landing page for ARIA");
  assert.equal(action.command.ownerOnly, true);
});

test("natural routing resolves delegation and keeps the owner-only boundary", () => {
  const action = router.resolveNaturalAction("delegate this research to the agent team");
  assert.equal(action.intent, "delegate");
  assert.equal(action.args, "research to the agent team");
  assert.equal(action.command.ownerOnly, true);
});

test("natural routing resolves owner file edits without a prefix", () => {
  const action = router.resolveNaturalAction("ARIA edit src/index.js to add a health route");
  assert.equal(action.intent, "edit");
  assert.equal(action.args, "src/index.js to add a health route");
  assert.equal(action.command.ownerOnly, true);
});

test("natural routing resolves capability discovery, memory recall, and website links", () => {
  assert.equal(router.resolveNaturalAction("what can you do").intent, "help");
  assert.equal(router.resolveNaturalAction("what do you remember about me").intent, "memories");
  assert.equal(router.resolveNaturalAction("give me link to dashboard").intent, "links");
  assert.equal(router.resolveNaturalAction("open the anime website").intent, "links");
  assert.equal(router.resolveNaturalAction("anime Naruto").intent, "anime");
  assert.equal(router.resolveNaturalAction("start a project backend beginner").intent, "project");
  assert.equal(router.resolveNaturalAction("start a mission audit the bot").intent, "mission");
  assert.equal(router.resolveNaturalAction("create a poll Best anime? | One Piece | Naruto").intent, "poll");
  assert.equal(router.resolveNaturalAction("ARIA, this is a project: launch the site by December").intent, "atlas");
  assert.equal(router.resolveNaturalAction("what is blocking us?").intent, "atlas");
  assert.equal(router.resolveNaturalAction("add a task: verify Android downloads").intent, "atlas");
  assert.equal(router.resolveNaturalAction("record a decision: keep QR pairing owner-only").intent, "atlas");
  assert.equal(router.resolveNaturalAction("plan this project").intent, "atlas");
  assert.equal(router.resolveNaturalAction("plan this").intent, "atlas");
  assert.equal(router.resolveNaturalAction("make a plan").intent, "atlas");
  assert.equal(router.resolveNaturalAction("break the project down").intent, "atlas");
  assert.equal(router.resolveNaturalAction("show the roadmap").intent, "atlas");
  assert.equal(router.resolveNaturalAction("apply the plan").intent, "atlas");
  assert.equal(router.resolveNaturalAction("show Sentinel").intent, "atlas");
  assert.equal(router.resolveNaturalAction("what changed in the project").intent, "atlas");
  assert.equal(router.resolveNaturalAction("acknowledge signal signal_test").intent, "atlas");
  assert.equal(router.resolveNaturalAction("approve brief brief_test").intent, "atlas");
});

test("legacy prefix commands remain resolvable during migration", () => {
  const action = router.resolveNaturalAction("!help");
  assert.equal(action, null);
  assert.equal(router.detectIntent("what can you do"), "help");
});

test("natural routing resolves an explicit addressed group removal request to the registered permission-checked command", () => {
  const action = router.resolveNaturalAction("ARIA, remove @234812345678");
  assert.equal(action.intent, "kick");
  assert.equal(action.command.name, "kick");
  assert.equal(action.command.category, "group");
});
