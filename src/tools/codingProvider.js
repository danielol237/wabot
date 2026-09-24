const axios = require("axios");
const providerConfig = require("../utils/providerConfig");

const GEMINI_PROVIDER = "gemini";
function getGeminiModel() {
  return String(process.env.GEMINI_MODEL || "gemini-2.0-flash").trim();
}
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const MISTRAL_PROVIDER = "mistral";
function getMistralCodeModel() {
  return String(process.env.MISTRAL_CODE_MODEL || process.env.MISTRAL_MODEL || "codestral-latest").trim();
}
const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

const AGNES_PROVIDER = "agnes";
function getAgnesModel() {
  return String(process.env.AGNES_MODEL || "agnes-2.5-flash").trim();
}
function getAgnesEndpoint() {
  return String(process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "") + "/chat/completions";
}

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
  return resolvedCredential("gemini").configured || resolvedCredential("mistral").configured || resolvedCredential("agnes").configured;
}

function providerStatus() {
  const gemini = resolvedCredential("gemini");
  const mistral = resolvedCredential("mistral");
  const agnes = resolvedCredential("agnes");
  const selected = gemini.configured ? gemini : (mistral.configured ? mistral : agnes);
  let selectedModel = getGeminiModel();
  if (selected.id === MISTRAL_PROVIDER) selectedModel = getMistralCodeModel();
  else if (selected.id === AGNES_PROVIDER) selectedModel = getAgnesModel();

  return {
    configured: configured(),
    provider: selected.configured ? selected.id : "coding",
    model: selectedModel,
    keyName: selected.key,
    keySource: selected.source,
    keyShape: selected.configured ? (selected.value.length >= 12 ? "present" : "short") : "missing",
    aliasesChecked: [...new Set([...gemini.aliases, ...mistral.aliases, ...agnes.aliases])],
    providers: {
      gemini: { configured: gemini.configured, source: gemini.source, model: getGeminiModel() },
      mistral: { configured: mistral.configured, source: mistral.source, model: getMistralCodeModel() },
      agnes: { configured: agnes.configured, source: agnes.source, model: getAgnesModel() },
    },
  };
}

function credentialLooksUsable(provider) {
  return resolvedCredential(provider).value.length >= 8;
}

