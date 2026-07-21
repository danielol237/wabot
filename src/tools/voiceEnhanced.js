// ── Enhanced Voice Conversation ────────────────────────────
// ARIA can respond to voice notes with voice replies
// Uses ElevenLabs TTS + voice transcription

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const TEMP = path.join(__dirname, "../../temp");

// Get AI response as audio buffer
async function speakResponse(text, voiceId = "21m00Tcm4TlvDq8ikWAM") {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await axios.post(
      "https://api.elevenlabs.io/v1/text-to-speech/" + voiceId,
      { text, model_id: "eleven_monolingual_v1", voice_settings: { stability: 0.5, similarity_boost: 0.5 } },
      {
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        responseType: "arraybuffer",
        timeout: 30000,
      }
    );
    return Buffer.from(res.data);
  } catch (e) {
    console.error("TTS error:", e.message);
    return null;
  }
}

// Transcribe voice note to text
async function transcribeVoice(audioBuffer) {
  // Use the existing voice.js tool
  try {
    const { transcribeVoice } = require("./voice");
    return await transcribeVoice(audioBuffer);
  } catch (e) {
    return null;
  }
}

// Get available voices
async function listVoices() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await axios.get("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
      timeout: 10000,
    });
    return (res.data.voices || []).map(v => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
    }));
  } catch (e) {
    return [];
  }
}

module.exports = { speakResponse, transcribeVoice, listVoices };
