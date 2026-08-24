const axios = require("axios");

// OpenAPIs — Free proxy to OpenAI + Anthropic models
// No API key, no signup, no limits during beta
// Models: GPT-5.5, GPT-5.4, Claude Opus 4.7, Sonnet 4.6, Haiku 4.5, and 100+ more
const BASE = "https://openapis.online/v1";

const MODELS = [
  "gpt-5.5-turbo",
  "gpt-5.4-mini", 
  "claude-opus-4.7",
  "claude-sonnet-4.6",
  "claude-haiku-4.5",
  "openrouter/free"
];

async function sendMessage(prompt, userId = "default", systemPrompt = "", options = {}) {
  const model = options.model || "openrouter/free"; // auto-picks best free model
  
  try {
    const res = await axios.post(
      `${BASE}/chat/completions`,
      {
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt }
        ],
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7,
        stream: false,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const text = res.data?.choices?.[0]?.message?.content || "";
    
    if (!text) {
      return { text: null, error: "No response from OpenAPIs", provider: "openapis" };
    }
    
    return { text: text.trim(), provider: "openapis", model };
  } catch (err) {
    // If openapis fails, try official OpenAI free tier models via OpenRouter
    if (err.response?.status === 404 || err.response?.status === 500) {
      // Ask the provider orchestrator to try the next configured provider.
      return { text: null, error: "OpenAPIs unavailable, trying fallback", provider: "openapis", retry: true };
    }
    return { text: null, error: err.message || "OpenAPIs failed", provider: "openapis" };
  }
}

// List available models
async function listModels() {
  try {
    const res = await axios.get(`${BASE}/models`, { timeout: 10000 });
    return res.data?.data?.map(m => m.id) || MODELS;
  } catch {
    return MODELS;
  }
}

module.exports = { sendMessage, listModels, BASE, MODELS };