function normalizeProviderFailure(error, provider, model) {
  const status = error?.response?.status;
  const detail = String(error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || "request failed").trim();
  const label = provider === GEMINI_PROVIDER ? "Gemini" : (provider === MISTRAL_PROVIDER ? "Mistral" : "Agnes AI");
  const keyName = provider === GEMINI_PROVIDER ? "GEMINI_API_KEY" : (provider === MISTRAL_PROVIDER ? "MISTRAL_API_KEY" : "AGNES_API_KEY");
  if (status === 401 || status === 403 || /user not found|invalid api key|invalid authentication|unauthorized|authentication failed|permission denied|api key/i.test(detail)) {
    return codingProviderError(`${label} rejected the coding credential. Check ${keyName} in Render, then redeploy ARIA.`, "CODING_PROVIDER_AUTH_FAILED", provider, model);
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
  const model = getGeminiModel();
  if (!credential.configured) throw codingProviderError("Gemini coding credential is not configured.", "CODING_PROVIDER_NOT_CONFIGURED", GEMINI_PROVIDER, model);
  if (!credentialLooksUsable("gemini")) throw codingProviderError("GEMINI_API_KEY is present but too short to be usable.", "CODING_PROVIDER_INVALID_KEY", GEMINI_PROVIDER, model);

  try {
    const system = messages.find((item) => item.role === "system")?.content;
    const response = await axios.post(
      `${GEMINI_ENDPOINT}/${model}:generateContent`,
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
    if (!content) throw codingProviderError("Gemini returned an empty coding response.", "CODING_PROVIDER_EMPTY_RESPONSE", GEMINI_PROVIDER, model);
    return content;
  } catch (error) {
    if (error?.provider === GEMINI_PROVIDER) throw error;
    throw normalizeProviderFailure(error, GEMINI_PROVIDER, model);
  }
}

async function generateWithMistral(messages, maxTokens, temperature) {
  const credential = resolvedCredential("mistral");
  const model = getMistralCodeModel();
  if (!credential.configured) throw codingProviderError("Mistral coding credential is not configured.", "CODING_PROVIDER_NOT_CONFIGURED", MISTRAL_PROVIDER, model);
  if (!credentialLooksUsable("mistral")) throw codingProviderError("MISTRAL_API_KEY is present but too short to be usable.", "CODING_PROVIDER_INVALID_KEY", MISTRAL_PROVIDER, model);

  try {
    const response = await axios.post(
      MISTRAL_ENDPOINT,
      {
        model,
        messages,
        max_tokens: Math.min(Math.max(Number(maxTokens) || 12000, 256), 120000),
        temperature: typeof temperature === "number" ? temperature : 0.2,
      },
      {
        headers: { Authorization: `Bearer ${credential.value}`, "Content-Type": "application/json" },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw codingProviderError("Mistral returned an empty coding response.", "CODING_PROVIDER_EMPTY_RESPONSE", MISTRAL_PROVIDER, model);
    return content.trim();
  } catch (error) {
    if (error?.provider === MISTRAL_PROVIDER) throw error;
    throw normalizeProviderFailure(error, MISTRAL_PROVIDER, model);
  }
}

async function generateWithAgnes(messages, maxTokens, temperature) {
  const credential = resolvedCredential("agnes");
  const model = getAgnesModel();
  if (!credential.configured) throw codingProviderError("Agnes coding credential is not configured.", "CODING_PROVIDER_NOT_CONFIGURED", AGNES_PROVIDER, model);
  if (!credentialLooksUsable("agnes")) throw codingProviderError("AGNES_API_KEY is present but too short to be usable.", "CODING_PROVIDER_INVALID_KEY", AGNES_PROVIDER, model);

  try {
    const response = await axios.post(
      getAgnesEndpoint(),
      {
        model,
        messages,
        max_tokens: Math.min(Math.max(Number(maxTokens) || 12000, 256), 120000),
        temperature: typeof temperature === "number" ? temperature : 0.2,
      },
      {
        headers: { Authorization: `Bearer ${credential.value}`, "Content-Type": "application/json" },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw codingProviderError("Agnes AI returned an empty coding response.", "CODING_PROVIDER_EMPTY_RESPONSE", AGNES_PROVIDER, model);
    return content.trim();
  } catch (error) {
    if (error?.provider === AGNES_PROVIDER) throw error;
    throw normalizeProviderFailure(error, AGNES_PROVIDER, model);
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
  const mistral = resolvedCredential("mistral");
  const agnes = resolvedCredential("agnes");

  if (!gemini.configured && !mistral.configured && !agnes.configured) {
    throw codingProviderError("No coding provider is configured. Set GEMINI_API_KEY, MISTRAL_API_KEY, or AGNES_API_KEY in the bot runtime, then restart ARIA.", "CODING_PROVIDER_NOT_CONFIGURED", "coding", null);
  }

  let errors = [];
  if (gemini.configured) {
    try {
      return await generateWithGemini(messages, maxTokens, temperature);
    } catch (error) {
      errors.push(error);
    }
  }
  if (mistral.configured) {
    try {
      return await generateWithMistral(messages, maxTokens, temperature);
    } catch (error) {
      errors.push(error);
    }
  }
  if (agnes.configured) {
    try {
      return await generateWithAgnes(messages, maxTokens, temperature);
    } catch (error) {
      errors.push(error);
    }
  }
  const lastErr = errors[errors.length - 1];
  if (lastErr && errors.length > 1) {
    lastErr.message = `${lastErr.message} (Previous provider fallbacks also failed: ${errors.slice(0, -1).map(e => e.message).join("; ")})`;
  }
  throw lastErr || codingProviderError("No usable coding provider is configured.", "CODING_PROVIDER_NOT_CONFIGURED", "coding", null);
}

module.exports = {
  configured,
  providerStatus,
  generateCodingText,
  _test: {
    GEMINI_PROVIDER,
    GEMINI_ENDPOINT,
    MISTRAL_PROVIDER,
    MISTRAL_ENDPOINT,
    AGNES_PROVIDER,
    codingProviderError,
    credentialLooksUsable,
    normalizeProviderFailure,
    resolvedCredential,
  },
};
