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

test("business mode: natural trigger resolves to a non-owner-only command", () => {
  const start = router.resolveNaturalAction("ARIA business mode");
  const stop = router.resolveNaturalAction("ARIA business mode off");
  assert.equal(start?.command?.name, "businessmode");
  assert.equal(start?.command?.ownerOnly, false);
  assert.equal(start?.args, "start");
  assert.equal(stop?.command?.name, "businessmode");
  assert.equal(stop?.args, "off");
});

test("business mode: non-owner-safe fallback never promises automatic sending", () => {
  const profile = businessMode._test.parseBrief("Business name: AutoParts Hub\nSelling: car spare parts\nLocation: Douala");
  const draft = businessMode.fallbackReply(profile, "I need brake pads");
  assert.match(draft, /AutoParts Hub|confirm/i);
  assert.doesNotMatch(draft, /sent automatically|message sent/);
});

test("business mode: reports completion and identifies customer intent safely", () => {
  const profile = businessMode._test.parseBrief("Business name: AutoParts Hub\nSelling: car spare parts\nContact: WhatsApp\nLocation: Douala");
  const completion = businessMode.completion({ ...profile, fields: { ...profile.fields, contact: "WhatsApp" } });
  assert.equal(completion.percent, 100);
  assert.equal(businessMode.classifyCustomerMessage("Do you have brake pads and how much are they?").intent, "pricing");
  assert.deepEqual(businessMode.missingInfo(profile, { intent: "pricing" }), ["current pricing or quote rules"]);
});

test("business mode: exposes modern controls and bounded styles", () => {
  assert.match(businessMode.helpText(), /status|style|language|copy-only/i);
  assert.equal(typeof businessMode._test.normalizeFieldKey, "function");
});
