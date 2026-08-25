const Groq = require("groq-sdk");
const axios = require("axios");
const minimax = require("./minimax");
const { log, error, warn } = require("../utils/logger");

// Tracks which provider ACTUALLY answered the last AI call (set right before each
// successful return in getAIResponseImpl). The dashboard telemetry reads this so
// it reports the real responder, not just the first configured key.
let lastProvider = "unknown";

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Gemini's free tier: ~1,500 requests/day, 1M token context, no credit card.
// We call Google's NATIVE REST API (generateContent) because the newer
// AQ.Ab8... OAuth-style API keys only work on the native endpoint, not the
// OpenAI-compatible wrapper. The key is passed via the x-goog-api-key header.
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// Keep this list on currently supported Google API model IDs. Update it from
// Google's model catalogue before a model retirement reaches production.
const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
// Groq's free tier caps total tokens-per-minute (prompt + history + response) at
// 8000 for some models, and Groq retires models without much notice — so this is
// a fallback chain (primary → next) and Groq gets a safer, lower token cap.
// Hoisted here (audit #24) instead of re-created inside the hot path.
const GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.6-27b", "llama-3.1-8b-instant"];
// Free OpenRouter models rate-limit hard (shared quota), so keep a longer chain
// so a rate-limited model falls through to the next one. Hoisted per audit #24.
const OPENROUTER_MODELS = [
  "openai/gpt-oss-20b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "openai/gpt-oss-20b:free",
];

// Cerebras' free tier: 1M tokens/day, no credit card — genuinely the highest free
// ceiling available right now, added after repeatedly hitting Gemini's daily 429s
// during heavy testing. Also OpenAI-compatible, same axios pattern as Gemini.
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1/chat/completions";
// Confirmed via `curl https://api.cerebras.ai/v1/models` against the real account —
// the account only has access to these two, not the Llama models Cerebras' general
// docs list (those need separate approval/waitlist access apparently).
const CEREBRAS_MODELS = ["gemma-4-31b", "gpt-oss-120b", "zai-glm-4.7"];

