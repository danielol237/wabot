const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MAX_HISTORY = 30; // a bit more headroom now that it's not wiped on restart

// Load memory from disk on startup. If the file doesn't exist yet or is corrupt,
// start fresh instead of crashing — a bad/missing memory file should never take the bot down.
let memory = new Map();
try {
  if (fs.existsSync(MEMORY_FILE)) {
    const raw = fs.readFileSync(MEMORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    memory = new Map(Object.entries(parsed));
    console.log(`💾 Loaded memory for ${memory.size} chat(s) from disk.`);
  }
} catch (err) {
  console.error("Memory file corrupt or unreadable, starting fresh:", err.message);
  memory = new Map();
}

let saveTimeout = null;

// Debounced save — avoids hammering disk if many messages come in quick succession
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const obj = Object.fromEntries(memory);
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(obj, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to save memory to disk:", err.message);
    }
  }, 2000);
}

function getMemory(chatId) {
  return memory.get(chatId) || [];
}

function saveMemory(chatId, history) {
  const trimmed = history.slice(-MAX_HISTORY);
  memory.set(chatId, trimmed);
  scheduleSave();
}

function clearMemory(chatId) {
  memory.delete(chatId);
  scheduleSave();
}

function getAllChats() {
  return [...memory.keys()];
}

// Flush immediately — useful on graceful shutdown
function flushNow() {
  if (saveTimeout) clearTimeout(saveTimeout);
  try {
    const obj = Object.fromEntries(memory);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to flush memory:", err.message);
  }
}

module.exports = { getMemory, saveMemory, clearMemory, getAllChats, flushNow };
