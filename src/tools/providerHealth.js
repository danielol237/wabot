// ── AI Provider Health Monitor ────────────────────────────────────
// Probes each configured AI provider with a cheap, token-free request
// (model-list or key endpoint) and records real health — ok / status /
// latency — instead of just "key present". Complements the anime source
// health monitor and the dashboard's AI keys panel.

const axios = require("axios");

const KEY_ENV = {
  "OpenRouter": "OPENROUTER_API_KEY",
  "Groq": "GROQ_API_KEY",
  "Cerebras": "CEREBRAS_API_KEY",
  "Gemini": "GEMINI_API_KEY",
  "ElevenLabs": "ELEVENLABS_API_KEY",
};

// Each probe returns { name, ok, status, latency, error, keySet, checkedAt }.
async function probe(name, url, headers, auth = "bearer") {
  const t = Date.now();
  const key = process.env[KEY_ENV[name]];
  if (!key) return { name, ok: false, status: null, latency: 0, error: "no API key configured", keySet: false };
  try {
    const authHeaders = auth === "xi-api-key" ? { "xi-api-key": key } : { Authorization: `Bearer ${key}` };
    const res = await axios.get(url, { timeout: 8000, headers: { ...headers, ...authHeaders } });
    return { name, ok: res.status < 400, status: res.status, latency: Date.now() - t, error: "", keySet: true };
  } catch (e) {
    const status = e.response?.status;
    const body = e.response?.data;
    const errMsg = body?.error?.message || body?.message || e.message || "error";
    // 401/403 = key invalid; 404 = endpoint moved; 429 = rate limited; other = unreachable.
    const label = status === 401 || status === 403 ? "auth failed" : status === 429 ? "rate limited" : (e.code === "ECONNABORTED" ? "timeout" : e.code === "ENOTFOUND" ? "unreachable" : errMsg);
    return { name, ok: false, status, latency: Date.now() - t, error: label, keySet: true };
  }
}

const PROBES = [
  () => probe("OpenRouter", "https://openrouter.ai/api/v1/models", { "Content-Type": "application/json" }),
  () => probe("Groq", "https://api.groq.com/openai/v1/models", { "Content-Type": "application/json" }),
  () => probe("Cerebras", "https://api.cerebras.ai/v1/models", { "Content-Type": "application/json" }),
  () => probe("Gemini", "https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": process.env.GEMINI_API_KEY || "", "Content-Type": "application/json" }),
  () => probe("ElevenLabs", "https://api.elevenlabs.io/v1/user", { "Content-Type": "application/json" }, "xi-api-key"),
];

// Gemini uses x-goog-api-key, not Bearer — override its probe.
async function probeGemini() {
  const t = Date.now();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { name: "Gemini", ok: false, status: null, latency: 0, error: "no API key configured", keySet: false };
  try {
    const res = await axios.get("https://generativelanguage.googleapis.com/v1beta/models", {
      timeout: 8000,
      headers: { "x-goog-api-key": key },
    });
    return { name: "Gemini", ok: res.status < 400, status: res.status, latency: Date.now() - t, error: "", keySet: true };
  } catch (e) {
    const status = e.response?.status;
    const label = status === 403 ? "403 forbidden" : status === 429 ? "rate limited" : e.code === "ENOTFOUND" ? "unreachable" : (e.message || "error");
    return { name: "Gemini", ok: false, status, latency: Date.now() - t, error: label, keySet: true };
  }
}

const ALL_PROBES = [PROBES[0], PROBES[1], PROBES[2], probeGemini, PROBES[4]];

const state = { results: [], lastCheckedAt: null, checking: false };

async function checkAll() {
  if (state.checking) return state.results;
  state.checking = true;
  try {
    const results = await Promise.all(ALL_PROBES.map((p) => p().catch((e) => ({ name: "?", ok: false, error: e.message }))));
    state.results = results;
    state.lastCheckedAt = Date.now();
    return results;
  } finally {
    state.checking = false;
  }
}

function getHealth() {
  return { ...state, results: state.results };
}

module.exports = { checkAll, getHealth };
