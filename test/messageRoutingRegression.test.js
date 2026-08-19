const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../src/utils/commandRouter");
const messageHandler = require("../src/handlers/messageHandler");

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
