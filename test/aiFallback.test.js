const test = require("node:test");
const assert = require("node:assert/strict");

const ai = require("../src/tools/ai");

test("AI fallback rejects canned provider failures as usable answers", () => {
  assert.equal(ai._test.isUsableProviderText("❌ I couldn't reach ARIA's chat brain right now."), false);
  assert.equal(ai._test.isUsableProviderText("No response from Gemini."), false);
  assert.equal(ai._test.isUsableProviderText("I couldn't connect to the provider"), false);
  assert.equal(ai._test.isUsableProviderText("I hit a provider wall, but your request is fine."), true);
});

test("AI fallback failure replies do not repeat the same NPC sentence", () => {
  const replies = [
    ai._test.buildProviderFailureReply(),
    ai._test.buildProviderFailureReply(),
    ai._test.buildProviderFailureReply(),
  ];
  assert.equal(new Set(replies).size, 3);
});

test("large-output notice does not instruct users to continue", () => {
  assert.equal(/tell me to continue|reply continue|!continue/i.test(ai._test.TRUNCATION_NOTICE), false);
  assert.match(ai._test.TRUNCATION_NOTICE, /send it again/i);
});
