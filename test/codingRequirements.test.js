const test = require("node:test");
const assert = require("node:assert/strict");
const { inferProduct, contractPrompt } = require("../src/tools/codingRequirements");

test("requirement analysis infers a useful product contract from a normal brief", () => {
  const contract = inferProduct("Build me a website for my barber shop with prices, booking, WhatsApp contact, and location");
  assert.equal(contract.productType, "business website");
  assert.match(contract.audience, /my barber shop/i);
  assert.ok(contract.features.some((item) => /booking/i.test(item)));
  assert.ok(contract.features.some((item) => /WhatsApp/i.test(item)));
  assert.ok(contract.features.some((item) => /pricing|services/i.test(item)));
  assert.match(contractPrompt(contract), /business website/);
  assert.match(contractPrompt(contract), /responsive mobile layout/);
});

test("requirement analysis chooses sensible defaults instead of requiring design questions", () => {
  const contract = inferProduct("Create a portfolio website");
  assert.equal(contract.productType, "portfolio website");
  assert.ok(contract.defaults.length >= 3);
  assert.ok(contract.acceptanceCriteria.some((item) => /requested feature/i.test(item)));
});
