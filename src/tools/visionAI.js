const Groq = require("groq-sdk");
const axios = require("axios");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const zai = require("./zaiMedia");
const providerHealth = require("./providerHealth");
const nativeMedia = require("./nativeMedia");

function providerAvailable(name) {
  try { return providerHealth.isAvailable(name); } catch (_) { return true; }
}

const VISION_MODELS = ["meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3.6-27b"];
const OPENROUTER_VISION_MODEL = "google/gemini-3.1-pro-preview";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_VISION_PROMPT = `Look at this media and explain what is actually happening, not just a list of objects. Cover the visible action, people or characters, expressions, any readable text, the emotional tone, and useful context clues. Distinguish what is clearly visible from what is only an inference. Talk like you're explaining it to a friend who cannot see it.`;

function cleanText(value, max = 8000) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function asksForDetails(question) {
  return /\b(?:what(?:'s| is)\s+(?:in|shown|happening)|describe|explain\s+(?:the\s+)?(?:image|sticker|picture|meme)|read\s+(?:the\s+)?text|what does it say|exact(?:ly)?\s+what)\b/i.test(String(question || ""));
}

function asksHowVisionWorks(question) {
  return /\b(?:how|why)\s+(?:can|do|are you able to)\s+(?:you|aria)\s+(?:read|see|understand|know)|how did you read|are you seeing this|can you actually see/i.test(String(question || ""));
}

function fallbackReaction(kind = "image") {
  return kind === "sticker" ? "Nahhh 😭" : "I see it 😭";
}

function stripInternalReasoning(value) {
  let text = String(value || "").replace(/\u0000/g, "").trim();
  // Some vision endpoints expose hidden reasoning as an XML-style block. If
  // the provider omits the closing tag, everything after <think> is internal.
  text = text.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "");
  text = text.replace(/<analysis\b[^>]*>[\s\S]*?(?:<\/analysis>|$)/gi, "");
  text = text.replace(/```(?:analysis|reasoning|thinking)[\s\S]*?```/gi, "");
  return text.replace(/^[ \t]*<(?:think|analysis|reasoning)>[\s\S]*$/gim, "").trim();
}

function compactVisualReply(value, kind) {
  const text = stripInternalReasoning(value);
  if (!text) return fallbackReaction(kind);
  const reasoningLeak = /(?:the user sent|given the previous context|i need to respond|i should respond|possible angles|possible replies|let me think|the sticker is|the image is likely a reaction)/i.test(text);
  if (reasoningLeak) {
    const quoted = text.match(/[“"]([^“”"]{2,220})[”"]/);
    if (quoted && !/(?:possible|angle|option|should|need to)/i.test(quoted[1])) return quoted[1].trim();
    return fallbackReaction(kind);
  }
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const compact = sentences.slice(0, 2).join(" ").trim().slice(0, 280).trim();
  return compact || fallbackReaction(kind);
}

function sanitizeVisionReply(value, { kind = "image", question = "" } = {}) {
  const clean = stripInternalReasoning(value);
  if (!asksForDetails(question) && !asksHowVisionWorks(question)) return compactVisualReply(clean, kind);
  return clean.slice(0, 4000).trim() || fallbackReaction(kind);
}

function buildVisionPrompt({ question = "", kind = "image", history = [], quotedContext = "" } = {}) {
  const userQuestion = cleanText(question, 1200);
  const detailMode = asksForDetails(userQuestion);
  const howMode = asksHowVisionWorks(userQuestion);
  const recent = Array.isArray(history)
    ? history.filter((item) => item && typeof item.content === "string").slice(-4).map((item) => `${item.role || "user"}: ${cleanText(item.content, 500)}`).join("\n")
    : "";

  return `You are ARIA, a sharp, emotionally expressive humanoid AI companion inside WhatsApp. A user sent a ${kind === "sticker" ? "sticker" : "piece of visual media"}.

Conversation context:
${recent || "(no earlier text)"}
${quotedContext ? `Quoted context:\n${cleanText(quotedContext, 800)}\n` : ""}
User's current text: ${userQuestion || "(no text; they only sent the media)"}

Response policy:
- If there is no explicit question, reply naturally to the emotional or comedic meaning of the ${kind}, as if you are participating in the conversation. Do not begin with “I see an image”, “This sticker shows”, or a dry object inventory. Keep it to one or two lively lines unless the media genuinely needs explanation.
- If the user asks what is in it, describes it, asks what it says, or asks for exact details, switch to precise visual reporting: identify characters/people, pose, facial expression, clothing, colors, background, visible text, action, and likely meme/emotional context. Clearly label uncertainty instead of inventing details.
- If the user asks how you can read it, explain plainly that WhatsApp supplied the media bytes and a vision model interpreted the pixels and text. Do not claim human eyesight, a physical body, or literal consciousness.
- If it is a meme or reaction sticker, respond to the implied feeling or joke first. Mention visual details only when useful or requested.
- Never pretend to have read text that is too small or obscured. Say exactly what is legible and what is not.
- Match the user's energy. Be warm, witty, blunt, or sympathetic when appropriate, but do not become cruel.
${detailMode ? "The user requested details: prioritize accurate observation over banter." : "The user did not request a visual inventory: prioritize a genuine conversational reaction."}
${howMode ? "The user is asking about your visual process: answer that directly and honestly after briefly acknowledging the media." : ""}

Return only ARIA's WhatsApp reply, with no analysis labels or provider commentary.`;
}

async function analyzeWithOpenRouter(base64Image, mimeType, prompt) {
  if (!String(process.env.OPENROUTER_API_KEY || "").trim()) return null;
  try {
    const response = await axios.post(
      OPENROUTER_ENDPOINT,
      {
        model: OPENROUTER_VISION_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        }],
        max_tokens: 1800,
        temperature: 0.65,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://aria.local",
          "X-Title": "ARIA Visual Companion",
        },
        timeout: 60000,
      }
    );
    const text = response.data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch (error) {
    providerHealth.recordFailure("OpenRouter", error);
    console.warn("OpenRouter vision error:", error.response?.data?.error?.message || error.message);
    return null;
  }
}

