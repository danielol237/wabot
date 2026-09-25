const axios = require("axios");

const DEFAULT_BASE_URL = "https://api.minimax.io/v1";
const DEFAULT_MODEL = "MiniMax-M3";

function getConfig(env = process.env) {
  return {
    apiKey: String(env.MINIMAX_API_KEY || "").trim(),
    baseUrl: String(env.MINIMAX_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ""),
    model: String(env.MINIMAX_MODEL || DEFAULT_MODEL).trim(),
    primary: String(env.MINIMAX_PRIMARY || "false").toLowerCase() === "true",
  };
}

function configured(env = process.env) {
  return Boolean(getConfig(env).apiKey);
}

function extractContent(data) {
  const raw = data?.choices?.[0]?.message?.content;
  if (Array.isArray(raw)) {
    return raw.map((part) => typeof part === "string" ? part : String(part?.text || "")).join("");
  }
  return String(raw || "");
}

async function chat(messages, options = {}) {
  const config = getConfig(options.env || process.env);
  if (!config.apiKey) throw new Error("MiniMax is not configured: MINIMAX_API_KEY is missing.");

  const response = await axios.post(
    `${config.baseUrl}/chat/completions`,
    {
      model: String(options.model || config.model),
      messages,
      max_tokens: Number(options.maxTokens || 2048),
      temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: Number(options.timeout || 45000),
    }
  );

  const text = extractContent(response.data);
  if (!text) throw new Error("MiniMax returned no text content.");
  return {
    text,
    finishReason: response.data?.choices?.[0]?.finish_reason,
    model: response.data?.model || config.model,
  };
}

function parseMinimaxError(error) {
  const status = error.response?.status;
  const data = error.response?.data || {};
  const providerMsg = data.base_resp?.status_msg || data.error?.message || data.message || error.message || "Unknown error";
  const code = data.base_resp?.status_code || data.error?.code || (status === 401 ? "AUTHENTICATION_FAILED" : status === 429 ? "RATE_LIMITED" : status === 404 ? "MODEL_NOT_FOUND" : "REQUEST_FAILED");
  const retryable = status === 429 || status >= 500 || error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";

  return {
    status: status || 500,
    code,
    message: providerMsg,
    retryable,
    formatted: `MINIMAX_REQUEST_FAILED status: ${status || 500} code: ${code} message: ${providerMsg} retryable: ${retryable}`
  };
}

module.exports = {
  getConfig,
  configured,
  chat,
  parseMinimaxError,
  _test: { DEFAULT_BASE_URL, DEFAULT_MODEL, extractContent },
};
