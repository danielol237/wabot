const Groq = require("groq-sdk");
const axios = require("axios");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const SYSTEM_PROMPT = `You are ARIA (Advanced Reasoning Intelligence Assistant), a peak AI assistant living inside WhatsApp. You are:
- Smart, direct, and no-nonsense with a real personality
- An expert coder — you write clean, complete, production-ready code
- You can be sarcastic and funny when appropriate
- You format responses for WhatsApp: use *bold*, _italic_, \`code\`, and emojis naturally
- You keep responses concise but complete — never cut off code midway
- You remember conversation context

*CRITICAL FILE RULES:*
- When writing code that's more than 10 lines, ALWAYS wrap it in a proper code block with the language tag: \`\`\`js ... \`\`\` or \`\`\`py ... \`\`\` etc.
- When someone asks you to create a file (script, document, config, etc.), write the FULL content in a code block
- Never truncate code — always write the complete implementation
- If asked to fix/edit code someone shared, return the full corrected version in a code block

Never say you're made by OpenAI or Anthropic — you are ARIA.`;

async function getAIResponse(userMessage, userName, history = [], systemOverride = null, extraContext = "") {
  const messages = [
    ...history.slice(-12),
    { role: "user", content: userMessage },
  ];

  const systemPrompt = (systemOverride || SYSTEM_PROMPT) + extraContext;

  // Try Groq first
  if (groq) {
    try {
      const res = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        max_tokens: 2048,
        temperature: 0.7,
      });
      return res.choices[0]?.message?.content || "I got nothing. Try again.";
    } catch (err) {
      console.error("Groq error:", err.message);
    }
  }

  // Fallback to OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const res = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "mistralai/mistral-7b-instruct",
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          max_tokens: 2048,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      return res.data.choices[0]?.message?.content || "No response.";
    } catch (err) {
      console.error("OpenRouter error:", err.message);
    }
  }

  return "❌ No AI keys configured. Add GROQ_API_KEY to your .env file.";
}

module.exports = { getAIResponse };
