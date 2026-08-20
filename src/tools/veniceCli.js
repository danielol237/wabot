const axios = require("axios");

// Venice AI — uncensored, private AI with OpenAI-compatible API
// Free tier: 10 text prompts/day without account
// Pro tier: More credits, higher limits
// API: https://api.venice.ai
const BASE = "https://api.venice.ai/api/v1";

async function sendMessage(prompt, userId = "default", systemPrompt = "", options = {}) {
  const apiKey = process.env.VENICE_API_KEY || "";
  const model = options.model || "llama-3.3-70b-instruct";
  
  try {
    const res = await axios.post(
      `${BASE}/chat/completions`,
      {
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt }
        ],
        max_tokens: options.maxTokens || 2048,
        temperature: options.temperature || 0.7,
        // Venice-specific: disable their default system prompt for true uncensored
        venice_parameters: {
          include_venice_system_prompt: false
        }
      },
      {
        headers: {
          "Authorization": apiKey ? `Bearer ${apiKey}` : "",
          "Content-Type": "application/json",
          "X-Api-Key": apiKey || "",
        },
        timeout: 60000,
      }
    );

    const text = res.data?.choices?.[0]?.message?.content || res.data?.message || "";
    
    if (!text) {
      return { text: null, error: "No response from Venice AI", provider: "venice" };
    }
    
    return { text: text.trim(), provider: "venice", model };
  } catch (err) {
    // Free tier might not need API key for basic access
    if (err.response?.status === 401 && !apiKey) {
      // Try without key (free tier)
      try {
        const res = await axios.post(
          `${BASE}/chat/completions`,
          {
            model,
            messages: [
              ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
              { role: "user", content: prompt }
            ],
            max_tokens: options.maxTokens || 2048,
            venice_parameters: {
              include_venice_system_prompt: false
            }
          },
          {
            headers: {
              "Content-Type": "application/json",
            },
            timeout: 60000,
          }
        );
        
        const text = res.data?.choices?.[0]?.message?.content || "";
        return { text: text.trim() || "No response from Venice AI.", provider: "venice", model };
      } catch (e2) {
        return { text: null, error: e2.message || "Venice AI failed", provider: "venice" };
      }
    }
    
    return { text: null, error: err.message || "Venice API error", provider: "venice" };
  }
}

module.exports = { sendMessage };
