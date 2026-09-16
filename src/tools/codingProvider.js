const axios = require("axios");
const providerConfig = require("../utils/providerConfig");

const GEMINI_PROVIDER = "gemini";
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_PROVIDER = "openrouter";
const OPENROUTER_MODEL = "anthropic/claude-opus-4.7";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 120000;

function codingProviderError(message, code = "CODING_PROVIDER_ERROR", provider = null, model = null) {
  const error = new Error(message);
  error.code = code;
  error.provider = provider;
  error.model = model;
  return error;
}

function resolvedCredential(provider) {
  return providerConfig.resolve(provider);
}

function configured() {
  return resolvedCredential("gemini").configured || resolvedCredential("openrouter").configured;
}

function providerStatus() {
  const gemini = resolvedCredential("gemini");
  const openrouter = resolvedCredential("openrouter");
  const selected = gemini.configured ? gemini : openrouter;
  return {
    configured: configured(),
    provider: selected.configured ? selected.id : "coding",
    model: selected.id === GEMINI_PROVIDER ? GEMINI_MODEL : OPENROUTER_MODEL,
    keyName: selected.key,
    keySource: selected.source,
    keyShape: selected.configured ? (selected.value.length >= 12 ? "present" : "short") : "missing",
    aliasesChecked: [...new Set([...gemini.aliases, ...openrouter.aliases])],
    providers: {
      gemini: { configured: gemini.configured, source: gemini.source, model: GEMINI_MODEL },
      openrouter: { configured: openrouter.configured, source: openrouter.source, model: OPENROUTER_MODEL },
    },
  };
}

function geminiCredentialLooksUsable() {
  return resolvedCredential("gemini").value.length >= 12;
}

function openRouterCredentialLooksUsable() {
  return /^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(resolvedCredential("openrouter").value);
}

function normalizeProviderFailure(error, provider, model) {
  const status = error?.response?.status;
  const detail = String(error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || "request failed").trim();
  const label = provider === GEMINI_PROVIDER ? "Gemini" : "OpenRouter";
  if (status === 401 || status === 403 || /user not found|invalid api key|invalid authentication|unauthorized|authentication failed|permission denied|api key/i.test(detail)) {
    return codingProviderError(`${label} rejected the coding credential. Check ${provider === GEMINI_PROVIDER ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"} in Render, then redeploy ARIA.`, "CODING_PROVIDER_AUTH_FAILED", provider, model);
  }
  if (status === 404 || /model.*(?:not found|does not exist)|unknown model/i.test(detail)) {
    return codingProviderError(`${label} could not access the configured coding model ${model}. Check model availability and retry.`, "CODING_PROVIDER_MODEL_UNAVAILABLE", provider, model);
  }
  return codingProviderError(`${label} coding request failed: ${detail.slice(0, 500)}`, "CODING_PROVIDER_REQUEST_FAILED", provider, model);
}

function geminiContents(messages) {
  return messages
    .filter((item) => item && typeof item.content === "string")
    .map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    }));
}

async function generateWithGemini(messages, maxTokens, temperature) {
  const credential = resolvedCredential("gemini");
  if (!credential.configured) throw codingProviderError("Gemini coding credential is not configured.", "CODING_PROVIDER_NOT_CONFIGURED", GEMINI_PROVIDER, GEMINI_MODEL);
  if (!geminiCredentialLooksUsable()) throw codingProviderError("GEMINI_API_KEY is present but too short to be usable.", "CODING_PROVIDER_INVALID_KEY", GEMINI_PROVIDER, GEMINI_MODEL);

  try {
    const system = messages.find((item) => item.role === "system")?.content;
    const response = await axios.post(
      `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`,
      {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: geminiContents(messages.filter((item) => item.role !== "system")),
        generationConfig: {
          maxOutputTokens: Math.min(Math.max(Number(maxTokens) || 12000, 256), 65536),
          temperature: typeof temperature === "number" ? temperature : 0.2,
        },
      },
      { params: { key: credential.value }, timeout: REQUEST_TIMEOUT_MS, headers: { "Content-Type": "application/json" } },
    );
    const content = response.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!content) throw codingProviderError("Gemini returned an empty coding response.", "CODING_PROVIDER_EMPTY_RESPONSE", GEMINI_PROVIDER, GEMINI_MODEL);
    return content;
  } catch (error) {
    if (error?.provider === GEMINI_PROVIDER) throw error;
    throw normalizeProviderFailure(error, GEMINI_PROVIDER, GEMINI_MODEL);
  }
}

