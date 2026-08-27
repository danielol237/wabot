// ── ARIA Humanizer ─────────────────────────────────────────────
// The layer that makes ARIA feel like a person, not a service bot.
// Handles reaction-first delivery, long-term memory of people, mood bleeding
// across chats, callbacks/running jokes, rituals, emotional gradient, and
// persona consistency. Chat replies remain complete and immediate.

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
  try {
    fs.mkdirSync(path.dirname(PERSONA_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(PERSONA_FILE, JSON.stringify(persona, null, 2), { mode: 0o600 });
    try { fs.chmodSync(PERSONA_FILE, 0o600); } catch (_) {
      // Best-effort permission hardening; persistence already succeeded.
    }
  } catch (e) {
    // Persona persistence must never block a chat reply.
  }
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

// ── 2. Reply formatting ───────────────────────────────────────
// Replies are kept as one complete message so ARIA never creates artificial
// pauses or fragmented delivery.
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

// ── 3. Optional presentation helpers ─────────────────────────
// Legacy typo helpers remain available for compatibility, but are not used in
// the immediate chat send path.
const TYPO_MAP = [
  ["the", "teh"], ["and", "adn"], ["you", "yuo"], ["your", "youre"],
  ["there", "tehre"], ["about", "abotu"], ["think", "thikn"],
  ["though", "tho"], ["really", "rly"], ["because", "becuase"],
  ["going", "goin"], ["what", "wat"], ["just", "jsut"], ["great", "gret"],
];

function maybeTypo(text) {
  // Typos are a presentation experiment, not an identity requirement. Keep
  // them disabled unless the operator explicitly enables the opt-in mode.
  if (process.env.ARIA_HUMANIZER_TYPOS !== "true" || Math.random() > 0.02) return { text, typo: null };
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

// ── 4. Immediate replies (permanent policy) ───────────────────
// ARIA never delays an ordinary response. Delayed delivery belongs only to
// explicit reminders, scheduled tasks, or background missions—not chat.

// ── 5. Callbacks / running jokes ──────────────────────────────
// Persist memorable facts/jokes and occasionally reference them later.
function rememberCallable(userJid, fact) {
  try {
    rememberFact(userJid, fact);
  } catch (e) {
    // Memory callbacks are optional and must never block a reply.
  }
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
    ctx += ` ${senderName} is Daniel — your creator. Be especially familiar and playful, but do not claim human family ties or use loyalty pressure.`;
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
// This replaces the plain reply() for AI chat responses. It reacts with a
// mood emoji and sends one complete message immediately. Chat replies are not
// split, delayed, or followed by artificial typo corrections.
async function humanizeAndSend(sock, msg, response, senderJid, senderName, isOwner, options = {}) {
  const { react } = require("../utils/baileysHelpers");

  // React first — always, mood-appropriate
  const reaction = pickReaction(senderJid, response);
  react(sock, msg, reaction).catch(() => {});

  // Immediate reply — never scheduled for later.
  await doSend(sock, msg, response, senderJid, senderName, isOwner, options);
}

async function doSend(sock, msg, response, senderJid, senderName, isOwner, options = {}) {
  const { reply } = require("../utils/baileysHelpers");
  await reply(sock, msg, String(response || "").trim(), { mentions: options.mentions || [] });

  // Voice-first: if the user has voice mode on, also send the reply as audio
  try {
    const prefs = require("../utils/userPreferences").getPreferences(senderJid);
    if (prefs.includes("voice-mode")) {
      const { textToSpeech } = require("./voice");
      const audio = await textToSpeech(String(response || "").slice(0, 500));
      if (audio?.success) {
        await sock.sendMessage(msg.key.remoteJid, { audio: audio.buffer, mimetype: "audio/mpeg", ptt: true });
      }
    }
  } catch (_) {
    // Optional voice output must never block the text reply.
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
