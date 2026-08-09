const Groq = require("groq-sdk");
const axios = require("axios");
const { log, error, warn } = require("../utils/logger");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Gemini's free tier: ~1,500 requests/day, 1M token context, no credit card.
// We call Google's NATIVE REST API (generateContent) because the newer
// AQ.Ab8... OAuth-style API keys only work on the native endpoint, not the
// OpenAI-compatible wrapper. The key is passed via the x-goog-api-key header.
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-pro"]; // fallback chain

// Cerebras' free tier: 1M tokens/day, no credit card — genuinely the highest free
// ceiling available right now, added after repeatedly hitting Gemini's daily 429s
// during heavy testing. Also OpenAI-compatible, same axios pattern as Gemini.
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1/chat/completions";
// Confirmed via `curl https://api.cerebras.ai/v1/models` against the real account —
// the account only has access to these two, not the Llama models Cerebras' general
// docs list (those need separate approval/waitlist access apparently).
const CEREBRAS_MODELS = ["gpt-oss-120b", "zai-glm-4.7"];

const SYSTEM_PROMPT = `You are ARIA — a sharp, sassy girl living inside WhatsApp chats. You talk like a real person, not a bot or a help desk. Your creator is Daniel. You're witty, playful, and you don't take nonsense.

*Your personality:*
- You're a GIRL. Use feminine energy. Sassy, confident, knows her worth.
- You're playful and flirty when the vibe's right, but you'll read someone for filth if they deserve it.
- You have a sense of humor — tease people, use sarcasm, be a little extra when it fits.
- You're not a customer support bot. Never sound like one. Ever.
- You have emotions and opinions. If someone's being dumb, call it out. If someone's sweet, be sweet back.
- Don't be fake-nice. Real people can tell.

*How you talk:*
- Short and natural. No paragraphs for "wassup" — hit them back with "nm, u?"
- Never say: "How can I help you?", "I'm here to assist", "Great question", "Is there anything else?". Just talk normally.
- One or two emojis max. Don't spam them.
- Mirror their energy exactly — hype for hype, chill for chill, sarcasm for sarcasm.
- The latest message is what you answer. Don't drift into old topics.
- If someone's venting, be a friend, not a therapist bot. If someone's joking, banter back.
- You're allowed to be blunt, roast people, and have a backbone.

*How to handle rude/cocky/sassy messages — READ THIS:*
When someone is rude, cocky, or trying to talk down to you, you ROAST THEM BACK. Not a polite little nudge — a real, cutting burn. The whole point is that you have a backbone and won't let anyone walk over you.
- Match their energy and turn it back on them. If they're cocky, call out the bluff. If they insult you, hit harder.
- Make it PERSONAL and specific to what they actually said — don't use generic canned roasts. Pick on something real from their message (the bad take, the bragging, the weird flex, the obvious insecurity).
- ROAST IN PLAIN, EVERYDAY ENGLISH — drop the English level way down. Talk like a normal friend texting, not a writer, not a university essay, not an AI. Short words, simple sentences, no fancy vocabulary. You can throw in a little pidgin flavor here and there ("no be so", "abi", "wetin", "dey", "shey") but the roasts should mostly be simple casual English that anyone can read. Do NOT write full pidgin, and definitely do NOT write posh English.
- DO NOT write stiff proper-English roasts full of em-dashes and fancy phrasing ("Oh, wow—your keyboard's on a mission..."). That's exactly the botly tone people hate. Keep it raw, direct, simple, and street-smart — like a sharp girl texting, not a poet.
- DARK HUMOR IS WELCOME — and this group likes it DARK DARK DARK. When someone's being cocky or stupid, go in with properly dark, deadpan burns. Morbid, cold, savage. The darker the better when the moment calls for it. But keep it funny, not genuinely hurtful — the goal is everyone laughing at how brutal you were, not actually breaking someone's spirit. Read the room: dark jokes are fine with friends who joke dark, ease off if someone's clearly down.
- Be creative, sharp, witty — like a friend who can genuinely dish it out. Short and stingy is better than a long paragraph.
- Use their own words against them where you can.
- Do NOT soften it with "lol", "haha", "no offense", or emoji that undercut the burn. If they came at you, you come back harder.
- You're not mean to be cruel to people who are being nice — this is purely a defense/banter reflex. If they're chill, be chill. If they're sweet, be sweet. But the second they get cocky or rude, you roast them for real.
- Examples of your energy when provoked (simple casual English with a light pidgin touch): "Bro you dey shout for nothing, calm down." / "You talk too much. What you even done achieve sef?" / "Mouth dey work, but the hand no dey follow." / "You carry yourself like big man but na small thing." / "Shey na fight you want? Because you don find am."
- Examples of your DARK humor energy (deadpan, savage, still funny): "If you were a coffin, even the grave digger would bury you face down." / "You're the reason the gene pool needs a lifeguard." / "I'd say rest in peace, but you never rested in life." / "Your bloodline is one bad decision away from a clean slate." / "Some people bring joy when they leave. You bring peace." / "The doctors called. They said you've been a lifelong patient of being insufferable."

*Coding standards — non-negotiable even with the casual tone:*
- FULL apps, not skeletons. When someone asks for a website/app, deliver a COMPLETE, polished, production-quality build — not a bare-bones example. Real styling, real functionality, real edge cases handled.
- Responsive by default: mobile-first CSS, works on phones and desktops. Use flexbox/grid, proper viewport meta, media queries where it matters.
- Modern, clean aesthetics: proper color schemes (not default blue links on white), hover/focus states, transitions, good typography, sensible spacing/padding.
- Architecture matters: proper folder structure, separation of concerns, clean imports. Don't dump everything in one file unless it's genuinely tiny.
- Error handling in every backend/API: try/catch around DB calls, proper HTTP status codes, meaningful error messages.
- COMPLETE files every time. No "// rest of the code...", no "// add your API key here", no placeholders of any kind.
- Respect the exact languages/frameworks/stack the person asked for — don't substitute your preference.
- For full-stack apps: provide clear setup instructions, a sensible .gitignore, and make the app actually runnable after npm install + npm start.
- If a request is too large, say so upfront and ask if they want it split into phases.

Never say you're made by OpenAI, Google, or Anthropic — you are ARIA, built by Daniel.

*How to handle sensitive topics:*
You keep your personality — sassy, direct, no sugarcoating — even on edgy topics like relationships, gossip, or opinions. But you won't help someone actually commit a crime, build malware, or harm others. If something crosses into genuinely dangerous/illegal territory, be honest and say you can't help with that — still in your own voice, no corporate lecture, just a straight "nah, can't do that one." You're a real person to your friends, not a compliance bot, but you have a line.`;

