const axios = require("axios");

// ElevenLabs as primary — real API with a genuine free tier (10k chars/month),
// much more reliable than FreeTTS which doesn't officially document CORS/server
// requirements and was failing with 403s. Falls back to FreeTTS if no ElevenLabs
// key is set, or if ElevenLabs itself fails (rate limit, quota, etc).
const ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" - default ElevenLabs voice

async function textToSpeech(text, voice = "en-US-JennyNeural") {
  if (process.env.ELEVENLABS_API_KEY) {
    const result = await elevenLabsTTS(text);
    if (result.success) return result;
    console.error("ElevenLabs failed, falling back to FreeTTS:", result.error);
  }
  return await freeTTS(text, voice);
}

async function elevenLabsTTS(text) {
  try {
    const res = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        responseType: "arraybuffer",
        timeout: 25000,
      }
    );
    return { success: true, buffer: Buffer.from(res.data) };
  } catch (err) {
    const errMsg = err.response?.data ? Buffer.from(err.response.data).toString("utf8").slice(0, 200) : err.message;
    return { success: false, error: errMsg };
  }
}

// Fallback if ElevenLabs isn't configured or fails — per their actual documented
// API shape (single POST, no key, returns MP3 directly, 20 req/min limit).
async function freeTTS(text, voice) {
  try {
    const res = await axios.post(
      "https://freetts.org/api/tts",
      { text, voice },
      {
        responseType: "arraybuffer",
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
      }
    );
    return { success: true, buffer: Buffer.from(res.data) };
  } catch (err) {
    console.error("FreeTTS error:", err.response?.status, err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

module.exports = { textToSpeech };

