const axios = require("axios");
const venice = require("./veniceMedia");
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
    const contentType = String(response.headers["content-type"] || "image/jpeg").split(";")[0].toLowerCase();
    if (!contentType.startsWith("image/")) throw new Error("provider returned a non-image response");
    const buffer = Buffer.from(response.data);
    if (!buffer.length) throw new Error("provider returned an empty image");
    return { ...result, buffer, mimetype: contentType };
  } catch (error) {
    return {
      ...result,
      success: false,
      error: `image download failed: ${String(error?.message || error).slice(0, 300)}`,
      fetchError: String(error?.message || error).slice(0, 300),
    };
  }
}

async function generateImage(prompt) {
  const failures = [];
  if (venice.configured() && process.env.VENICE_IMAGE_ENABLED !== "0") {
    const generated = await venice.generateImage(prompt);
    if (generated.success && (generated.buffer || generated.url)) return generated;
    failures.push(`Venice: ${generated.error || "no usable image"}`);
    console.warn("Venice image generation failed; trying MiniMax/Z.AI/Pollinations fallback:", generated.error);
  }
  if (minimax.configured() && process.env.MINIMAX_IMAGE_ENABLED !== "0") {
    const generated = await minimax.generateImage(prompt);
    if (generated.success) {
      const hydrated = await attachImageBuffer(generated);
      if (hydrated.success && (hydrated.buffer || hydrated.url)) return hydrated;
      failures.push(`MiniMax: ${hydrated.error || hydrated.fetchError || "no usable image"}`);
    } else {
      failures.push(`MiniMax: ${generated.error || "request failed"}`);
    }
    console.warn("MiniMax image generation failed; trying Z.AI/Pollinations fallback:", generated.error);
  }
  if (zai.configured() && process.env.ZHIPU_IMAGE_ENABLED !== "0") {
    const generated = await zai.generateImage(prompt, { userId: "aria-image" });
    if (generated.success) {
      const hydrated = await attachImageBuffer(generated);
      if (hydrated.success && (hydrated.buffer || hydrated.url)) return hydrated;
      failures.push(`Z.AI: ${hydrated.error || hydrated.fetchError || "no usable image"}`);
    } else {
      failures.push(`Z.AI: ${generated.error || "request failed"}`);
    }
    console.warn("Z.AI image generation failed; using Pollinations fallback:", generated.error);
  }
  try {
    // Pollinations.ai — free fallback when paid providers are not configured.
    // Use a real GET because some CDN edges reject HEAD even when the image is
    // available. Returning the downloaded bytes also avoids a second transient
    // provider fetch inside WhatsApp.
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true&enhance=true`;
    const fetched = await attachImageBuffer({ success: true, provider: "pollinations", url });
    if (!fetched.buffer) throw new Error(fetched.fetchError || "Pollinations returned no usable image");
    return fetched;
  } catch (err) {
    failures.push(`Pollinations: ${String(err?.message || err).slice(0, 300)}`);
    console.error("Image gen error:", failures.join(" | "));
    return { success: false, error: failures.join(" | ") || "No image provider is available" };
  }
}

module.exports = { generateImage };
