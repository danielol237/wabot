const fs = require("fs");
const path = require("path");
const { log, error, warn } = require("./logger");

const DATA_DIR = path.join(__dirname, "../../data");
const SETTINGS_FILE = path.join(DATA_DIR, "groupSettings.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Structure: { [groupId]: { antilink: bool, welcome: bool, welcomeMsg: string, leaveMsg: string, protections: object, slowmodeSeconds: number, introCard: object, warnings: { [userId]: count } } }
let settings = {};

try {
  if (fs.existsSync(SETTINGS_FILE)) {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  }
} catch (err) {
  error("Group settings file corrupt, starting fresh:", err.message);
  settings = {};
}

function save() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    error("Failed to save group settings:", err.message);
  }
}

function getGroupSettings(groupId) {
  if (!settings[groupId]) {
    settings[groupId] = { antilink: false, welcome: false, welcomeMsg: null, leaveMsg: null, protections: {}, slowmodeSeconds: 0, introCard: null, warnings: {} };
  }
  return settings[groupId];
}

function setProtection(groupId, name, enabled) {
  const gs = getGroupSettings(groupId);
  gs.protections = { ...(gs.protections || {}), [String(name)]: !!enabled };
  save();
  return gs.protections[String(name)];
}

function isProtectionEnabled(groupId, name) {
  return !!getGroupSettings(groupId).protections?.[String(name)];
}

function setSlowmode(groupId, seconds) {
  const gs = getGroupSettings(groupId);
  gs.slowmodeSeconds = Math.max(0, Math.min(3600, Number(seconds) || 0));
  save();
  return gs.slowmodeSeconds;
}

function setIntroCard(groupId, introCard) {
  const gs = getGroupSettings(groupId);
  gs.introCard = introCard ? { ...introCard } : null;
  save();
  return gs.introCard;
}

function setAntilink(groupId, enabled) {
  getGroupSettings(groupId).antilink = enabled;
  save();
}

function setWelcome(groupId, enabled) {
  getGroupSettings(groupId).welcome = enabled;
  save();
}

function setWelcomeMessage(groupId, message) {
  getGroupSettings(groupId).welcomeMsg = message;
  save();
}

function setLeaveMessage(groupId, message) {
  getGroupSettings(groupId).leaveMsg = message;
  save();
}

function addWarning(groupId, userId) {
  const gs = getGroupSettings(groupId);
  gs.warnings[userId] = (gs.warnings[userId] || 0) + 1;
  save();
  return gs.warnings[userId];
}

function resetWarnings(groupId, userId) {
  const gs = getGroupSettings(groupId);
  delete gs.warnings[userId];
  save();
}

function getWarnings(groupId, userId) {
  return getGroupSettings(groupId).warnings[userId] || 0;
}

module.exports = {
  getGroupSettings,
  setProtection,
  isProtectionEnabled,
  setSlowmode,
  setIntroCard,
  setAntilink,
  setWelcome,
  setWelcomeMessage,
  setLeaveMessage,
  addWarning,
  resetWarnings,
  getWarnings,
};
