// ── AI Provider Health Monitor ────────────────────────────────────
// Health is runtime evidence, not a key-presence guess. Providers can be
// probed explicitly and updated by real request outcomes. The state is kept
// in memory because credentials and transient failures must not be persisted.

const axios = require("axios");

const KEY_ENV = {
  Gemini: "GEMINI_API_KEY",
  Mistral: "MISTRAL_API_KEY",
  Agnes: "AGNES_API_KEY",
  Groq: "GROQ_API_KEY",
  MiniMax: "MINIMAX_API_KEY",
  ElevenLabs: "ELEVENLABS_API_KEY",
  "Z.AI": "ZHIPU_API_KEY",
};

const PROVIDER_ALIASES = {
  gpt5: "GPT-5",
  "gemini-unofficial": "Gemini-web",
  openapis: "OpenAPIs",
  minimax: "MiniMax",
  gemini: "Gemini",
  mistral: "Mistral",
  agnes: "Agnes",
  groq: "Groq",
  zai: "Z.AI",
};

const FAILURE_BACKOFF_MS = 60_000;
const MAX_FAILURE_BACKOFF_MS = 10 * 60_000;
const state = {
  results: [],
  lastCheckedAt: null,
  checking: false,
  runtime: {},
};

function providerKey(name) {
  return PROVIDER_ALIASES[String(name || "").toLowerCase()] || String(name || "");
}

function keySet(name) {
  const envName = KEY_ENV[providerKey(name)];
  return envName ? Boolean(process.env[envName]) : true;
}

function normalizeError(error) {
  const status = error?.response?.status;
  const body = error?.response?.data;
  const message = body?.error?.message || body?.message || error?.message || "provider error";
  if (status === 401 || status === 403) return "auth failed";
  if (status === 429) return "rate limited";
  if (error?.code === "ECONNABORTED" || /timeout/i.test(message)) return "timeout";
  if (error?.code === "ENOTFOUND" || /network|dns|socket/i.test(message)) return "unreachable";
  return String(message).slice(0, 180);
}

function recordSuccess(name, meta = {}) {
  const key = providerKey(name);
  const previous = state.runtime[key] || {};
  state.runtime[key] = {
    name: key,
    ok: true,
    failures: 0,
    lastSuccessAt: Date.now(),
    lastLatency: Number(meta.latency || 0),
    lastError: "",
    retryAt: 0,
  };
  return state.runtime[key];
}

function recordFailure(name, error, meta = {}) {
  const key = providerKey(name);
  const previous = state.runtime[key] || {};
  const failures = Number(previous.failures || 0) + 1;
  const backoff = Math.min(MAX_FAILURE_BACKOFF_MS, FAILURE_BACKOFF_MS * Math.max(1, failures));
  state.runtime[key] = {
    name: key,
    ok: false,
    failures,
    lastFailureAt: Date.now(),
    lastLatency: Number(meta.latency || 0),
    lastError: typeof error === "string" ? error.slice(0, 180) : normalizeError(error),
    retryAt: Date.now() + backoff,
  };
  return state.runtime[key];
}

function isAvailable(name) {
  const key = providerKey(name);
  if (!keySet(key)) return false;
  const runtime = state.runtime[key];
  return !runtime || runtime.ok !== false || Date.now() >= Number(runtime.retryAt || 0);
}

function getAvailability(name) {
  const key = providerKey(name);
  const runtime = state.runtime[key] || {};
  return {
    name: key,
    keySet: keySet(key),
    ok: keySet(key) && (runtime.ok !== false || Date.now() >= Number(runtime.retryAt || 0)),
    failures: runtime.failures || 0,
    lastError: runtime.lastError || "",
    lastSuccessAt: runtime.lastSuccessAt || null,
    lastFailureAt: runtime.lastFailureAt || null,
    retryAt: runtime.retryAt || 0,
    lastLatency: runtime.lastLatency || 0,
  };
}

async function probe(name, url, headers = {}, auth = "bearer") {
  const started = Date.now();
  const key = KEY_ENV[providerKey(name)] ? process.env[KEY_ENV[providerKey(name)]] : "configured";
  if (!key) return { name, ok: false, status: null, latency: 0, error: "no API key configured", keySet: false };
  try {
    const authHeaders = auth === "xi-api-key" ? { "xi-api-key": key } : { Authorization: `Bearer ${key}` };
    const res = await axios.get(url, { timeout: 8000, headers: { ...headers, ...authHeaders } });
    const result = { name, ok: res.status < 400, status: res.status, latency: Date.now() - started, error: "", keySet: true };
    if (result.ok) recordSuccess(name, { latency: result.latency });
    return result;
  } catch (error) {
    const result = { name, ok: false, status: error.response?.status || null, latency: Date.now() - started, error: normalizeError(error), keySet: true };
    recordFailure(name, result.error, { latency: result.latency });
    return result;
  }
}

async function probeGemini() {
  const started = Date.now();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { name: "Gemini", ok: false, status: null, latency: 0, error: "no API key configured", keySet: false };
  try {
    const res = await axios.get("https://generativelanguage.googleapis.com/v1beta/models", { timeout: 8000, headers: { "x-goog-api-key": key } });
    const result = { name: "Gemini", ok: res.status < 400, status: res.status, latency: Date.now() - started, error: "", keySet: true };
    if (result.ok) recordSuccess("Gemini", { latency: result.latency });
    return result;
  } catch (error) {
    const result = { name: "Gemini", ok: false, status: error.response?.status || null, latency: Date.now() - started, error: normalizeError(error), keySet: true };
    recordFailure("Gemini", result.error, { latency: result.latency });
    return result;
  }
}

async function probeMistral() {
  return probe("Mistral", "https://api.mistral.ai/v1/models", { "Content-Type": "application/json" });
}

async function probeAgnes() {
  const baseUrl = String(process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");
  return probe("Agnes", `${baseUrl}/models`, { "Content-Type": "application/json" });
}

const PROBES = [
  probeGemini,
  probeMistral,
  probeAgnes,
  () => probe("Groq", "https://api.groq.com/openai/v1/models", { "Content-Type": "application/json" }),
  () => probe("ElevenLabs", "https://api.elevenlabs.io/v1/user", { "Content-Type": "application/json" }, "xi-api-key"),
];

async function checkAll() {
  if (state.checking) return state.results;
  state.checking = true;
  try {
    state.results = await Promise.all(PROBES.map((run) => run().catch((error) => ({ name: "unknown", ok: false, error: normalizeError(error), keySet: false }))));
    state.lastCheckedAt = Date.now();
    return state.results;
  } finally {
    state.checking = false;
  }
}

function getHealth() {
  const names = Object.keys(KEY_ENV);
  return {
    results: state.results.slice(),
    runtime: names.reduce((out, name) => { out[name] = getAvailability(name); return out; }, {}),
    lastCheckedAt: state.lastCheckedAt,
    checking: state.checking,
  };
}

module.exports = {
  checkAll,
  getHealth,
  recordSuccess,
  recordFailure,
  isAvailable,
  getAvailability,
  _test: { normalizeError, providerKey, keySet },
};
