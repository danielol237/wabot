const test = require("node:test");
const assert = require("node:assert/strict");
const businessMode = require("../src/tools/businessMode");
const router = require("../src/utils/commandRouter");

test("business mode: parses labeled business information without losing the original brief", () => {
  const parsed = businessMode._test.parseBrief("Business name: Nala Cakes\nSelling: custom birthday cakes\nPrice: from 25,000 XAF\nLocation: Douala");
  assert.match(parsed.brief, /Nala Cakes/);
  assert.equal(parsed.fields.business_name, "Nala Cakes");
  assert.equal(parsed.fields.selling, "custom birthday cakes");
  assert.equal(parsed.fields.price, "from 25,000 XAF");
  assert.equal(parsed.fields.location, "Douala");
});

test("business mode: drafts a safe fallback instead of inventing a price", () => {
  const profile = businessMode._test.parseBrief("Business name: Nala Cakes\nSelling: custom birthday cakes\nLocation: Douala");
  const draft = businessMode.fallbackReply(profile, "How much is a cake?");
  assert.match(draft, /confirm|received/i);
  assert.doesNotMatch(draft, /25,000/);
});

test("business mode: natural trigger resolves to an owner-only command", () => {
  const start = router.resolveNaturalAction("ARIA business mode");
  const stop = router.resolveNaturalAction("ARIA business mode off");
  assert.equal(start?.command?.name, "businessmode");
  assert.equal(start?.command?.ownerOnly, true);
  assert.equal(start?.args, "start");
  assert.equal(stop?.command?.name, "businessmode");
  assert.equal(stop?.args, "off");
});
