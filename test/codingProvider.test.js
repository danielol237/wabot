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

test("coding provider configured endpoints and models", () => {
  assert.equal(codingProvider._test.GEMINI_PROVIDER, "gemini");
  assert.match(codingProvider._test.GEMINI_ENDPOINT, /generativelanguage\.googleapis\.com/);
  assert.equal(codingProvider._test.MISTRAL_PROVIDER, "mistral");
  assert.match(codingProvider._test.MISTRAL_ENDPOINT, /mistral\.ai/);
});

test("coding provider recognizes a Gemini key and reports it as the selected provider", () => {
  const previous = preserveEnv(["GEMINI_API_KEY", "MISTRAL_API_KEY", "AGNES_API_KEY"]);
  process.env.GEMINI_API_KEY = "AIzaSyabcdefghijklmnopqrstuvwxyz";
  delete process.env.MISTRAL_API_KEY;
  delete process.env.AGNES_API_KEY;
  try {
    assert.equal(codingProvider.configured(), true);
    assert.equal(codingProvider._test.credentialLooksUsable("gemini"), true);
    assert.equal(codingProvider.providerStatus().provider, "gemini");
  } finally {
    restoreEnv(previous);
  }
});

test("coding provider recognizes Mistral when Gemini is absent", () => {
  const previous = preserveEnv(["GEMINI_API_KEY", "MISTRAL_API_KEY", "AGNES_API_KEY"]);
  delete process.env.GEMINI_API_KEY;
  delete process.env.AGNES_API_KEY;
  process.env.MISTRAL_API_KEY = "mistral-key-123456789";
  try {
    assert.equal(codingProvider.configured(), true);
    assert.equal(codingProvider._test.credentialLooksUsable("mistral"), true);
    assert.equal(codingProvider.providerStatus().provider, "mistral");
  } finally {
    restoreEnv(previous);
  }
});

test("coding provider rejects a present but too short credential", async () => {
  const previous = preserveEnv(["GEMINI_API_KEY", "MISTRAL_API_KEY", "AGNES_API_KEY"]);
  delete process.env.GEMINI_API_KEY;
  delete process.env.AGNES_API_KEY;
  process.env.MISTRAL_API_KEY = "short";
  try {
    await assert.rejects(
      codingProvider.generateCodingText("return a complete file", { system: "code only" }),
      (error) => error.code === "CODING_PROVIDER_INVALID_KEY" && /too short/.test(error.message)
    );
  } finally {
    restoreEnv(previous);
  }
});

test("coding provider normalizes Gemini authentication errors", () => {
  const error = codingProvider._test.normalizeProviderFailure(
    { response: { status: 403, data: { error: { message: "Permission denied" } } } },
    "gemini",
    "gemini-2.0-flash",
  );
  assert.equal(error.code, "CODING_PROVIDER_AUTH_FAILED");
  assert.match(error.message, /GEMINI_API_KEY/);
});

test("coding provider fails clearly when coding credentials are missing", async () => {
  const previous = preserveEnv(["GEMINI_API_KEY", "MISTRAL_API_KEY", "AGNES_API_KEY"]);
  for (const name of Object.keys(previous)) delete process.env[name];
  try {
    await assert.rejects(
      codingProvider.generateCodingText("return a complete file", { system: "code only" }),
      (error) => error.code === "CODING_PROVIDER_NOT_CONFIGURED" && /GEMINI_API_KEY/.test(error.message)
    );
  } finally {
    restoreEnv(previous);
  }
});
