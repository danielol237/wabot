// Consolidated voice module — transcription + TTS + voice listing
// Previously split across voice.js, voiceEnhanced.js, and tts.js

const Groq = require("groq-sdk");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { log, error, warn } = require("../utils/logger");

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
    error("Transcription error:", err.message);
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
    error("ElevenLabs failed, falling back to FreeTTS:", result.error);
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
    error("FreeTTS error:", err.response?.status, err.message);
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

// ── Voice Conversation (transcribe → think → speak) ─────────
// Full voice-to-voice: user sends voice note, gets voice response back

async function voiceConversation(audioBuffer, senderName, chatId, isOwner) {
  // Step 1: Transcribe
  const transcription = await transcribeVoice(audioBuffer);
  if (!transcription.success) return { error: transcription.error };
  
  // Step 2: Get AI response using the transcribed text
  try {
    const { getAIResponse } = require("./ai");
    const { getFactsContext } = require("../utils/learnedFacts");
    const { getPreferences } = require("../utils/userPreferences");
    
    const preferences = getPreferences(chatId);
    const facts = getFactsContext(chatId);
    const ownerContext = isOwner
      ? "\n\nIMPORTANT: The person talking to you via voice right now is Daniel — your FATHER and CREATOR. Be extra sweet and playful."
      : "";
    
    const aiResponse = await getAIResponse(
      transcription.text,
      senderName,
      [],
      null,
      ownerContext + "\n\n(This is a voice conversation — keep your reply conversational and speakable, not too long. Use natural pauses.)",
      { preferences, facts }
    );
    
    if (!aiResponse) return { error: "AI response failed" };
    
    // Step 3: Convert response to speech
    const audio = await textToSpeech(aiResponse);
    if (!audio || !audio.success) {
      // Return text as fallback
      return { text: aiResponse, transcription: transcription.text };
    }
    
    return { audio: audio.buffer, text: aiResponse, transcription: transcription.text };
  } catch (err) {
    console.error("Voice conversation error:", err.message);
    return { error: err.message, transcription: transcription.text };
  }
}

module.exports = { transcribeVoice, textToSpeech, listVoices, voiceConversation };
