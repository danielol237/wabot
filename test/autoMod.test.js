// Auto-mod scam/link scanner tests.
const test = require("node:test");
const assert = require("node:assert");
const { scanLink } = require("../src/tools/autoMod");

test("autoMod scanLink: flags promo/claim scam bait", () => {
  const r = scanLink("CONGRATS you won a gift card! claim here http://bit.ly/xyz");
  assert.ok(r && /scam|won/i.test(r.reason), "flags won/gift-card bait, got: " + JSON.stringify(r));
});

test("autoMod scanLink: flags URL shorteners", () => {
  const r = scanLink("check this out https://t.co/abc123");
  assert.ok(r && /shorten/i.test(r.reason), "flags t.co shortener, got: " + JSON.stringify(r));
});

test("autoMod scanLink: flags suspicious TLD or scam bait", () => {
  const r = scanLink("free robux at http://free-robux.top/claim");
  // May hit either the scam-bait rule or the TLD rule — both should flag it.
  assert.ok(r, "flags suspicious link, got: " + JSON.stringify(r));
});

test("autoMod scanLink: passes normal legit links", () => {
  const r = scanLink("docs are at https://github.com/user/repo");
  assert.strictEqual(r, null, "normal github link not flagged");
});
