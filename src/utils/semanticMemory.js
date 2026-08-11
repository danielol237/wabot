// ── ARIA Semantic Memory ───────────────────────────────────────
// Long-term memory that works like a person's: important facts, events,
// people, and context get stored permanently and pulled back in when
// relevant. Unlike the per-chat text history (last 30 messages), this
// survives and is retrieved by topic/keyword so ARIA remembers across days.

const fs = require("fs");
const path = require("path");
const { log, error, warn } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "semanticMemory.json");

// { [userId]: { memories: [ {id, text, keywords[], type, importance, ts} ], profile: {...} } }
let db = {};
try {
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  error("Semantic memory file corrupt, starting fresh:", err.message);
  db = {};
}

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); } catch (err) { error("Failed to save semantic memory:", err.message); }
}

function getUserStore(userId) {
  if (!db[userId]) {
    db[userId] = { memories: [], profile: {} };
    save();
  }
  return db[userId];
}

// Expose the raw store map so the memory curator can run a global pass over it.
function getAllStores() {
  return db;
}

// ── Core: store a memory with keyword extraction ───────────────
const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","and","or","but","i","you","he","she","it",
  "we","they","me","him","her","us","them","my","your","his","its","our","their",
  "to","of","in","on","for","with","at","by","from","about","that","this","just",
  "like","have","has","had","do","does","did","will","would","can","could","should",
  "what","when","where","why","how","who","very","really","got","get","going","lol",
  "haha","omg","bro","man","dude","yeah","yes","no","ok","okay","please","im","ive",
  "ill","dont","cant","wont","id","theres","its","youre",
]);

function extractKeywords(text, max = 8) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'\-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    .slice(0, max);
}

function addMemory(userId, text, type = "fact", importance = 1) {
  const store = getUserStore(userId);
  const keywords = extractKeywords(text);
  const mem = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    text,
    keywords,
    type,            // fact | event | person | preference | project
    importance,      // 1 (low) - 3 (high)
    ts: Date.now(),
  };
  store.memories.push(mem);
  // Bound the store — keep the most recent 500
  if (store.memories.length > 500) store.memories = store.memories.slice(-500);
  save();
  return mem;
}

// ── Retrieve memories relevant to a query ─────────────────────
function retrieveMemories(userId, query, limit = 5) {
  const store = getUserStore(userId);
  if (store.memories.length === 0) return [];

  const queryWords = new Set(extractKeywords(query, 20));
  if (queryWords.size === 0) return store.memories.slice(-limit);

  const scored = store.memories.map((m) => {
    let score = 0;
    for (const kw of m.keywords) {
      if (queryWords.has(kw)) score += 1;
    }
    // Recent memories get a small boost (age in days, capped at 30, so
    // fresher memories score higher — 0 days = full 0.3, 30+ days = 0).
    const ageDays = (Date.now() - m.ts) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 1 - ageDays / 30) * 0.3;
    return { m, score };
  });

  const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (relevant.length === 0) return [];

  return relevant.slice(0, limit).map((s) => s.m);
}

// Build context string of relevant memories for a given message
function getRelevantContext(userId, message) {
  const relevant = retrieveMemories(userId, message, 5);
  if (relevant.length === 0) return "";
  const lines = relevant.map((m) => `• ${m.text}`).join("\n");
  return `\n\n[Things I remember about this person that are relevant right now:]\n${lines}`;
}

// ── Auto-extract important memories from a conversation turn ──
// Called with each user message — detects high-signal statements and stores
// them so they're retrievable later.
const IMPORTANT_HINTS = [
  /\b(im|i am|i'm)\s+(working|building|making|creating|starting|planning|learning|studying|applying|moving|traveling|going)\b/i,
  /\b(my|our)\s+(birthday|exam|test|interview|appointment|flight|project|deadline|job|wedding|meeting)\b/i,
  /\b(i|we)\s+(love|hate|prefer|like)\s/i,
  /\b(remember|don't forget|note that|important)\b/i,
  /\b(called|named|my name is|his name is|her name is)\b/i,
];

function autoExtractMemory(userId, userName, text) {
  if (!text || text.length < 12) return;

  // Personalization: learn the name ARIA is called
  const nameMatch = text.match(/\b(call me|call her|call him|my name is|im called)\s+([a-z]+)/i);
  if (nameMatch) {
    getUserStore(userId).profile.nickname = nameMatch[2];
    save();
  }

  // Learn timezone hints ("in Ghana", "my time is", "it's 8pm here")
  if (/\b(in\s+[a-z]+\s*[,.]?)\b/i.test(text) && /\b(time|am|pm|clock)\b/i.test(text)) {
    const tz = text.match(/in\s+([a-z\s]{2,20})[,.]?/i)?.[1]?.trim();
    if (tz) { getUserStore(userId).profile.location = tz; save(); }
  }

  // Detect important statements worth storing
  const typeGuess = /\b(birthday|exam|interview|flight|appointment|deadline|job|wedding)\b/i.test(text)
    ? "event"
    : /\b(project|building|app|website|working on)\b/i.test(text)
      ? "project"
      : /\b(love|hate|prefer|like)\b/i.test(text)
        ? "preference"
        : "fact";

  const isImportant = IMPORTANT_HINTS.some((re) => re.test(text));
  if (isImportant) {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 160);
    addMemory(userId, `${userName}: ${clean}`, typeGuess, typeGuess === "event" ? 3 : 2);
  }
}

// ── Profile / personalization ─────────────────────────────────
function getProfile(userId) {
  const store = getUserStore(userId);
  if (!store.profile) store.profile = {};
  return store.profile;
}

function setProfileField(userId, field, value) {
  getUserStore(userId).profile[field] = value;
  save();
}

function getProfileContext(userId) {
  const store = getUserStore(userId);
  const p = store.profile || {};
  const parts = [];
  if (p.nickname) parts.push(`You call this person ${p.nickname}.`);
  if (p.location) parts.push(`They're based in ${p.location}.`);
  if (p.communicationStyle) parts.push(`They tend to be ${p.communicationStyle} in conversation.`);
  if (p.nameForAria) parts.push(`They call you ${p.nameForAria}.`);
  if (parts.length === 0) return "";
  return `\n\n[What I've learned about this person:] ${parts.join(" ")}`;
}

// ── Communication style learning (personalization engine) ─────
function learnCommunicationStyle(userId, userName, text) {
  const store = getUserStore(userId);
  const p = store.profile || {};
  const lower = text.toLowerCase();

  let style = p.communicationStyle || "neutral";
  if (lower.split(/\s+/).length < 4) style = "brief";
  else if (/\b(can you|please|could you|would you)\b/.test(lower)) style = "polite";
  else if (/\b(fuck|shit|damn|wtf|bro|man|dude)\b/.test(lower)) style = "casual";
  else if (text.length > 100) style = "detailed";

  // Only update if we have a signal (don't overwrite "brief" with every short message)
  if (lower.split(/\s+/).length < 4 || /\b(fuck|shit|damn|wtf|can you|please)\b/.test(lower)) {
    p.communicationStyle = style;
    save();
  }
}

module.exports = {
  addMemory, retrieveMemories, getRelevantContext,
  autoExtractMemory, getProfile, setProfileField,
  getProfileContext, learnCommunicationStyle, getUserStore, getAllStores, save,
};
