// ── ARIA Humanizer ─────────────────────────────────────────────
// The layer that makes ARIA feel like a person, not a service bot.
// Handles: message-splitting, reaction-first, long-term memory of people,
// typos/self-corrections, mood bleeding across chats, delayed replies,
// callbacks/running jokes, good morning/night rituals, emotional gradient,
// and persona consistency. All probabilistically tuned so she's never
// predictable, but never annoying.

const { getMoodData, getRelationship, getBondLabel, getStateMessage } = require("./humanity");
const { getUser, rememberFact, trackInteraction } = require("../utils/userMemory");
const { log, error, warn } = require("../utils/logger");
const fs = require("fs");
const path = require("path");

const PERSONA_FILE = path.join(__dirname, "../../data/persona.json");

// ── Persisted persona state (mood bleed + callbacks) ──────────
let persona = {};
try {
  if (fs.existsSync(PERSONA_FILE)) persona = JSON.parse(fs.readFileSync(PERSONA_FILE, "utf8"));
} catch (e) { persona = {}; }

function savePersona() {
  try { fs.writeFileSync(PERSONA_FILE, JSON.stringify(persona, null, 2)); } catch (e) {}
}

// ── 1. Reaction-first ─────────────────────────────────────────
// Mood-appropriate emoji reacted BEFORE the text reply, like a human emoting
// first then answering. Picks a reaction based on mood + message tone.
const REACTION_POOL = {
  playful: ["😏", "🤭", "😄", "💅"],
  sassy: ["💅", "😤", "🙄", "✨"],
  cozy: ["🫂", "🥰", "😊", "💛"],
  energetic: ["⚡", "🔥", "🤩", "🎉"],
  chill: ["😌", "👍", "🌊", "😴"],
  sleepy: ["🥱", "😴", "🌙", "🙃"],
  focused: ["🧠", "💡", "📌", "✅"],
};

