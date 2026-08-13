const test = require("node:test");
const assert = require("node:assert");

// Regression test for audit #16: autonomous mode's "has it been a while since we
// interacted" gate must reflect REAL inbound activity. noteInteraction() is
// called on every message from a tracked user and must update lastCheck.
test("autonomous: noteInteraction records real activity (audit #16)", () => {
  const { noteInteraction, getLastInteraction } = require("../src/tools/autonomous");
  const jid = "test-owner-1@lid";
  const t0 = Date.now();
  noteInteraction(jid);
  const last = getLastInteraction(jid);
  assert.ok(last, "interaction is recorded");
  assert.ok(last >= t0, "lastCheck is at/after the note time");

  // Empty/no-op input must not crash and must not clear the record.
  noteInteraction(null);
  noteInteraction("");
  assert.ok(getLastInteraction(jid), "empty input doesn't wipe the record");
});

test("autonomous: unknown user has no recorded interaction (audit #16)", () => {
  const { getLastInteraction } = require("../src/tools/autonomous");
  assert.strictEqual(getLastInteraction("never-interacted-999@lid"), null, "never-seen user returns null");
});
