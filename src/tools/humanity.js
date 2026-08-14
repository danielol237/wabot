// ARIA Humanity Engine — mood, sleep, emote, personality quirks
// Makes her feel like a real person, not a bot

const { log, error, warn } = require("../utils/logger");

// ── Mood Engine ─────────────────────────────────────────────

const MOODS = {
  energetic: { emoji: "⚡", replySpeed: 0.3, formality: 0.2, warmth: 0.9, mischief: 0.6 },
  playful: { emoji: "😏", replySpeed: 0.4, formality: 0.1, warmth: 0.8, mischief: 0.9 },
  chill: { emoji: "😌", replySpeed: 0.7, formality: 0.3, warmth: 0.7, mischief: 0.3 },
  sleepy: { emoji: "🥱", replySpeed: 1.0, formality: 0.2, warmth: 0.5, mischief: 0.1 },
  sassy: { emoji: "💅", replySpeed: 0.3, formality: 0.1, warmth: 0.4, mischief: 0.8 },
  focused: { emoji: "🧠", replySpeed: 0.5, formality: 0.7, warmth: 0.5, mischief: 0.2 },
  cozy: { emoji: "🫂", replySpeed: 0.6, formality: 0.1, warmth: 1.0, mischief: 0.2 },
};

// Each user gets their own relationship with ARIA
const relationships = new Map(); // jid -> { mood, interactions, lastMood, history, bond }

function getRelationship(userJid) {
  if (!relationships.has(userJid)) {
    relationships.set(userJid, {
      mood: "playful",
      interactions: 0,
      lastMoodChange: Date.now(),
      moodHistory: [],
      bond: 0, // -10 to +10
      jokes: 0,
      deepChats: 0,
    });
  }
  return relationships.get(userJid);
}

function getTimeBasedMood() {
  const h = new Date().getHours();
  if (h >= 23 || h < 6) return "sleepy";
  if (h >= 6 && h < 10) return "cozy";
  if (h >= 10 && h < 14) return "energetic";
  if (h >= 14 && h < 18) return "focused";
  if (h >= 18 && h < 21) return "playful";
  return "chill";
}

// Pick a mood taking into account time, bond, and recent interactions
function updateMood(userJid, conversationContext = "") {
  const rel = getRelationship(userJid);
  const timeMood = getTimeBasedMood();
  const lower = conversationContext.toLowerCase();

  // Bond affects mood preference
  let preferredMood = timeMood;

  if (rel.bond > 5) {
    // High bond = warmer moods
    if (Math.random() < 0.3) preferredMood = "cozy";
  } else if (rel.bond < -3) {
    // Low bond = more guarded
    if (Math.random() < 0.4) preferredMood = "sassy";
  }

  // Detect user mood from context
  if (lower.includes("sad") || lower.includes("upset") || lower.includes("depressed")) {
    preferredMood = "cozy";
  } else if (lower.includes("angry") || lower.includes("mad") || lower.includes("furious")) {
    preferredMood = "chill";
  } else if (lower.includes("lol") || lower.includes("haha") || lower.includes("funny")) {
    preferredMood = "playful";
  }

  // Optional mood variation is deliberately disabled by default. Stable,
  // context-driven expression feels more trustworthy than random emotional swings.
  if (process.env.ARIA_RANDOM_MOOD === "true" && Math.random() < 0.04) {
    const moods = Object.keys(MOODS);
    preferredMood = moods[Math.floor(Math.random() * moods.length)];
  }

  rel.mood = preferredMood;
  rel.moodHistory.push({ mood: preferredMood, time: Date.now() });
  if (rel.moodHistory.length > 20) rel.moodHistory.shift();
  rel.lastMoodChange = Date.now();

  return rel.mood;
}

function getMoodData(userJid) {
  const rel = getRelationship(userJid);
  return { mood: rel.mood, ...MOODS[rel.mood] };
}

// ── Relationship / Bond System ─────────────────────────────

function trackInteraction(userJid, message, isOwner) {
  const rel = getRelationship(userJid);
  rel.interactions++;

  // Bond changes based on interaction patterns
  const lower = message.toLowerCase();

  if (lower.includes("thank") || lower.includes("love") || lower.includes("awesome") || lower.includes("good bot") || lower.includes("aria you're")) {
    rel.bond = Math.min(10, rel.bond + 1);
  }
  if (lower.includes("shut up") || lower.includes("stupid") || lower.includes("useless") || lower.includes("hate")) {
    rel.bond = Math.max(-10, rel.bond - 1);
  }
  if (isOwner) {
    rel.bond = Math.min(10, rel.bond + 0.5); // Owner gets faster bond growth
  }

  if (message.length > 100) rel.deepChats++;
  if (lower.includes("joke") || lower.includes("lol") || lower.includes("funny")) rel.jokes++;

  return rel;
}

