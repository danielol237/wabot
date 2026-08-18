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
  scamLinkScan: true,        // heuristic scam-link detection
  autoWarn: true,
  autoKick: false,
  enabled: true,
};

// ── Heuristic scam/suspicious link scan ────────────────────────
// Catches common scam patterns without an external reputation API:
//   • Suspicious TLDs + giveaway/free-claim bait
//   • URL shorteners (often used to hide phishing)
//   • "you won / claim / free vbucks / gift card" bait next to a link
//   • IP-address URLs (rare in legit links, common in phishing)
const SCAM_HINTS = [
  /you\s+won|claim\s+reward|gift\s+card|free\s+(vbucks|robux|nitro|iphone|prize)/i,
  /earn\s+fast|crypto\s+giveaway|airdrop|double\s+your\s+(btc|eth|money)/i,
  /verify\s+account|account\s+will\s+be\s+deleted|login\s+urgent/i,
  /limited\s+time\s+offer|exclusive\s+deal|prize\s+claim/i,
];
const SHORTENER_RE = /(bit\.ly|t\.co|tinyurl|goo\.gl|is\.gd|buff\.ly|rb\.gy|shorturl|cutly|cutt\.ly|tiny\.cc|s\.link)/i;
const SUSPICIOUS_TLDS = /\.(zip|mov|exe|scr|bin|apk|ru|cn|top|xyz|gq|ml|cf)([/\s]|$)/i;

function scanLink(text) {
  const hasLink = /(https?:\/\/|www\.)/i.test(text);
  if (!hasLink) return null;

  // Bait text + any link = classic scam.
  if (SCAM_HINTS.some((r) => r.test(text))) {
    return { action: "warn", reason: "Suspicious promo/claim link (possible scam)" };
  }
  // Shortener used with high-pressure bait, or on its own in a group.
  const short = text.match(SHORTENER_RE);
  if (short) {
    return { action: "warn", reason: "Shortened link (bit.ly/t.co etc) — hide phishing" };
  }
  // Direct suspicious TLD.
  const tld = text.match(SUSPICIOUS_TLDS);
  if (tld) {
    return { action: "warn", reason: `Suspicious link TLD (.${tld[1]})` };
  }
  return null;
}

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

  // 0b. Heuristic scam-link scan.
  if (settings.scamLinkScan) {
    const scam = scanLink(text);
    if (scam) return { action: settings.autoKick ? "kick" : "warn", reason: scam.reason };
  }

  // 1. Banned words. The antiword toggle is on by default for backwards
  // compatibility, and can be disabled by an admin with antiword off.
  const antiWordEnabled = gs.protections?.antiword !== false;
  if (antiWordEnabled && settings.bannedWords.length > 0) {
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

  // 3. Flood / spam detection. Existing behavior remains enabled unless an
  // admin explicitly runs antispam off.
  if (gs.protections?.antispam === false) return null;
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

module.exports = { checkMessage, scanLink, resetFloodTracker, parseModArgs, getModSettings };
