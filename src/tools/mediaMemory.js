// ── ARIA Media Memory (multimodal personality) ─────────────────
// Lets ARIA remember the CONTENT of media she's seen/heard, not just text.
// When a user shares an image or voice note, ARIA analyzes it, stores a
// searchable memory of what it contained, and pulls it back later for context.
// This makes her feel personally aware across images + voice, not just chat.

const fs = require("fs");
const path = require("path");
const { error } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "mediaMemory.json");

// { [userId]: [ { id, kind: 'image'|'voice', summary, keywords[], ts } ] }
let db = {};
try {
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  error("Media memory file corrupt, starting fresh:", err.message);
  db = {};
}
if (!db || typeof db !== "object") db = {};

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); } catch (err) { error("Failed to save media memory:", err.message); }
}

function userStore(userId) {
  if (!db[userId]) db[userId] = [];
  return db[userId];
}

const STOP = new Set(["the","a","an","is","are","was","were","and","or","of","in","on","at","to","for","with","this","that","it","from","by","you","your","my","i","me","we","our"]);
function keywords(text, max = 8) {
  return (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w)).slice(0, max);
}

// Analyze and remember an image. Returns the stored memory.
async function rememberImage(userId, base64, mimeType, question) {
  try {
    const { analyzeImage } = require("./visionAI");
    const description = await analyzeImage(base64, mimeType, question || "Describe what's in this image in 1-2 sentences.");
    const entry = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      kind: "image",
      summary: typeof description === "string" ? description.slice(0, 300) : String(description).slice(0, 300),
      keywords: keywords(description),
      ts: Date.now(),
    };
    const store = userStore(userId);
    store.push(entry);
    if (store.length > 100) db[userId] = store.slice(-100);
    save();
    return entry;
  } catch (err) {
    error("rememberImage error:", err.message);
    return null;
  }
}

function rememberObservation(userId, summary, metadata = {}) {
  try {
    const text = String(summary || "").trim();
    if (!text || /^❌/.test(text)) return null;
    const entry = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      kind: metadata.kind || "image",
      summary: text.slice(0, 500),
      keywords: keywords(text),
      ts: Date.now(),
      mimeType: metadata.mimeType || null,
      question: String(metadata.question || "").slice(0, 300),
    };
    const store = userStore(userId);
    store.push(entry);
    if (store.length > 100) db[userId] = store.slice(-100);
    save();
    return entry;
  } catch (err) {
    error("rememberObservation error:", err.message);
    return null;
  }
}

// Analyze and remember a voice note (store its transcription).
async function rememberVoice(userId, audioBuffer, mimetype) {
  try {
    const { transcribeVoice } = require("./voice");
    const transcript = await transcribeVoice(audioBuffer, mimetype);
    const entry = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      kind: "voice",
      summary: String(transcript || "").slice(0, 300),
      keywords: keywords(transcript),
      ts: Date.now(),
    };
    const store = userStore(userId);
    store.push(entry);
    if (store.length > 100) db[userId] = store.slice(-100);
    save();
    return entry;
  } catch (err) {
    error("rememberVoice error:", err.message);
    return null;
  }
}

// Recall media memories relevant to a text query.
function recallMedia(userId, query, limit = 4) {
  const store = userStore(userId);
  if (!store.length) return [];
  const qw = new Set(keywords(query, 20));
  const scored = store.map((e) => {
    let score = 0;
    for (const k of e.keywords) if (qw.has(k)) score++;
    score += Math.min(1, (Date.now() - e.ts) / (1000 * 60 * 60 * 24 * 30)) * 0.3;
    return { e, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  return scored.slice(0, limit).map((s) => s.e);
}

function getAllMedia(userId, limit = 20) {
  return userStore(userId).slice(-limit).reverse();
}

function stats() {
  const users = Object.keys(db);
  return { users: users.length, total: users.reduce((s, u) => s + db[u].length, 0) };
}

module.exports = { rememberImage, rememberObservation, rememberVoice, recallMedia, getAllMedia, stats };
