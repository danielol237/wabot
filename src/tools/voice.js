// Consolidated voice module — transcription + TTS + voice listing
// Previously split across voice.js, voiceEnhanced.js, and tts.js

const Groq = require("groq-sdk");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const TEMP_DIR = path.join(__dirname, "../../temp");
const ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" default

// ── Transcription ─────────────────────────────────────────────

async function transcribeVoice(audioBuffer, mimetype = "audio/ogg") {
  if (!groq) return { success: false, error: "No Groq API key configured." };

  const id = uuidv4();
  const ext = mimetype.includes("ogg") ? "ogg" : mimetype.includes("mp3") ? "mp3" : "m4a";
  const filePath = path.join(TEMP_DIR, `${id}.${ext}`);

  try {
    fs.writeFileSync(filePath, audioBuffer);
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-large-v3",
    });
    return { success: true, text: transcription.text };
  } catch (err) {
    console.error("Transcription error:", err.message);
    return { success: false, error: err.message };
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

// ── Text-to-Speech ────────────────────────────────────────────
// ElevenLabs as primary, falls back to FreeTTS

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
    const errMsg = err.response?.data
      ? Buffer.from(err.response.data).toString("utf8").slice(0, 200)
      : err.message;
    return { success: false, error: errMsg };
  }
}

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

// ── Voice listing ─────────────────────────────────────────────

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

module.exports = { transcribeVoice, textToSpeech, listVoices };