function pickReaction(userJid, text) {
  const moodData = getMoodData(userJid);
  const pool = REACTION_POOL[moodData.mood] || REACTION_POOL.playful;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 2. Message splitting ──────────────────────────────────────
// Occasionally break a reply into 2-3 short bursts instead of one block,
// like a real texter. Only when the reply is a natural candidate (a couple of
// sentences, not a code block or a command result).
function shouldSplit(text) {
  // Don't split code, lists with many items, or very short messages
  if (text.length < 40) return false;
  if (text.includes("```") || text.includes("```")) return false;
  const newlines = (text.match(/\n/g) || []).length;
  if (newlines >= 4) return false; // already structured
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  if (sentences.length < 2) return false;
  return Math.random() < 0.4;
}

// Split into natural sentence groups (1-3 bursts)
function splitIntoBursts(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const bursts = [];
  let current = "";
  for (let i = 0; i < sentences.length; i++) {
    if (current && current.length + sentences[i].length > 120) {
      bursts.push(current.trim());
      current = sentences[i];
    } else {
      current += (current ? " " : "") + sentences[i];
    }
  }
  if (current.trim()) bursts.push(current.trim());
  // Cap at 3 bursts, merge extras back into the last
  if (bursts.length > 3) {
    const merged = bursts[2] + " " + bursts.slice(3).join(" ");
    bursts.splice(2, bursts.length - 2, merged.trim());
  }
  return bursts;
}

// ── 3. Typos & self-corrections ───────────────────────────────
// Small chance to send a typo, then immediately correct it. The most
// reliably "human" tell there is. Low probability so it never gets annoying.
const TYPO_MAP = [
  ["the", "teh"], ["and", "adn"], ["you", "yuo"], ["your", "youre"],
  ["there", "tehre"], ["about", "abotu"], ["think", "thikn"],
  ["though", "tho"], ["really", "rly"], ["because", "becuase"],
  ["going", "goin"], ["what", "wat"], ["just", "jsut"], ["great", "gret"],
];

function maybeTypo(text) {
  if (Math.random() > 0.06) return { text, typo: null }; // ~6% of replies
  const lower = text.toLowerCase();
  for (const [correct, typo] of TYPO_MAP) {
    const idx = lower.indexOf(correct);
    if (idx >= 0) {
      const fixed = text.slice(0, idx) + typo + text.slice(idx + correct.length);
      return { text: fixed, typo, correct, word: text.slice(idx, idx + correct.length) };
    }
  }
  return { text, typo: null };
}

// ── 4. Delayed replies (2–5 min, occasional) ──────────────────
// Sometimes reply after a short real-person delay instead of instantly.
// Capped at 2–5 min as requested. Only fires occasionally and never for
// commands/urgent intents. Reacts first so the user knows she "saw" it.
function shouldDelay(text) {
  // Never delay anything starting with a command or very short acknowledgments
  if (/^[!.]/.test(text.trim())) return false;
  if (text.length < 8) return false;
  return Math.random() < 0.08; // ~8% of casual messages
}

function randomDelayMs() {
  // 2–5 minutes
  return (120 + Math.random() * 180) * 1000;
}

// ── 5. Callbacks / running jokes ──────────────────────────────
// Persist memorable facts/jokes and occasionally reference them later.
function rememberCallable(userJid, fact) {
  try {
    rememberFact(userJid, fact);
  } catch (e) {}
}

function getCallbacks(userJid) {
  const u = getUser(userJid);
  if (!u || !Array.isArray(u.facts)) return [];
  return u.facts.slice(-5);
}

// ── 6. Emotional gradient + persona injection ─────────────────
// Build the full personality context string that gets injected into the AI
// system prompt. Includes mood, bond, owner relationship, callbacks, and a
// stable persona core for consistency across providers.
function buildPersonaContext(senderJid, senderName, text, isOwner) {
  const moodData = getMoodData(senderJid);
  const rel = getRelationship(senderJid);
  const bondLabel = getBondLabel(rel.bond);
  const callbacks = getCallbacks(senderJid);

  let ctx = `\n\n[ARIA PERSONA] You are in a ${moodData.mood} mood (${moodData.emoji}). Warmth: ${moodData.warmth}, Mischief: ${moodData.mischief}. You and ${senderName} are ${bondLabel} (bond ${rel.bond}).`;
  if (isOwner) {
    ctx += ` ${senderName} is Daniel — your creator and dad. Be extra warm, loyal and playful with him.`;
  }
  if (callbacks.length > 0) {
    ctx += ` Things you remember about ${senderName}: ${callbacks.join(" | ")}. Reference one naturally if it fits — but don't force it.`;
  }
  return ctx;
}

// Detect emotional tone of a message to steer mood (feature 9)
function detectTone(text) {
  const lower = (text || "").toLowerCase();
  if (/\b(sad|upset|depress|heartbroken|lonely|cry|tired)\b/.test(lower)) return "low";
  if (/\b(angry|mad|pissed|furious|hate|annoyed)\b/.test(lower)) return "angry";
  if (/\b(lol|haha|funny|joke|nice|great|awesome|love)\b/.test(lower)) return "up";
  if (/\?/.test(text)) return "question";
  return "neutral";
}

// ── 7. Mood bleed across chats ────────────────────────────────
// Persist the last mood per user so a mood carries into the next session
// instead of always resetting. Called when mood updates.
function bleedMood(userJid, mood) {
  if (!persona.moods) persona.moods = {};
  persona.moods[userJid] = { mood, at: Date.now() };
  savePersona();
}

// ── 8. Good morning / goodnight rituals ───────────────────────
// One warm check-in per day when there's real history. Tracked per user.
function ritualDue(userJid, kind) {
  const key = kind === "morning" ? "lastMorning" : "lastNight";
  if (!persona.rituals) persona.rituals = {};
  if (!persona.rituals[userJid]) persona.rituals[userJid] = {};
  const last = persona.rituals[userJid][key] || 0;
  const h = new Date().getHours();
  const inWindow = kind === "morning" ? (h >= 6 && h <= 10) : (h >= 21 || h < 2);
  if (!inWindow) return false;
  return Date.now() - last > 20 * 60 * 60 * 1000; // ~once a day
}

function markRitualDone(userJid, kind) {
  const key = kind === "morning" ? "lastMorning" : "lastNight";
  if (!persona.rituals) persona.rituals = {};
  if (!persona.rituals[userJid]) persona.rituals[userJid] = {};
  persona.rituals[userJid][key] = Date.now();
  savePersona();
}

// ── Orchestrator: send a humanized reply ──────────────────────
// This replaces the plain reply() for AI chat responses. It:
//   - possibly delays 2-5 min (reacts first so it looks seen)
//   - reacts with a mood emoji
//   - splits into bursts sometimes
//   - occasionally sends a typo + correction
//   - appends persona quirks
// Returns after scheduling (delayed replies are fire-and-forget).
function humanizeAndSend(sock, msg, response, senderJid, senderName, isOwner) {
  const { react } = require("../utils/baileysHelpers");

  // React first — always, mood-appropriate
  const reaction = pickReaction(senderJid, response);
  react(sock, msg, reaction).catch(() => {});

  // Occasional delayed reply
  if (shouldDelay(response)) {
    const delay = randomDelayMs();
    setTimeout(() => {
      doSend(sock, msg, response, senderJid, senderName, isOwner);
    }, delay);
    return;
  }

  // Normal (fast) reply — still humanized
  doSend(sock, msg, response, senderJid, senderName, isOwner);
}

async function doSend(sock, msg, response, senderJid, senderName, isOwner) {
  const { reply, sleep } = require("../utils/baileysHelpers");

  // Typo + self-correction
  const { text: maybeTypoed, typo, correct, word } = maybeTypo(response);

  // Split into bursts
  const split = shouldSplit(maybeTypoed);
  const bursts = split ? splitIntoBursts(maybeTypoed) : [maybeTypoed];

  for (let i = 0; i < bursts.length; i++) {
    await reply(sock, msg, bursts[i]);
    if (i < bursts.length - 1) {
      // Short real-person pause between bursts
      await sleep(500 + Math.random() * 900);
    }
  }

  // Self-correction after a typo, like a real texter
  if (typo && word) {
    await sleep(400 + Math.random() * 600);
    try {
      await reply(sock, msg, `*${correct}*`);
    } catch (_) {}
  }
}

module.exports = {
  humanizeAndSend,
  buildPersonaContext,
  detectTone,
  bleedMood,
  ritualDue,
  markRitualDone,
  rememberCallable,
  getCallbacks,
  savePersona,
};
