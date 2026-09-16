const test = require("node:test");
const assert = require("node:assert/strict");

const codingProvider = require("../src/tools/codingProvider");

function preserveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}
function restoreEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("coding provider prefers the official Gemini 3.5 Flash-Lite model", () => {
  assert.equal(codingProvider._test.GEMINI_PROVIDER, "gemini");
  assert.equal(codingProvider._test.GEMINI_MODEL, "gemini-3.5-flash-lite");
  assert.match(codingProvider._test.GEMINI_ENDPOINT, /generativelanguage\.googleapis\.com/);
});

test("coding provider recognizes a Gemini key and reports it as the selected provider", () => {
  const previous = preserveEnv(["GEMINI_API_KEY", "OPENROUTER_API_KEY"]);
  process.env.GEMINI_API_KEY = "AIzaSyabcdefghijklmnopqrstuvwxyz";
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.equal(codingProvider.configured(), true);
    assert.equal(codingProvider._test.geminiCredentialLooksUsable(), true);
    assert.equal(codingProvider.providerStatus().provider, "gemini");
    assert.equal(codingProvider.providerStatus().model, "gemini-3.5-flash-lite");
  } finally {
    restoreEnv(previous);
  }
});

test("coding provider recognizes an OpenRouter alias when Gemini is absent", () => {
  const previous = preserveEnv(["GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_KEY"]);
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_KEY = "sk-or-v1-abcdefghijklmnopqrstuvwxyz";
  try {
    assert.equal(codingProvider.configured(), true);
    assert.equal(codingProvider._test.openRouterCredentialLooksUsable(), true);
    assert.equal(codingProvider.providerStatus().keySource, "OPENROUTER_KEY");
    assert.equal(codingProvider.providerStatus().provider, "openrouter");
  } finally {
    restoreEnv(previous);
  }
});

test("coding provider rejects a present but malformed OpenRouter credential", async () => {
  const previous = preserveEnv(["GEMINI_API_KEY", "OPENROUTER_API_KEY"]);
  delete process.env.GEMINI_API_KEY;
  process.env.OPENROUTER_API_KEY = "User not found.";
  try {
    await assert.rejects(
      codingProvider.generateCodingText("return a complete file", { system: "code only" }),
      (error) => error.code === "CODING_PROVIDER_INVALID_KEY" && /valid OpenRouter key|sk-or-v1-/.test(error.message)
    );
  } finally {
    restoreEnv(previous);
  }
});

test("coding provider normalizes Gemini authentication errors", () => {
  const error = codingProvider._test.normalizeProviderFailure(
    { response: { status: 403, data: { error: { message: "Permission denied" } } } },
    "gemini",
    "gemini-3.5-flash-lite",
  );
  assert.equal(error.code, "CODING_PROVIDER_AUTH_FAILED");
  assert.match(error.message, /GEMINI_API_KEY/);
});

test("coding provider fails clearly when both coding credentials are missing", async () => {
  const previous = preserveEnv(["GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_KEY", "OPEN_ROUTER_API_KEY"]);
  for (const name of Object.keys(previous)) delete process.env[name];
  try {
    await assert.rejects(
      codingProvider.generateCodingText("return a complete file", { system: "code only" }),
      (error) => error.code === "CODING_PROVIDER_NOT_CONFIGURED" && /GEMINI_API_KEY.*OPENROUTER_API_KEY/.test(error.message)
    );
  } finally {
    restoreEnv(previous);
  }
});
