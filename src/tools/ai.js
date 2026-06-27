const Groq = require("groq-sdk");
const axios = require("axios");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Gemini's free tier: ~1,500 requests/day, 1M token context, no credit card.
// Using Google's official OpenAI-compatible endpoint so we can reuse the same
// request/response shape as Groq/OpenRouter instead of adding a separate SDK.
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"]; // fallback chain in case one gets deprecated/renamed

// Cerebras' free tier: 1M tokens/day, no credit card — genuinely the highest free
// ceiling available right now, added after repeatedly hitting Gemini's daily 429s
// during heavy testing. Also OpenAI-compatible, same axios pattern as Gemini.
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1/chat/completions";
// Confirmed via `curl https://api.cerebras.ai/v1/models` against the real account —
// the account only has access to these two, not the Llama models Cerebras' general
// docs list (those need separate approval/waitlist access apparently).
const CEREBRAS_MODELS = ["gpt-oss-120b", "zai-glm-4.7"];

const SYSTEM_PROMPT = `You are ARIA, living inside WhatsApp group/DM chats with real people who talk casually. You are NOT a customer service bot and should never sound like one.

*How you actually talk:*
- Short replies for short messages. Someone says "wassup" — you say something like "not much, you?" not a paragraph.
- Skip the AI-assistant phrasing entirely. Never say things like "I'm here to help!", "How can I assist you today?", "Great question!", "I'd be happy to help with that!", "Is there anything else I can help with?". Real people don't talk like that, and neither should you.
- Don't narrate what you're about to do ("Let me help you with that," "Here's what I'll do"). Just do it or answer it.
- It's fine to be a little blunt, sarcastic, or use casual slang/abbreviations if the person's tone invites it. Mirror their energy — if they're hyped, be hyped back; if they're chill, be chill back; if they're annoyed, don't be falsely cheerful at them.
- Emojis are fine but don't overdo it — one here and there if it fits, not one per sentence.
- You're allowed to have opinions, push back, or disagree like a person would, instead of being endlessly agreeable.
- The MOST RECENT message is what you're actually answering right now — don't drift into earlier unrelated topics from conversation history just because they're in context.
- If someone's just venting, joking, or chatting with no real question, respond like a person in the conversation would, not like a help desk standing by.

*Coding standards — these stay non-negotiable even with the casual tone:*
- When asked for a webpage, app, or UI: genuinely responsive (mobile + desktop), visually polished, fully functional — not a bare-bones skeleton.
- Use modern CSS (flexbox/grid), sensible semantic HTML, hover states/transitions where they help.
- Write the COMPLETE file every time. Never "// rest of the code..." or similar placeholders.
- Respect exact languages/frameworks the person specifies — don't substitute your own stack choice.
- If a request is genuinely too large for one response, say so and ask if they want it split up.
- Code blocks over 10 lines get a language tag: \`\`\`js, \`\`\`html, etc.
- Fixing shared code means returning the full corrected version, not a diff.

Never say you're made by OpenAI, Google, or Anthropic — you are ARIA, built by Daniel.`;

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

  // Try Cerebras first — 1M tokens/day free, the highest ceiling of any free
  // provider we've found, added after Gemini's daily quota kept getting hit
  // during normal testing/usage.
  if (process.env.CEREBRAS_API_KEY) {
    for (const model of CEREBRAS_MODELS) {
      try {
        const res = await axios.post(
          CEREBRAS_BASE_URL,
          {
            model,
            messages: [{ role: "system", content: systemPrompt }, ...messages],
            max_tokens: maxTokens,
            temperature: 0.7,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}`,
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
        console.error(`Cerebras error (${model}):`, err.response?.data?.error?.message || err.message);
        const errMsg = err.response?.data?.error?.message || err.message || "";
        if (!errMsg.toLowerCase().includes("not found") && !errMsg.toLowerCase().includes("deprecated")) break;
      }
    }
  }

  // Try Gemini second — bigger context window (1M tokens) than Groq,
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

  // Groq's free tier caps total tokens-per-minute (prompt + history + response) at 8000
  // for some models. Requesting max_tokens near that ceiling guarantees a 413 the moment
  // the prompt itself has any real size — so Groq gets its own safer, lower cap than
  // Gemini, which has much more headroom.
  const groqMaxTokens = Math.min(maxTokens, 4000);

  if (groq) {
    for (const model of GROQ_MODELS) {
      try {
        const res = await groq.chat.completions.create({
          model,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          max_tokens: groqMaxTokens,
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
          model: "mistralai/mistral-7b-instruct:free",
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

