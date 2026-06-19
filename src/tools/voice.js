const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const TEMP_DIR = path.join(__dirname, "../../temp");

// Transcribes a voice note buffer to text using Groq's Whisper model
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

module.exports = { transcribeVoice };
