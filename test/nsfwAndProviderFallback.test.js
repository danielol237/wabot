const test = require("node:test");
const assert = require("node:assert/strict");

const nsfw = require("../plugins/nsfw");
const { _test: aiTest } = require("../src/tools/ai");

test("NSFW command inventory contains every registered category", () => {
  const inventory = nsfw._test.commandInventory();
  for (const category of nsfw._test.NSFW_TYPES) {
    assert.match(inventory, new RegExp(`!${category}(?:,|$)`));
  }
});

test("NSFW management authorization accepts owner/admin and rejects ordinary users", () => {
  const previousOwner = process.env.OWNER_NUMBER;
  process.env.OWNER_NUMBER = "237650284057";
  try {
    assert.equal(nsfw._test.canManageNSFW("237650284057@s.whatsapp.net"), true);
    assert.equal(nsfw._test.canManageNSFW("not-the-owner@s.whatsapp.net"), false);
  } finally {
    if (previousOwner === undefined) delete process.env.OWNER_NUMBER;
    else process.env.OWNER_NUMBER = previousOwner;
  }
});

test("provider rate-limit detection treats 429 and quota errors as provider-wide", () => {
  assert.equal(aiTest.isRateLimitedError({ response: { status: 429 } }), true);
  assert.equal(aiTest.isRateLimitedError(new Error("quota exceeded")), true);
  assert.equal(aiTest.isRateLimitedError(new Error("invalid model")), false);
});
