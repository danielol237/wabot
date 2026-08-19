const axios = require("axios");
const minimax = require("./minimaxMedia");
const zai = require("./zaiMedia");

async function attachImageBuffer(result) {
  if (!result?.success || result.buffer || !result.url) return result;
  try {
    const response = await axios.get(String(result.url), {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 15 * 1024 * 1024,
      maxBodyLength: 15 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const contentType = String(response.headers["content-type"] || "image/jpeg").split(";")[0];
    if (!contentType.startsWith("image/")) throw new Error("provider returned a non-image response");
    return { ...result, buffer: Buffer.from(response.data), mimetype: contentType };
  } catch (error) {
    return { ...result, fetchError: error.message };
  }
}

async function generateImage(prompt) {
  if (minimax.configured() && process.env.MINIMAX_IMAGE_ENABLED !== "0") {
    const generated = await minimax.generateImage(prompt);
    if (generated.success) return attachImageBuffer(generated);
    console.warn("MiniMax image generation failed; trying Z.AI/Pollinations fallback:", generated.error);
  }
  if (zai.configured() && process.env.ZHIPU_IMAGE_ENABLED !== "0") {
    const generated = await zai.generateImage(prompt, { userId: "aria-image" });
    if (generated.success) return attachImageBuffer(generated);
    console.warn("Z.AI image generation failed; using Pollinations fallback:", generated.error);
  }
  try {
    // Pollinations.ai — free fallback when Z.AI is not configured.
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true&enhance=true`;
    await axios.head(url, { timeout: 15000 });
    return attachImageBuffer({ success: true, provider: "pollinations", url });
  } catch (err) {
    console.error("Image gen error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generateImage };