async function generateWithOpenRouter(messages, maxTokens, temperature) {
  const credential = resolvedCredential("openrouter");
  if (!credential.configured) throw codingProviderError("OpenRouter coding credential is not configured.", "CODING_PROVIDER_NOT_CONFIGURED", OPENROUTER_PROVIDER, OPENROUTER_MODEL);
  if (!openRouterCredentialLooksUsable()) throw codingProviderError("OPENROUTER_API_KEY is present but does not look like a valid OpenRouter key.", "CODING_PROVIDER_INVALID_KEY", OPENROUTER_PROVIDER, OPENROUTER_MODEL);

  try {
    const response = await axios.post(
      OPENROUTER_ENDPOINT,
      {
        model: OPENROUTER_MODEL,
        messages,
        max_tokens: Math.min(Math.max(Number(maxTokens) || 12000, 256), 120000),
        temperature: typeof temperature === "number" ? temperature : 0.2,
        provider: { allow_fallbacks: true },
      },
      {
        headers: {
          Authorization: `Bearer ${credential.value}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://aria.local",
          "X-Title": "ARIA Coding Builder",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw codingProviderError("OpenRouter returned an empty coding response.", "CODING_PROVIDER_EMPTY_RESPONSE", OPENROUTER_PROVIDER, OPENROUTER_MODEL);
    return content.trim();
  } catch (error) {
    if (error?.provider === OPENROUTER_PROVIDER) throw error;
    throw normalizeProviderFailure(error, OPENROUTER_PROVIDER, OPENROUTER_MODEL);
  }
}

async function generateCodingText(prompt, options = {}) {
  const history = Array.isArray(options.history)
    ? options.history.filter((item) => item && typeof item.content === "string").slice(-8)
    : [];
  const messages = [
    ...(options.system ? [{ role: "system", content: String(options.system) }] : []),
    ...history.map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: item.content })),
    { role: "user", content: String(prompt || "") },
  ];
  const maxTokens = options.maxTokens;
  const temperature = options.temperature;
  const gemini = resolvedCredential("gemini");
  const openrouter = resolvedCredential("openrouter");

  if (!gemini.configured && !openrouter.configured) {
    throw codingProviderError("No coding provider is configured. Set GEMINI_API_KEY (recommended) or OPENROUTER_API_KEY in the bot runtime, then restart ARIA.", "CODING_PROVIDER_NOT_CONFIGURED", "coding", null);
  }

  let firstError = null;
  if (gemini.configured) {
    try {
      return await generateWithGemini(messages, maxTokens, temperature);
    } catch (error) {
      firstError = error;
    }
  }
  if (openrouter.configured) {
    try {
      return await generateWithOpenRouter(messages, maxTokens, temperature);
    } catch (error) {
      if (firstError) {
        error.message = `${error.message} Gemini fallback also failed: ${firstError.message}`;
      }
      throw error;
    }
  }
  throw firstError || codingProviderError("No usable coding provider is configured.", "CODING_PROVIDER_NOT_CONFIGURED", "coding", null);
}

module.exports = {
  configured,
  providerStatus,
  generateCodingText,
  _test: {
    GEMINI_PROVIDER,
    GEMINI_MODEL,
    GEMINI_ENDPOINT,
    OPENROUTER_PROVIDER,
    OPENROUTER_MODEL,
    OPENROUTER_ENDPOINT,
    codingProviderError,
    geminiCredentialLooksUsable,
    openRouterCredentialLooksUsable,
    normalizeProviderFailure,
    resolvedCredential,
  },
};