async function analyzeImage(base64Image, mimeType = "image/jpeg", question, options = {}) {
  const kind = options.kind || "image";
  const prompt = options.prompt || buildVisionPrompt({ question, kind, history: options.history, quotedContext: options.quotedContext });

  if (zai.configured() && providerAvailable("Z.AI")) {
    const startedAt = Date.now();
    const result = await zai.analyzeImage(base64Image, mimeType, prompt, { maxTokens: 1800 });
    if (result.success) {
      providerHealth.recordSuccess("Z.AI", { latency: Date.now() - startedAt });
      return sanitizeVisionReply(result.text, { kind, question });
    }
    providerHealth.recordFailure("Z.AI", result.error, { latency: Date.now() - startedAt });
    console.warn("Z.AI vision error:", result.error);
  }

  if (groq && providerAvailable("Groq")) {
    for (const model of VISION_MODELS) {
      const startedAt = Date.now();
      try {
        const res = await groq.chat.completions.create({
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          }],
          max_tokens: 1800,
          temperature: 0.65,
        });
        const text = res.choices[0]?.message?.content;
        if (text) {
          providerHealth.recordSuccess("Groq", { latency: Date.now() - startedAt });
          return sanitizeVisionReply(text, { kind, question });
        }
        throw new Error("Groq vision returned an empty response");
      } catch (error) {
        providerHealth.recordFailure("Groq", error);
        console.warn(`Vision AI error (${model}):`, error.message);
        continue;
      }
    }
  }

  const openRouterText = await analyzeWithOpenRouter(base64Image, mimeType, prompt);
  if (openRouterText) {
    providerHealth.recordSuccess("OpenRouter", { latency: 0 });
    return sanitizeVisionReply(openRouterText, { kind, question });
  }
  if (String(process.env.ZHIPU_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || "").trim()) {
    return "I received the visual, but the vision routes are unavailable right now. Send it again in a moment.";
  }
  try {
    const local = await nativeMedia.inspectImage(Buffer.from(base64Image, "base64"));
    const dimensions = local.width && local.height ? ` It is ${local.width}×${local.height}${local.animated ? " animated" : ""} ${local.format || "image"} media.` : "";
    return `I received the visual, but semantic vision is not configured on this deployment yet.${dimensions} I won't pretend I can identify the scene or read text without a local vision model or a configured multimodal provider.`;
  } catch (_) {
    return "I received the visual, but semantic vision is not configured on this deployment yet.";
  }
}

async function respondToMedia(base64Image, mimeType, options = {}) {
  return analyzeImage(base64Image, mimeType, options.question || "", options);
}

async function extractText(base64Image, mimeType) {
  return analyzeImage(base64Image, mimeType, "Extract all legible text visible in this image exactly as written. If text is too small or obscured, say so. Do not add commentary.", { kind: "image" });
}

module.exports = {
  analyzeImage,
  respondToMedia,
  extractText,
  _test: { buildVisionPrompt, asksForDetails, asksHowVisionWorks, stripInternalReasoning, compactVisualReply, sanitizeVisionReply, fallbackReaction, OPENROUTER_VISION_MODEL },
};
