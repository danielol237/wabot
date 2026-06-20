const Groq = require("groq-sdk");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Vision-capable models on Groq, in priority order. Groq retires preview models
// frequently with little notice (we already got burned twice — llama-3.2-90b-vision
// and llama-3.2-11b-vision were both decommissioned), so this tries each one in turn
// and only gives up after all options fail.
const VISION_MODELS = ["meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3.6-27b"];

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
              { type: "text", text: question || "Describe this image in detail." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          },
        ],
        max_tokens: 1024,
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

module.exports = { analyzeImage };