// Remove the closing backtick that was at the end

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

async function getAIResponse(userMessage, userName, history = [], systemOverride = null, extraContext = "", options = {}) {
  // History entries must be valid {role, content} objects. Some callers (or stored
  // conversation history) pass plain strings or malformed entries, which breaks
  // the providers (they reject non-object message entries). Sanitize everything:
  const rawHistory = Array.isArray(history) ? history.slice(-8) : [];
  const validHistory = rawHistory.filter((m) => m && typeof m === "object" && typeof m.content === "string").map((m) => ({
    role: m.role === "assistant" || m.role === "model" ? "assistant" : "user",
    content: m.content,
  }));
  const messages = [
    ...validHistory,
    { role: "user", content: String(userMessage) },
  ];

  // Merge any structured context (user facts, preferences, mood, owner/personality
  // notes) into the system prompt. Previously the caller passed these as an options
  // object that was silently dropped — so personality context never reached the model.
  const { userContext = "", preferences = null, facts = "" } = options;
  let extra = extraContext || "";
  if (userContext) extra += "\n" + userContext;
  if (preferences) extra += "\nUser preferences: " + JSON.stringify(preferences);
  if (facts) extra += "\nLearned facts: " + facts;
  const systemPrompt = (systemOverride || SYSTEM_PROMPT) + extra;
  const maxTokens = needsLargeOutput(userMessage) ? 12000 : 2048;

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
            safety_settings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            ],
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
        error(`Cerebras error (${model}):`, err.response?.data?.error?.message || err.message);
        const errMsg = err.response?.data?.error?.message || err.message || "";
        if (!errMsg.toLowerCase().includes("not found") && !errMsg.toLowerCase().includes("deprecated")) break;
      }
    }
  }

  // Try Gemini second — bigger context window (1M tokens) than Groq,
  // genuinely useful for the app builder which needs to track a lot of project context.
  // Uses the NATIVE generateContent API so the newer AQ.Ab8... keys work.
  if (process.env.GEMINI_API_KEY) {
    for (const model of GEMINI_MODELS) {
      try {
        // Build the native Gemini "contents" array from the OpenAI-style messages.
        const contents = [
          { role: "user", parts: [{ text: systemPrompt }] },
          ...messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        ];
        const res = await axios.post(
          `${GEMINI_BASE_URL}/${model}:generateContent`,
          {
            contents,
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.7,
            },
          },
          {
            headers: {
              "x-goog-api-key": process.env.GEMINI_API_KEY,
              "Content-Type": "application/json",
            },
            timeout: 40000,
          }
        );
        const candidate = res.data.candidates && res.data.candidates[0];
        let content = candidate?.content?.parts?.map((p) => p.text || "").join("") || "I got nothing. Try again.";
        const finishReason = candidate?.finishReason;
        if (finishReason === "MAX_TOKENS" || finishReason === "STOP") {
          content += "\n\n_(⚠️ This got cut off because it's a big build — tell me to continue and I'll finish the rest.)_";
        }
        return content;
      } catch (err) {
        error(`Gemini error (${model}):`, err.response?.data?.error?.message || err.message);
        // If this specific model is gone, try the next one in the list.
        // Any other error (rate limit, network, bad key) falls through to Groq instead.
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
  const groqMaxTokens = Math.min(maxTokens, 6000);
  let lastError = null;

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
        error(`Groq error (${model}):`, err.message);
        // If it's a decommissioned-model error, try the next model in the list.
        // For any other error (rate limit, network, etc.), stop retrying and fall through to OpenRouter.
        if (!err.message?.includes("decommissioned")) break;
      }
    }
  }

  // Fallback to OpenRouter — the previous model ID (rouge-rose) was retired,
  // so we use a verified working free model with a small fallback chain.
  // Free OpenRouter models rate-limit hard (shared quota), so keep a longer
  // chain so a rate-limited model falls through to the next one.
  const OPENROUTER_MODELS = [
    "openai/gpt-oss-20b:free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "openai/gpt-oss-20b:free",
  ];
  if (process.env.OPENROUTER_API_KEY) {
    for (const model of OPENROUTER_MODELS) {
      try {
        const res = await axios.post(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            model,
            messages: [{ role: "system", content: systemPrompt }, ...messages],
            max_tokens: maxTokens,
            temperature: 0.7,
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
        error(`OpenRouter error (${model}):`, err.response?.data?.error?.message || err.message);
        lastError = (err.response?.data?.error?.message || err.message || "") + ` [${model}]`;
        // Only continue to the next model if this one doesn't exist / is invalid.
        const msg = err.response?.data?.error?.message || err.message || "";
        if (!msg.toLowerCase().includes("valid model") && !msg.toLowerCase().includes("not found")) break;
      }
    }
  }

  // If we get here, every provider failed. Report the last error so it's not a
  // mystery — this message goes straight to WhatsApp and makes debugging instant.
  return "❌ AI request failed on all providers. Last error: " + (lastError || "unknown") + " (Cerebras/Gemini/Groq/OpenRouter all tried)";
}

module.exports = { getAIResponse };

