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
});

test("legacy prefix commands remain resolvable during migration", () => {
  const action = router.resolveNaturalAction("!help");
  assert.equal(action, null);
  assert.equal(router.detectIntent("what can you do"), "help");
});
