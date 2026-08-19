const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const minimax = require("../src/tools/minimax");

function withEnv(changes, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(changes)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("minimax: configuration uses the international default and never invents a key", () => {
  const config = minimax.getConfig({ MINIMAX_API_KEY: "", MINIMAX_BASE_URL: "", MINIMAX_MODEL: "" });
  assert.equal(configuredFor({ MINIMAX_API_KEY: "" }), false);
  assert.equal(config.baseUrl, "https://api.minimax.io/v1");
  assert.equal(config.model, "MiniMax-M3");
});

function configuredFor(env) {
  return minimax.configured(env);
}

test("minimax: OpenAI-compatible request sends bearer auth and extracts text", async () => {
  const originalPost = axios.post;
  let request;
  axios.post = async (url, body, options) => {
    request = { url, body, options };
    return {
      data: {
        model: "MiniMax-M3",
        choices: [{ finish_reason: "stop", message: { content: "MiniMax is connected." } }],
      },
    };
  };

  try {
    const result = await minimax.chat(
      [{ role: "user", content: "Say connected." }],
      { env: { MINIMAX_API_KEY: "unit-test-key", MINIMAX_BASE_URL: "https://example.test/v1", MINIMAX_MODEL: "MiniMax-M3" } }
    );
    assert.equal(result.text, "MiniMax is connected.");
    assert.equal(request.url, "https://example.test/v1/chat/completions");
    assert.equal(request.body.model, "MiniMax-M3");
    assert.equal(request.options.headers.Authorization, "Bearer unit-test-key");
    assert.equal(request.options.headers["Content-Type"], "application/json");
  } finally {
    axios.post = originalPost;
  }
});

test("minimax: configured provider is selected before fallback providers", async () => {
  const originalChat = minimax.chat;
  const originalApiKey = process.env.MINIMAX_API_KEY;
  const originalCerebras = process.env.CEREBRAS_API_KEY;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalGroq = process.env.GROQ_API_KEY;
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  let captured;

  try {
    process.env.MINIMAX_API_KEY = "unit-test-key";
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    minimax.chat = async (messages, options) => {
      captured = { messages, options };
      return { text: "MiniMax answered first.", finishReason: "stop" };
    };

    const aiPath = require.resolve("../src/tools/ai");
    delete require.cache[aiPath];
    const { getAIResponse } = require("../src/tools/ai");
    const result = await getAIResponse("hello", "tester", [], null, "", {});
    assert.equal(result, "MiniMax answered first.");
    assert.equal(captured.messages.at(-1).content, "hello");
    assert.equal(captured.options.maxTokens, 2048);
  } finally {
    minimax.chat = originalChat;
    if (originalApiKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = originalApiKey;
    if (originalCerebras === undefined) delete process.env.CEREBRAS_API_KEY;
    else process.env.CEREBRAS_API_KEY = originalCerebras;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGemini;
    if (originalGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroq;
    if (originalOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouter;
  }
});
