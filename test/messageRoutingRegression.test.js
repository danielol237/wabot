const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../src/utils/commandRouter");
const messageHandler = require("../src/handlers/messageHandler");

test("group routing requires a real mention or a reply to ARIA", () => {
  const { shouldReplyInGroup } = messageHandler._test;
  const silent = { isGroup: true, mentioned: false, isReplyToBot: false, hasNameTrigger: false, isCommand: false };
  assert.equal(shouldReplyInGroup(silent), false);
  assert.equal(shouldReplyInGroup({ ...silent, hasNameTrigger: true }), true);
  assert.equal(shouldReplyInGroup({ ...silent, isCommand: true }), true);
  assert.equal(shouldReplyInGroup({ ...silent, mentioned: true }), true);
  assert.equal(shouldReplyInGroup({ ...silent, isReplyToBot: true }), true);
  assert.equal(shouldReplyInGroup({ ...silent, isGroup: false }), true);
});

test("Business Mode phrase is recognized before ordinary persona fallback", () => {
  for (const phrase of ["ARIA business mode", "aria business mode!", "Hey ARIA, business mode", "yo aria: business mode off"]) {
    const result = router._test.resolveBusinessModePhrase(phrase);
    assert.ok(result, phrase);
  }
  assert.equal(router._test.resolveBusinessModePhrase("aria what is cooking"), null);
});

test("duplicate message claim rejects redelivery and rapid repeated text", () => {
  const first = messageHandler._test.claimInboundMessage("message-1", "group@g.us", "owner@s.whatsapp.net", "ARIA business mode");
  const redelivery = messageHandler._test.claimInboundMessage("message-1", "group@g.us", "owner@s.whatsapp.net", "ARIA business mode");
  const rapidRepeat = messageHandler._test.claimInboundMessage("message-2", "group@g.us", "owner@s.whatsapp.net", "aria business mode");
  assert.equal(first, true);
  assert.equal(redelivery, false);
  assert.equal(rapidRepeat, false);
});
