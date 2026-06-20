const axios = require("axios");

// Uses FreeTTS API (freetts.org) — free, no API key, no signup required.
// Switched from Google Translate's undocumented endpoint because: (1) it started
// returning 403 errors, (2) it has an undocumented ~200 char limit that required
// risky chunking, and (3) naively concatenating multiple MP3 chunks together
// produces a corrupted file, which was the root cause of "audio file is wrong" errors.
async function textToSpeech(text, voice = "en-US-JennyNeural") {
  try {
    // Step 1: submit the text, get back a file ID
    const submitRes = await axios.post(
      "https://freetts.org/api/tts",
      { text, voice, rate: "+0%", pitch: "+0Hz" },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const fileId = submitRes.data?.file_id;
    if (!fileId) return { success: false, error: "TTS service didn't return a file ID." };

    // Step 2: fetch the actual audio
    const audioRes = await axios.get(`https://freetts.org/api/audio/${fileId}`, {
      responseType: "arraybuffer",
      timeout: 20000,
    });

    return { success: true, buffer: Buffer.from(audioRes.data) };
  } catch (err) {
    console.error("TTS error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { textToSpeech };
