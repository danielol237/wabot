const axios = require("axios");

const CODING_PROVIDER = "openrouter";
const CODING_MODEL = "anthropic/claude-opus-4.7";
const CODING_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 120000;

function configured() {
  return Boolean(String(process.env.OPENROUTER_API_KEY || "").trim());
}

function providerStatus() {
  return {
    configured: configured(),
    provider: CODING_PROVIDER,
    model: CODING_MODEL,
  };
}

function codingProviderError(message, code = "CODING_PROVIDER_ERROR") {
  const error = new Error(message);
  error.code = code;
  error.provider = CODING_PROVIDER;
  error.model = CODING_MODEL;
  return error;
}

async function generateCodingText(prompt, options = {}) {
  if (!configured()) {
    throw codingProviderError(
      "The dedicated coding provider is not configured. Set OPENROUTER_API_KEY in the bot runtime, then retry the build.",
      "CODING_PROVIDER_NOT_CONFIGURED"
    );
  }

  const history = Array.isArray(options.history)
    ? options.history.filter((item) => item && typeof item.content === "string").slice(-8)
    : [];
  const messages = [
    ...(options.system ? [{ role: "system", content: String(options.system) }] : []),
    ...history.map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content,
    })),
    { role: "user", content: String(prompt || "") },
  ];

  try {
    const response = await axios.post(
      CODING_ENDPOINT,
      {
        model: CODING_MODEL,
        messages,
        max_tokens: Math.min(Math.max(Number(options.maxTokens) || 12000, 256), 120000),
        temperature: typeof options.temperature === "number" ? options.temperature : 0.2,
        // Keep coding calls on the selected OpenRouter model route. Other ARIA
        // providers are intentionally not consulted by this adapter.
        provider: { allow_fallbacks: true },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://aria.local",
          "X-Title": "ARIA Coding Builder",
        },
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw codingProviderError("The coding provider returned an empty response.", "CODING_PROVIDER_EMPTY_RESPONSE");
    }
    return content.trim();
  } catch (error) {
    if (error?.provider === CODING_PROVIDER) throw error;
    const providerMessage = error.response?.data?.error?.message || error.message || "request failed";
    throw codingProviderError(
      `The dedicated coding provider failed: ${String(providerMessage).slice(0, 500)}`,
      "CODING_PROVIDER_REQUEST_FAILED"
    );
  }
}

module.exports = {
  configured,
  providerStatus,
  generateCodingText,
  _test: { CODING_PROVIDER, CODING_MODEL, CODING_ENDPOINT, codingProviderError },
};
