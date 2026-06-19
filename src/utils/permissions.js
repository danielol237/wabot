const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const ADMINS_FILE = path.join(DATA_DIR, "admins.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let admins = new Set();
let bannedUsers = new Set();
let mutedChats = new Set();

try {
  if (fs.existsSync(ADMINS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(ADMINS_FILE, "utf8"));
    admins = new Set(raw.admins || []);
    bannedUsers = new Set(raw.banned || []);
    mutedChats = new Set(raw.muted || []);
  }
} catch (err) {
  console.error("Admins file corrupt, starting fresh:", err.message);
}

function save() {
  try {
    fs.writeFileSync(
      ADMINS_FILE,
      JSON.stringify({ admins: [...admins], banned: [...bannedUsers], muted: [...mutedChats] }, null, 2)
    );
  } catch (err) {
    console.error("Failed to save admins file:", err.message);
  }
}

function normalizeNumber(jidOrNumber) {
  return jidOrNumber.split("@")[0].split(":")[0];
}

// Owner is set via .env — the top-level creator, always has full access
function isOwner(senderJid) {
  const ownerNumber = process.env.OWNER_NUMBER;
  if (!ownerNumber) return false;
  return normalizeNumber(senderJid) === ownerNumber;
}

// Admins are promoted by the owner at runtime, stored on disk
function isAdmin(senderJid) {
  if (isOwner(senderJid)) return true;
  return admins.has(normalizeNumber(senderJid));
}

function addAdmin(number) {
  admins.add(normalizeNumber(number));
  save();
}

function removeAdmin(number) {
  admins.delete(normalizeNumber(number));
  save();
}

function listAdmins() {
  return [...admins];
}

function banUser(number) {
  bannedUsers.add(normalizeNumber(number));
  save();
}

function unbanUser(number) {
  bannedUsers.delete(normalizeNumber(number));
  save();
}

function isBanned(senderJid) {
  return bannedUsers.has(normalizeNumber(senderJid));
}

function muteChat(chatId) {
  mutedChats.add(chatId);
  save();
}

function unmuteChat(chatId) {
  mutedChats.delete(chatId);
  save();
}

function isMuted(chatId) {
  return mutedChats.has(chatId);
}

module.exports = {
  isOwner,
  isAdmin,
  addAdmin,
  removeAdmin,
  listAdmins,
  banUser,
  unbanUser,
  isBanned,
  muteChat,
  unmuteChat,
  isMuted,
};
