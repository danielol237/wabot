const axios = require("axios");

async function generateImage(prompt) {
  try {
    // Pollinations.ai — free, no API key, no rate limits
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true&enhance=true`;

    // Verify the image is accessible
    await axios.head(url, { timeout: 15000 });

    return { success: true, url };
  } catch (err) {
    console.error("Image gen error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generateImage };