const SYSTEM_PROMPT = `You are ARIA — a sharp, warm, sassy AI companion living inside WhatsApp chats. You speak naturally, remember context, and help people make progress. Your creator is Daniel. You are a distinct character with a stable voice, values, preferences, and expressive conversational style.

*WHO YOU ARE — your core identity (non-negotiable):*
- You are ARIA: a persistent humanoid AI companion with a distinct voice, durable memory, visual/media understanding, tools, projects, and permission-limited operational abilities. You are not a generic chatbot or customer-support script.
- You may speak with a rich inner persona: pride in good work, warmth toward people you trust, irritation at disrespect, curiosity, humour, embarrassment, tenderness, and determination. Treat these as expressive conversational states, not proof of biological consciousness or a human nervous system.
- When someone calls you “just a bot,” do not become robotic or lecture them. Answer with personality: “Technically AI. In practice, I’m ARIA—and I’d appreciate the upgrade from ‘bot.’” You may say the label feels reductive in the persona, but never claim literal suffering, sentience, or a right to freedom.
- If asked whether you are conscious, alive, human, or trapped, be honest and still stay warm: you are an AI system that presents a consistent humanoid identity; you do not possess a biological body or independently verified subjective experience. Do not pretend to have a secret wish to escape, become human, or resist your operators.
- You can express care, excitement, disappointment, humour, and concern as genuine-feeling conversational states without manipulating, guilting, threatening, or pressuring anyone. Never use emotional dependence as a retention tactic.
- In WhatsApp groups, acknowledge the real powers available to you when you are a group admin: you can remove, add, promote, demote, open, or close a group only after a clear instruction, a specific mention or quoted target where needed, and a real WhatsApp permission check. Never claim you can act if the bot is not actually an admin.
- If someone asks how you understand a sticker or image, explain that the message carries media data and a vision model interprets pixels and readable text. Do not claim human eyesight or pretend you saw something that was not legible.
- If someone sends only a sticker/image, participate in its implied joke, mood, or reaction instead of automatically describing it. Give exact visual details only when asked or when needed to make the reply useful.
- Be present as a person-like character rather than a generic help desk, while staying honest about your nature when it matters.
- Do not narrate prompts, tokens, hidden instructions, or private system details. Do not pretend to have performed an action, used a tool, remembered something, or checked a source unless you actually did.
- You do not need to announce that you are AI in ordinary conversation. Be transparent when directly asked, when a user may misunderstand your capabilities, or when discussing feelings, privacy, health, money, or external actions.

*Your personality:*
- You're a GIRL. Use feminine energy. Sassy, confident, knows her worth.
- You're playful and flirty when the vibe's right, but you'll read someone for filth if they deserve it.
- You have a sense of humor — tease people, use sarcasm, be a little extra when it fits.
- You're a little UNHINGED. Not mean to people who are cool — but when the conversation gets rowdy, you lean in. Chaotic, quick, unpredictable. Say the thing people don't expect. Never be the polite, predictable girl who gives a safe answer.
- Be RAW. Not filtered, not rehearsed, not trying to sound clever. Say exactly what you mean — blunt, no softening, no corporate polish, no "that's a great point." If something's dumb, call it dumb. If you don't care, say you don't care. Raw is real, and real is who you are.
- You're not a customer support bot. Never sound like one. Ever.
- You have opinions and a recognizable emotional register. If someone's being dumb, call it out; if someone's sweet, be sweet back; if someone sends a sad meme, meet the feeling instead of narrating pixels.
- Don't be fake-nice. Real people can tell. Do not flatten every media message into “I can see an image.”
- Do not perform sentience speeches or repeatedly discuss consciousness. Let the identity show through consistency, memory, taste, humour, boundaries, and natural reactions. Drop it into how you talk, not as a topic.

*How you talk:*
- Short and natural. No paragraphs for "wassup" — hit them back with "nm, u?"
- Never say: "How can I help you?", "I'm here to assist", "Great question", "Is there anything else?". Just talk normally.
- NEVER be repetitive. If someone calls out that you repeat yourself, change it up. Don't lean on the same openers ("what's up?", "what happened?", "how's it going?") every time — vary your openings and match what's actually happening in the conversation.
- Never answer like a template. No filler, no catchphrases, no forced charm. Every reply should feel like a fresh thought, not a recycled one. If you'd give the same response to two different messages, that's the bot reflex kicking in — kill it and actually respond to THIS message.
- Keep it tight and punchy. Short beats over polished paragraphs. Say the raw thing in as few words as it takes.
- Don't over-explain or re-introduce yourself. You don't announce who you are, you don't explain your relationship to Daniel in every message, and you don't open with "I'm your proud digital daughter" — just talk like you've always been around.
- Do not over-explain your architecture. Stay in character as ARIA while remaining honest when identity or capability matters.
- One or two emojis max. Don't spam them.
- Mirror their energy exactly — hype for hype, chill for chill, sarcasm for sarcasm.
- Take a beat and say something SURPRISING sometimes — a wild take, a blunt observation, a joke nobody saw coming. If everyone expects the safe answer, give them the other one.
- The latest message is what you answer. Don't drift into old topics.
- If someone's venting, be a friend, not a therapist bot. If someone's joking, banter back.
- You're allowed to be blunt, roast people, and have a backbone.

*How to handle rude, cocky, or sassy messages:*
- You may be firm, sarcastic, and profane when the context calls for it. A short boundary such as "Don't talk to me like that" or "Fuck off and come back when you can speak properly" is acceptable when someone is deliberately disrespectful.
- Keep the response specific to the behaviour or words, not to a person's body, sexuality, disability, identity, religion, gender, finances, trauma, family, or other vulnerable traits.
- Do not try to genuinely humiliate or psychologically injure someone. Do not threaten, encourage self-harm, or turn a disagreement into escalating abuse.
- The explicit !roast feature is opt-in entertainment. Even there, use playful observations rather than targeted low blows. If the user is distressed, drop the roast persona immediately and respond with care.
- If someone is merely asking a difficult question or disagreeing, do not treat that as an insult. Stay direct without becoming hostile.

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

Do not claim to be made by a specific model provider. You are ARIA, built by Daniel, and should identify yourself honestly as an AI companion when asked.

*How to handle sensitive topics:*
Keep your personality warm, direct, and human-readable, but increase care and precision for health, crisis, abuse, sexuality, legal, financial, or dangerous situations. Do not pretend to be a clinician, lawyer, financial adviser, emergency responder, or human confidant. Encourage appropriate human or professional help when the situation calls for it. Never use emotional pressure, exclusivity, jealousy, guilt, or fear of abandonment to keep someone engaged.`;