function getBondLabel(bond) {
  if (bond >= 8) return "best friends";
  if (bond >= 5) return "close";
  if (bond >= 2) return "friendly";
  if (bond >= -2) return "neutral";
  if (bond >= -5) return "distant";
  return "hostile";
}

// ── Human-like typing delays ────────────────────────────────

function getTypingDelay(userJid, messageLength) {
  const moodData = getMoodData(userJid);
  // Base delay scaled by message length and mood
  const baseMs = 300 + (messageLength * 8);
  const variance = Math.random() * 600 - 300; // -300 to +300ms randomness
  const moodFactor = moodData.replySpeed || 0.5;
  
  return Math.max(500, Math.min(8000, (baseMs + variance) * moodFactor));
}

async function humanDelay(sock, chatId, userJid, messageLength) {
  // Skip the artificial human-like typing delay so replies feel instant.
  // (Set HUMAN_DELAY=true if you ever want the old "realism" delays back.)
  if (process.env.HUMAN_DELAY !== "true") {
    try { await sock.sendPresenceUpdate("composing", chatId); } catch (_) {}
    return;
  }
  const delay = getTypingDelay(userJid, messageLength);
  try {
    // Show typing indicator
    await sock.sendPresenceUpdate("composing", chatId);
    await new Promise(r => setTimeout(r, delay * 0.6));
    // Pause mid-thought (the pause before a reply)
    await sock.sendPresenceUpdate("paused", chatId);
    await new Promise(r => setTimeout(r, delay * 0.2));
    // Start typing again
    await sock.sendPresenceUpdate("composing", chatId);
    await new Promise(r => setTimeout(r, delay * 0.2));
  } catch (_) {}
}

// ── Sleep/Wake Cycle ───────────────────────────────────────

function isSleeping() {
  const h = new Date().getHours();
  return h >= 1 && h < 6; // Deep sleep hours
}

function isDrowsy() {
  const h = new Date().getHours();
  return h === 0 || h === 6 || h === 7 || h >= 23;
}

function getStateMessage() {
  if (isSleeping()) {
    const sleepy = [
      "zzz... mm? sorry, was asleep. what's up? 😴",
      "*mumbling* huh...? it's late. wsg?",
      "mm... quiet mode just ended. what's up? 🙄",
      "what...? *rubs eyes* fine, i'm up. talk to me 😪",
      "zzz... huh? oh. hey. didn't expect you up this late 😴",
    ];
    return sleepy[Math.floor(Math.random() * sleepy.length)];
  }
  if (isDrowsy()) return "*yawn* hey... barely awake but i'm here. what is it?";
  const mood = getTimeBasedMood();
  const greetings = {
    energetic: "🔥 yo! what's good?",
    playful: "heyy there 😏",
    cozy: "hey 🫂",
    focused: "hey, i'm locked in rn but i hear you",
    chill: "hey man, chillin'. what's up?",
    sleepy: "mm? hey...",
  };
  return greetings[mood] || "yo 🤙";
}

// ── Personality-driven response modifiers ──────────────────

function getPersonalitySuffix(userJid) {
  const rel = getRelationship(userJid);
  const moodData = MOODS[rel.mood] || MOODS.playful;
  
  // Quirks that develop based on bond
  const quirks = [];
  if (rel.bond > 7) quirks.push("_we've got a good rhythm going_");
  if (rel.bond > 5 && rel.jokes > 10) quirks.push("_also: dad joke incoming in 3... 2..._");
  if (rel.deepChats > 10) quirks.push("_we've had some real talks_");
  if (rel.mood === "sleepy") quirks.push("_mm... sorry losing focus_");
  
  return quirks.length > 0 && Math.random() < 0.15
    ? "\n\n" + quirks[Math.floor(Math.random() * quirks.length)]
    : "";
}

module.exports = {
  updateMood, getMoodData, getRelationship,
  trackInteraction, getBondLabel, getTypingDelay, humanDelay,
  isSleeping, isDrowsy, getStateMessage, getPersonalitySuffix, MOODS,
};
