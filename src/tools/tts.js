const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const TEMP_DIR = path.join(__dirname, "../../temp");

// Converts text to speech using a free TTS endpoint, returns audio buffer
async function textToSpeech(text, lang = "en") {
  // Google Translate TTS has a ~200 char limit per request, so chunk if needed
  const MAX_CHARS = 200;
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_CHARS) {
    chunks.push(text.slice(i, i + MAX_CHARS));
  }
  // Cap at 3 chunks to avoid huge audio files / long requests
  const limitedChunks = chunks.slice(0, 3);

  try {
    const buffers = [];
    for (const chunk of limitedChunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${lang}&client=tw-ob`;
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
      });
      buffers.push(Buffer.from(res.data));
    }
    return { success: true, buffer: Buffer.concat(buffers) };
  } catch (err) {
    console.error("TTS error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { textToSpeech };