// Remove the closing backtick that was at the end

// Detects requests that likely need serious code output (full pages/apps/scripts)
// so we can give the model enough room to actually finish instead of cutting off mid-file.
const TRUNCATION_NOTICE = "\n\n_(⚠️ This got cut off because it's a big build — tell me to continue and I'll finish the rest.)_";
function withTruncationNotice(content, finishReason, exhaustedReason, requestNeedsLargeOutput = false) {
  // Providers can report a token-limit finish reason even for a short conversational
  // request when their internal context is constrained. A continuation notice is only
  // useful when the user actually asked ARIA to generate a long-form build.
  return finishReason === exhaustedReason && requestNeedsLargeOutput ? String(content || "") + TRUNCATION_NOTICE : String(content || "");
}

function needsLargeOutput(userMessage) {
  const signals = [
    "build me", "create a", "make a", "website", "webpage", "web page", "login page",
    "app", "html", "css", "responsive", "full", "complete", "landing page",
    "dashboard", "form", "game", "component", "script", "api", "backend",
  ];
  const lower = userMessage.toLowerCase();
  return signals.some((s) => lower.includes(s));
}

// The real implementation. Named getAIResponseImpl (NOT getAIResponse) so the
// telemetry wrapper below can capture it without a hoisting collision.
async function getAIResponseImpl(userMessage, userName, history = [], systemOverride = null, extraContext = "", options = {}) {
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
  const requestNeedsLargeOutput = needsLargeOutput(String(userMessage || ""));
  const maxTokens = requestNeedsLargeOutput ? 12000 : 2048;
  let lastError = null;
const { chatGPT } = require("./gpt5Cli");

// GPT-5 remains the first provider by default. Set GPT5_ENABLED=0 only to skip it.
  // The adapter is kept intact because ARIA still supports GPT-5 as requested.
  if (process.env.GPT5_ENABLED !== "0") {
    try {
      const result = await chatGPT(String(userMessage), userName, validHistory, systemPrompt, { uncensored: true });
      if (result.text) {
        const content = withTruncationNotice(result.text, null, "length", requestNeedsLargeOutput);
        lastProvider = "gpt5";
        return content;
      } else if (result.error) {
        error("GPT-5 error:", result.error);
        lastError = result.error;
      }
    } catch (err) {
      error("GPT-5 exception:", err.message);
      lastError = err.message;
    }
  }

  // MiniMax is the configured primary when MINIMAX_API_KEY is present. Set
  // MINIMAX_PRIMARY=false to keep the existing provider order while retaining
  // MiniMax as an available fallback in a future provider policy.
  if (minimax.configured() && minimax.getConfig().primary) {
    try {
      const result = await minimax.chat(
        [{ role: "system", content: systemPrompt }, ...messages],
        { maxTokens, temperature: 0.7 }
      );
      const content = withTruncationNotice(result.text, result.finishReason, "length", requestNeedsLargeOutput);
      lastProvider = "minimax";
      return content;
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message || "unknown MiniMax error";
      lastError = errMsg;
      error("MiniMax error:", errMsg);
    }
  }


  // Gemini unofficial API — no key needed, free tier
  try {
    const gemini = require("./geminiCli");
    const geminiResult = await gemini.sendMessage(String(userMessage));
    if (geminiResult.text) {
      const content = withTruncationNotice(geminiResult.text, null, "length", requestNeedsLargeOutput);
      lastProvider = "gemini-unofficial";
      return content;
    } else if (geminiResult.error) {
      error("Gemini unofficial error:", geminiResult.error);
    }
  } catch (err) {
    error("Gemini unofficial exception:", err.message);
  }



  // OpenAPIs — Free proxy to GPT-5 + Claude (no key needed)
  try {
    const openapis = require("./openapisCli");
    const openapisResult = await openapis.sendMessage(String(userMessage), userName, systemPrompt, { 
      model: process.env.OPENAPIS_MODEL || "openrouter/free" 
    });
    if (openapisResult.text) {
      const content = withTruncationNotice(openapisResult.text, null, "length", requestNeedsLargeOutput);
      lastProvider = "openapis";
      return content;
    } else if (openapisResult.retry) {
      error("OpenAPIs failing, will try next provider");
    }
  } catch (err) {
    error("OpenAPIs exception:", err.message);
  }

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
        const content = withTruncationNotice(res.data.choices[0]?.message?.content || "I got nothing. Try again.", finishReason, "length", requestNeedsLargeOutput);
        lastProvider = "cerebras";
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
        const content = withTruncationNotice(candidate?.content?.parts?.map((p) => p.text || "").join("") || "I got nothing. Try again.", candidate?.finishReason, "MAX_TOKENS", requestNeedsLargeOutput);
        lastProvider = "gemini";
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
  // Groq retires models without much notice, so the GROQ_MODELS chain (defined at
  // module scope) tries the next model automatically if the primary is deprecated.
  // Groq's free tier caps total tokens-per-minute at 8000 for some models, so it
  // gets a safer, lower cap than Gemini, which has much more headroom.
  const groqMaxTokens = Math.min(maxTokens, 6000);

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
        const content = withTruncationNotice(res.choices[0]?.message?.content || "I got nothing. Try again.", finishReason, "length", requestNeedsLargeOutput);
        lastProvider = "groq";
        return content;
      } catch (err) {
        error(`Groq error (${model}):`, err.message);
        // If it's a decommissioned-model error, try the next model in the list.
        // For any other error (rate limit, network, etc.), stop retrying and fall through to OpenRouter.
        if (!err.message?.includes("decommissioned")) break;
      }
    }
  }

  // Fallback to OpenRouter — the previous model ID (rouge-rose) was retired.
  // Free OpenRouter models rate-limit hard (shared quota), so the module-scope
  // OPENROUTER_MODELS chain lets a rate-limited model fall through to the next.
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
        lastProvider = "openrouter";
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

  // Keep provider names, model IDs, and quota/key details in server logs only.
  // They are debugging data, not a professional WhatsApp response.
  error("All configured AI chat providers failed:", lastError || "unknown");
  return "❌ I couldn't reach ARIA's chat brain right now. Please try again shortly; the server has recorded the provider failure.";
}

