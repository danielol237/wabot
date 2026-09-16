// Central runtime provider configuration. This module reads environment variables
// at call time so a process restart is the only required refresh after Render edits.

const PROVIDERS = Object.freeze([
  { id: "openrouter", label: "OpenRouter", key: "OPENROUTER_API_KEY", aliases: ["OPENROUTER_KEY", "OPEN_ROUTER_API_KEY"], role: "chat fallback, coding, vision" },
  { id: "groq", label: "Groq", key: "GROQ_API_KEY", aliases: [], role: "chat, vision, transcription" },
  { id: "cerebras", label: "Cerebras", key: "CEREBRAS_API_KEY", aliases: [], role: "chat" },
  { id: "gemini", label: "Gemini", key: "GEMINI_API_KEY", aliases: ["GOOGLE_GEMINI_API_KEY"], role: "chat and coding" },
  { id: "zai", label: "Z.AI", key: "ZHIPU_API_KEY", aliases: ["ZAI_API_KEY"], role: "vision and media" },
  { id: "minimax", label: "MiniMax", key: "MINIMAX_API_KEY", aliases: [], role: "media and optional chat" },
  { id: "tavily", label: "Tavily", key: "TAVILY_API_KEY", aliases: [], role: "web search" },
  { id: "brave", label: "Brave Search", key: "BRAVE_API_KEY", aliases: [], role: "web search fallback" },
  { id: "elevenlabs", label: "ElevenLabs", key: "ELEVENLABS_API_KEY", aliases: [], role: "text to speech" },
]);

function definition(idOrKey) {
  const value = String(idOrKey || "").toLowerCase();
  return PROVIDERS.find((item) => item.id === value || item.key.toLowerCase() === value) || null;
}

function resolve(idOrKey) {
  const item = definition(idOrKey);
  if (!item) return { id: String(idOrKey || "unknown"), key: String(idOrKey || ""), configured: false, value: "", source: null, aliases: [] };
  const names = [item.key, ...item.aliases];
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return { ...item, configured: true, value, source: name };
  }
  return { ...item, configured: false, value: "", source: null };
}

function get(idOrKey) {
  return resolve(idOrKey).value;
}

function isConfigured(idOrKey) {
  return resolve(idOrKey).configured;
}

function maskedStatus(idOrKey) {
  const item = resolve(idOrKey);
  return {
    id: item.id,
    label: item.label,
    key: item.key,
    aliases: item.aliases,
    source: item.source,
    configured: item.configured,
    role: item.role,
    // Do not expose values or lengths; only a conservative shape signal.
    shape: item.configured ? (item.value.length >= 12 ? "present" : "short") : "missing",
  };
}

function listStatus() {
  return PROVIDERS.map((item) => maskedStatus(item.id));
}

module.exports = { PROVIDERS, definition, resolve, get, isConfigured, maskedStatus, listStatus };
