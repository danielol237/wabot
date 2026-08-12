// ── Bot settings (persisted) ─────────────────────────────────
// Small persisted settings store for ARIA's toggles (currently just NSFW mode,
// which is owner-only to enable). JSON file in data/, same pattern as admins.json.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "botSettings.json");

let settings = { nsfw: false };

try {
  if (fs.existsSync(FILE)) {
    settings = { ...settings, ...(JSON.parse(fs.readFileSync(FILE, "utf8")) || {}) };
  }
} catch (err) {
  console.error("botSettings corrupt, starting fresh:", err.message);
}

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(settings, null, 2)); } catch (err) {
    console.error("Failed to save botSettings:", err.message);
  }
}

// NSFW mode — gates adult content generation. Owner-only to toggle.
function isNsfwEnabled() { return !!settings.nsfw; }
function setNsfw(enabled) { settings.nsfw = !!enabled; save(); return settings.nsfw; }

module.exports = { isNsfwEnabled, setNsfw };
