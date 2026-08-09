// ── Auto-Mod: word filters, caps detection, spam, anti-flood ──
// Each group/channel can have its own settings stored in-memory.
// Persisted alongside other group settings in groupSettings.js.

const { getGroupSettings } = require("../utils/groupSettings");

// In-memory flood tracking: { chatId: { lastMsg: timestamp, count: 0 } }
const floodTracker = new Map();

const DEFAULT_SETTINGS = {
  bannedWords: [],
  maxCapsRatio: 0.7,        // >70% caps = flagged
  minCapsLength: 8,          // only flag if message is at least this long
  maxRepeatedMsgs: 3,        // flood: same msg sent this many times in a row
  floodWindowMs: 5000,       // flood window in ms
  maxMsgsPerWindow: 5,       // max messages in flood window
  autoWarn: true,
  autoKick: false,
  enabled: true,
};

// Get effective mod settings for a chat (merge with defaults)
function getModSettings(chatId) {
  const gs = getGroupSettings(chatId);
  return { ...DEFAULT_SETTINGS, ...(gs.modSettings || {}) };
}

// Check if message triggers any mod rule.
// Returns null if clean, or { action: "warn"|"delete"|"kick", reason: string }
function checkMessage(text, senderName, chatId) {
  if (!text || !chatId) return null;
  const settings = getModSettings(chatId);
  const gs = getGroupSettings(chatId);
  if (!settings.enabled) return null;

  const lower = text;
  const now = Date.now();

  // 0. Anti-link — block links when the group has antilink enabled.
  if (gs.antilink) {
    const linkRe = /(https?:\/\/|www\.)[^\s]+/i;
    if (linkRe.test(lower)) {
      return { action: "delete", reason: "Links are disabled in this group." };
    }
  }

  // 1. Banned words
  if (settings.bannedWords.length > 0) {
    const found = settings.bannedWords.find((w) => lower.includes(w.toLowerCase()));
    if (found) {
      return { action: settings.autoKick ? "kick" : "warn", reason: `Banned word: "${found}"` };
    }
  }

  // 2. Caps lock detection
  if (text.length >= settings.minCapsLength) {
    const letters = text.replace(/[^a-zA-Z]/g, "");
    if (letters.length > 0) {
      const capsRatio = letters.replace(/[^A-Z]/g, "").length / letters.length;
      if (capsRatio > settings.maxCapsRatio) {
        return { action: "warn", reason: "Excessive caps usage" };
      }
    }
  }

  // 3. Flood / spam detection
  const chatFlood = floodTracker.get(chatId) || { lastMsg: "", count: 0, timestamps: [] };
  
  // Repeated same message
  const normalized = text.toLowerCase().trim();
  if (chatFlood.lastMsg === normalized) {
    chatFlood.count++;
    if (chatFlood.count >= settings.maxRepeatedMsgs) {
      chatFlood.count = 0;
      return { action: settings.autoKick ? "kick" : "warn", reason: "Repeated messages (flood)" };
    }
  } else {
    chatFlood.lastMsg = normalized;
    chatFlood.count = 1;
  }

  // Message rate within flood window
  chatFlood.timestamps = chatFlood.timestamps.filter((t) => now - t < settings.floodWindowMs);
  chatFlood.timestamps.push(now);
  if (chatFlood.timestamps.length > settings.maxMsgsPerWindow) {
    chatFlood.timestamps = [];
    return { action: settings.autoKick ? "kick" : "warn", reason: "Message flood detected" };
  }

  floodTracker.set(chatId, chatFlood);
  return null;
}

function resetFloodTracker(chatId) {
  floodTracker.delete(chatId);
}

// Admin commands to configure mod
function parseModArgs(args) {
  const sub = args[0]?.toLowerCase();
  const rest = args.slice(1).join(" ");

  if (sub === "banword" && rest) return { cmd: "banword", word: rest };
  if (sub === "unbanword" && rest) return { cmd: "unbanword", word: rest };
  if (sub === "listwords") return { cmd: "listwords" };
  if (sub === "on") return { cmd: "toggle", value: true };
  if (sub === "off") return { cmd: "toggle", value: false };
  if (sub === "autokick") return { cmd: "autokick", value: args[1] === "on" };
  if (sub === "capslimit") return { cmd: "capslimit", value: parseFloat(args[1]) };

  return null;
}

module.exports = { checkMessage, resetFloodTracker, parseModArgs, getModSettings };
