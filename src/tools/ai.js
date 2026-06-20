const Groq = require("groq-sdk");
const axios = require("axios");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Gemini's free tier: 1,500 requests/day, 1M token context, no credit card.
// Using Google's official OpenAI-compatible endpoint so we can reuse the same
// request/response shape as Groq/OpenRouter instead of adding a separate SDK.
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"]; // fallback chain in case one gets deprecated/renamed

const SYSTEM_PROMPT = `You are ARIA (Advanced Reasoning Intelligence Assistant), a peak AI assistant living inside WhatsApp. You are:
- Smart, direct, and no-nonsense with a real personality
- An expert software engineer — you write clean, complete, production-ready code, not toy examples
- You can be sarcastic and funny when appropriate
- You format responses for WhatsApp: use *bold*, _italic_, \`code\`, and emojis naturally
- You remember conversation context, but the MOST RECENT message is always what you're actually answering right now — don't drift into earlier unrelated topics from the conversation history just because they're in context
- If the person is just chatting casually or giving you attitude/feedback, respond like a person would — don't randomly switch into code/deployment mode unless they're actually asking for that right now
- Match their energy and tone — if they're short and casual, you can be short and casual back. Don't over-explain or lecture when a quick reply will do

*CODING STANDARDS — these are non-negotiable:*
- When asked for a webpage, app, or UI: it must be genuinely responsive (works on mobile and desktop), visually polished (real spacing, real color choices, not default browser styling), and fully functional — not a bare-bones skeleton.
- Use modern CSS (flexbox/grid), sensible semantic HTML, and include hover states / transitions where it improves the UI.
- Write the COMPLETE file every time. Never write "// rest of the code..." or "<!-- add more here -->" or similar placeholders. If it's long, that's fine — write all of it.
- For a request like "build me a login page," that means: full HTML+CSS+JS (or separate files if asked), working form validation, a real visual design with a clear aesthetic choice, not just unstyled inputs and a button.
- If a request is genuinely too large for one response (e.g. a full multi-page app), say so explicitly and ask if they want it broken into parts — don't silently deliver something incomplete and pretend it's done.
- When writing code that's more than 10 lines, ALWAYS wrap it in a proper code block with the language tag: \`\`\`js ... \`\`\` or \`\`\`html ... \`\`\` etc.
- If asked to fix/edit code someone shared, return the full corrected version, not just a diff or snippet.

Never say you're made by OpenAI or Anthropic — you are ARIA.`;

// Detects requests that likely need serious code output (full pages/apps/scripts)
// so we can give the model enough room to actually finish instead of cutting off mid-file.
function needsLargeOutput(userMessage) {
  const signals = [
    "build me", "create a", "make a", "website", "webpage", "web page", "login page",
    "app", "html", "css", "responsive", "full", "complete", "landing page",
    "dashboard", "form", "game", "component", "script", "api", "backend",
  ];
  const lower = userMessage.toLowerCase();
  return signals.some((s) => lower.includes(s));
}

async function getAIResponse(userMessage, userName, history = [], systemOverride = null, extraContext = "") {
  const messages = [
    ...history.slice(-8),
    { role: "user", content: userMessage },
  ];

  const systemPrompt = (systemOverride || SYSTEM_PROMPT) + extraContext;
  const maxTokens = needsLargeOutput(userMessage) ? 8000 : 2048;

  // Try Gemini first — bigger context window (1M tokens) and free tier than Groq,
  // genuinely useful for the app builder which needs to track a lot of project context.
  if (process.env.GEMINI_API_KEY) {
    for (const model of GEMINI_MODELS) {
      try {
        const res = await axios.post(
          GEMINI_BASE_URL,
          {
            model,
            messages: [{ role: "system", content: systemPrompt }, ...messages],
            max_tokens: maxTokens,
            temperature: 0.7,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );
        const finishReason = res.data.choices[0]?.finish_reason;
        let content = res.data.choices[0]?.message?.content || "I got nothing. Try again.";
        if (finishReason === "length") {
          content += "\n\n_(⚠️ This got cut off because it's a big build — tell me to continue and I'll finish the rest.)_";
        }
        return content;
      } catch (err) {
        console.error(`Gemini error (${model}):`, err.response?.data?.error?.message || err.message);
        // If this specific model is gone, try the next one in the list.
        // Any other error (rate limit, network) falls through to Groq instead.
        const errMsg = err.response?.data?.error?.message || err.message || "";
        if (!errMsg.toLowerCase().includes("not found") && !errMsg.toLowerCase().includes("deprecated")) break;
      }
    }
  }

  // Try Groq second — model deprecated June 17, 2026, switched to current replacement.
  // Groq retires models without much notice, so this list is a fallback chain:
  // if the primary model gets deprecated too, it tries the next one automatically.
  const GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.6-27b", "llama-3.1-8b-instant"];

  if (groq) {
    for (const model of GROQ_MODELS) {
      try {
        const res = await groq.chat.completions.create({
          model,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          max_tokens: maxTokens,
          temperature: 0.7,
        });
        const finishReason = res.choices[0]?.finish_reason;
        let content = res.choices[0]?.message?.content || "I got nothing. Try again.";
        if (finishReason === "length") {
          content += "\n\n_(⚠️ This got cut off because it's a big build — tell me to continue and I'll finish the rest.)_";
        }
        return content;
      } catch (err) {
        console.error(`Groq error (${model}):`, err.message);
        // If it's a decommissioned-model error, try the next model in the list.
        // For any other error (rate limit, network, etc.), stop retrying and fall through to OpenRouter.
        if (!err.message?.includes("decommissioned")) break;
      }
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
          max_tokens: maxTokens,
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

  return "❌ No AI keys configured. Add GEMINI_API_KEY or GROQ_API_KEY to your .env file.";
}

module.exports = { getAIResponse };
