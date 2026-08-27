const test = require("node:test");
const assert = require("node:assert/strict");

const codingProvider = require("../src/tools/codingProvider");

test("coding provider is locked to the selected high-quality model", () => {
  assert.equal(codingProvider._test.CODING_PROVIDER, "openrouter");
  assert.equal(codingProvider._test.CODING_MODEL, "anthropic/claude-opus-4.7");
  assert.match(codingProvider._test.CODING_ENDPOINT, /openrouter\.ai\/api\/v1\/chat\/completions$/);
});

test("coding provider recognizes valid OpenRouter key shape", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdefghijklmnopqrstuvwxyz";
  try {
    assert.equal(codingProvider._test.credentialLooksUsable(), true);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("coding provider rejects a present but malformed credential before making a request", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "User not found.";
  try {
    await assert.rejects(
      codingProvider.generateCodingText("return a complete file", { system: "code only" }),
      (error) => error.code === "CODING_PROVIDER_INVALID_KEY" && /sk-or-v1-/.test(error.message)
    );
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("coding provider normalizes OpenRouter User not found into an actionable auth error", () => {
  const error = codingProvider._test.normalizeProviderFailure({
    response: { status: 401, data: { error: { message: "User not found." } } },
  });
  assert.equal(error.code, "CODING_PROVIDER_AUTH_FAILED");
  assert.match(error.message, /valid OPENROUTER_API_KEY/i);
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
