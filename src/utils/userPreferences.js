const { getSection, setSection } = require("./profileStore");

const MAX_PREFS_PER_USER = 15; // keep this bounded — it's context for prompts, not a full profile

function addPreference(userId, preference) {
  const rec = getSection(userId, "prefs");
  if (!rec.preferences) rec.preferences = [];
  if (!rec.preferences.includes(preference)) {
    rec.preferences.push(preference);
    if (rec.preferences.length > MAX_PREFS_PER_USER) {
      rec.preferences.shift(); // drop oldest when full
    }
  }
  rec.lastUpdated = Date.now();
  setSection(userId, "prefs", rec);
}

function getPreferences(userId) {
  const rec = getSection(userId, "prefs");
  return rec.preferences || [];
}

function clearPreferences(userId) {
  setSection(userId, "prefs", { preferences: [], lastUpdated: Date.now() });
}

// Formats preferences as a short string to inject into build/plan prompts
function getPreferencesContext(userId) {
  const list = getPreferences(userId);
  if (list.length === 0) return "";
  return `\n\nKnown preferences for this person (apply these unless they explicitly say otherwise for this request): ${list.join("; ")}.`;
}

module.exports = { addPreference, getPreferences, clearPreferences, getPreferencesContext };
