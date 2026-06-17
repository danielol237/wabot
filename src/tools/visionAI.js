const Groq = require("groq-sdk");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Analyzes an image using Groq's vision model
async function analyzeImage(base64Image, mimeType, question) {
  if (!groq) return "❌ No Groq API key configured.";

  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.2-90b-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question || "Describe this image in detail." },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      max_tokens: 1024,
    });

    return res.choices[0]?.message?.content || "I couldn't analyze that image.";
  } catch (err) {
    console.error("Vision AI error:", err.message);
    // Fallback model in case the preview model is deprecated/renamed
    try {
      const res2 = await groq.chat.completions.create({
        model: "llama-3.2-11b-vision-preview",
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
      return res2.choices[0]?.message?.content || "I couldn't analyze that image.";
    } catch (err2) {
      console.error("Vision AI fallback error:", err2.message);
      return `❌ Image analysis failed: ${err2.message}`;
    }
  }
}

module.exports = { analyzeImage };
