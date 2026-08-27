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

function credentialLooksUsable() {
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();
  return /^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(key);
}

function normalizeProviderFailure(error) {
  const status = error?.response?.status;
  const detail = String(error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || "request failed").trim();
  if (status === 401 || /user not found|invalid api key|invalid authentication|unauthorized|authentication failed/i.test(detail)) {
    return codingProviderError("OpenRouter rejected the coding credential. Set a valid OPENROUTER_API_KEY (an OpenRouter key normally starts with sk-or-v1-) in Render, then redeploy ARIA.", "CODING_PROVIDER_AUTH_FAILED");
  }
  if (status === 404 || /model.*(?:not found|does not exist)|unknown model/i.test(detail)) {
    return codingProviderError(`OpenRouter could not access the configured coding model ${CODING_MODEL}. Check the account/model route and retry.`, "CODING_PROVIDER_MODEL_UNAVAILABLE");
  }
  return codingProviderError(`The dedicated coding provider failed: ${detail.slice(0, 500)}`, "CODING_PROVIDER_REQUEST_FAILED");
}

async function generateCodingText(prompt, options = {}) {
  if (!configured()) {
    throw codingProviderError(
      "The dedicated coding provider is not configured. Set OPENROUTER_API_KEY in the bot runtime, then retry the build.",
      "CODING_PROVIDER_NOT_CONFIGURED"
    );
  }
  if (!credentialLooksUsable()) {
    throw codingProviderError(
      "OPENROUTER_API_KEY is present but does not look like a valid OpenRouter key. Replace it with a real key beginning with sk-or-v1- and redeploy the bot.",
      "CODING_PROVIDER_INVALID_KEY"
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
    throw normalizeProviderFailure(error);
  }
}

module.exports = {
  configured,
  providerStatus,
  generateCodingText,
  _test: { CODING_PROVIDER, CODING_MODEL, CODING_ENDPOINT, codingProviderError, credentialLooksUsable, normalizeProviderFailure },
};
