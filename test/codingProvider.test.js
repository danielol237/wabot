const test = require("node:test");
const assert = require("node:assert/strict");

const codingProvider = require("../src/tools/codingProvider");

test("coding provider is locked to the selected high-quality model", () => {
  assert.equal(codingProvider._test.CODING_PROVIDER, "openrouter");
  assert.equal(codingProvider._test.CODING_MODEL, "anthropic/claude-opus-4.7");
  assert.match(codingProvider._test.CODING_ENDPOINT, /openrouter\.ai\/api\/v1\/chat\/completions$/);
});

test("coding provider fails explicitly when its credential is missing", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    await assert.rejects(
      codingProvider.generateCodingText("return a complete file", { system: "code only" }),
      (error) => error.code === "CODING_PROVIDER_NOT_CONFIGURED" && /OPENROUTER_API_KEY/.test(error.message)
    );
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});
