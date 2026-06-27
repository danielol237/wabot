const Groq = require("groq-sdk");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Vision-capable models on Groq, in priority order. Groq retires preview models
// frequently with little notice (we already got burned twice — llama-3.2-90b-vision
// and llama-3.2-11b-vision were both decommissioned), so this tries each one in turn
// and only gives up after all options fail.
const VISION_MODELS = ["meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3.6-27b"];

// The old default prompt ("Describe this image in detail") produced flat content
// lists — "a man, a dog, a tree" — instead of actually explaining what's happening,
// the mood, the likely context, or anything someone would actually want to know.
// This version asks for genuine understanding: what's going on, why it matters,
// any text/emotion/action visible, not just an inventory of objects.
const DEFAULT_VISION_PROMPT = `Look at this image and actually explain what's happening in it — not just a list of objects. Cover:
- What's going on in the scene (the actual situation/action, not just "there is a X and a Y")
- Who/what is involved and what they appear to be doing or feeling
- Any text visible and what it says
- Context clues that explain WHY this image exists or what it's likely from (a meme, a screenshot, a photo of a real place, etc.)
- Anything notable, funny, unusual, or worth pointing out

Talk like you're explaining it to a friend who can't see it, not like you're filling out a checklist.`;

async function analyzeImage(base64Image, mimeType, question) {
  if (!groq) return "❌ No Groq API key configured.";

  let lastError = null;

  for (const model of VISION_MODELS) {
    try {
      const res = await groq.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: question || DEFAULT_VISION_PROMPT },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          },
        ],
        max_tokens: 1536,
      });
      return res.choices[0]?.message?.content || "I couldn't analyze that image.";
    } catch (err) {
      console.error(`Vision AI error (${model}):`, err.message);
      lastError = err;
      // If the model is gone, try the next one. For any other error type, stop and report it.
      if (!err.message?.includes("decommissioned") && !err.message?.includes("does not exist")) break;
    }
  }

  return `❌ Image analysis failed: ${lastError?.message || "unknown error"}`;
}

// OCR — reuses the same vision pipeline with a prompt tuned for accurate text extraction
async function extractText(base64Image, mimeType) {
  return analyzeImage(
    base64Image,
    mimeType,
    "Extract ALL text visible in this image, exactly as written, preserving line breaks. If there's no text, say 'No text found in this image.' Don't add commentary, just the extracted text."
  );
}

module.exports = { analyzeImage, extractText };