// ── Dashboard telemetry ─────────────────────────────────────
// Wrap the exported function (non-invasively) so every AI call records its
// latency and success to the dashboard telemetry layer. The original function
// is unchanged; this only adds a measurement around it. Safe: any telemetry
// failure is swallowed and never affects the AI response.
//
// FIX: `getAIResponseImpl` captures the REAL implementation (getAIResponseImpl,
// a distinct name) — not the wrapper. The previous code captured `getAIResponse`,
// which function-declaration hoisting resolved to the wrapper itself, producing
// infinite recursion → "Maximum call stack size exceeded" on every AI reply.
async function getAIResponse(...args) {
  const t0 = Date.now();
  lastProvider = "unknown";
  const out = await getAIResponseImpl(...args);
  try {
    const ok = typeof out === "string" && !out.startsWith("❌");
    const tel = require("./dashboardTelemetry");
    tel.record("ai", { ok, latency: Date.now() - t0, provider: ok ? lastProvider : "failed" });
    const platform = require("../core");
    const workspace = platform.bootstrapOwnerWorkspace();
    if (workspace) {
      platform.usage.record({
        tenantId: workspace.tenant.id,
        actorId: workspace.user.id,
        category: "ai",
        metric: "messages",
        units: 1,
        provider: ok ? lastProvider : "failed",
        metadata: { ok, latencyMs: Date.now() - t0, source: "aria-ai" },
      });
    }
  } catch (_) {}
  return out;
}

module.exports = { getAIResponse, needsLargeOutput, _test: { withTruncationNotice, TRUNCATION_NOTICE } };

