const fs = require("fs");
const path = require("path");
const { log, error, warn } = require("./logger");

const DATA_DIR = path.join(__dirname, "../../data");
const PREFS_FILE = path.join(DATA_DIR, "userPreferences.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Structure: { [userId]: { preferences: string[], lastUpdated } }
// Preferences are stored as plain descriptive strings (e.g. "prefers React",
// "prefers JavaScript over TypeScript") rather than rigid fields, since build
// preferences are varied and free-form — this just gets fed into the planning
// prompt as extra context, not parsed into strict categories.
let prefs = {};

try {
  if (fs.existsSync(PREFS_FILE)) {
    prefs = JSON.parse(fs.readFileSync(PREFS_FILE, "utf8"));
  }
} catch (err) {
  error("Preferences file corrupt, starting fresh:", err.message);
  prefs = {};
}

function save() {
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  } catch (err) {
    error("Failed to save preferences:", err.message);
  }
}

const MAX_PREFS_PER_USER = 15; // keep this bounded — it's context for prompts, not a full profile

function addPreference(userId, preference) {
  if (!prefs[userId]) prefs[userId] = { preferences: [], lastUpdated: Date.now() };

  // Avoid exact duplicates
  if (!prefs[userId].preferences.includes(preference)) {
    prefs[userId].preferences.push(preference);
    if (prefs[userId].preferences.length > MAX_PREFS_PER_USER) {
      prefs[userId].preferences.shift(); // drop oldest when full
    }
  }
  prefs[userId].lastUpdated = Date.now();
  save();
}

function getPreferences(userId) {
  return prefs[userId]?.preferences || [];
}

function clearPreferences(userId) {
  delete prefs[userId];
  save();
}

// Formats preferences as a short string to inject into build/plan prompts
function getPreferencesContext(userId) {
  const list = getPreferences(userId);
  if (list.length === 0) return "";
  return `\n\nKnown preferences for this person (apply these unless they explicitly say otherwise for this request): ${list.join("; ")}.`;
}

module.exports = { addPreference, getPreferences, clearPreferences, getPreferencesContext };

