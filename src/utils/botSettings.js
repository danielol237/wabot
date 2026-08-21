// ── Bot settings (persisted) ─────────────────────────────────
// Chat-scoped settings for ARIA toggles. NSFW mode is intentionally explicit
// per WhatsApp chat so one group cannot accidentally inherit another chat's state.
const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "botSettings.json");
let settings = { nsfw: false, nsfwChats: {} };
try {
  if (fs.existsSync(FILE)) {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) || {};
    settings = { ...settings, ...parsed, nsfwChats: { ...(parsed.nsfwChats || {}) } };
  }
} catch (err) {
  console.error("botSettings corrupt, starting fresh:", err.message);
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("Failed to save botSettings:", err.message);
  }
}
function key(chatId) {
  const value = String(chatId || "").trim();
  return value ? value.slice(0, 160) : "";
}
function isNsfwEnabled(chatId) {
  const chatKey = key(chatId);
  if (chatKey) return settings.nsfwChats[chatKey] === true;
  return settings.nsfw === true;
}
function setNsfw(enabled, chatId) {
  const chatKey = key(chatId);
  if (chatKey) settings.nsfwChats[chatKey] = Boolean(enabled);
  else settings.nsfw = Boolean(enabled);
  save();
  return isNsfwEnabled(chatId);
}
module.exports = { isNsfwEnabled, setNsfw, _test: { settings, key } };
