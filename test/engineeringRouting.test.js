const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveNaturalAction } = require("../src/utils/commandRouter");

test("natural engineering inspection routes to the public engineering command", () => {
  const action = resolveNaturalAction("ARIA, what modules do you have installed?");
  assert.equal(action.intent, "engineering");
  assert.equal(action.args, "status");
  assert.equal(action.command.ownerOnly, false);
});

test("natural engineering proposal routes without hijacking ordinary conversation", () => {
  const action = resolveNaturalAction("ARIA propose an upgrade to improve the build system");
  assert.equal(action.intent, "engineering");
  assert.match(action.args, /propose an upgrade/i);
  assert.equal(resolveNaturalAction("I want to improve my own coding skills"), null);
});

test("natural verification and merge phrases preserve the proposal id", () => {
  const verify = resolveNaturalAction("ARIA verify upgrade upgrade_test123");
  const merge = resolveNaturalAction("ARIA merge the upgrade upgrade_test123");
  assert.equal(verify.intent, "engineering");
  assert.equal(verify.args, "verify upgrade_test123");
  assert.equal(merge.intent, "engineering");
  assert.equal(merge.args, "merge upgrade_test123");
});
