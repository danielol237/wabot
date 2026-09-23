const fs = require("fs");
const path = require("path");
const { log, error, warn } = require("./logger");

const DATA_DIR = path.join(__dirname, "../../data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MAX_HISTORY = Number(process.env.ARIA_CHAT_HISTORY_LIMIT || 240); // a bit more headroom now that it's not wiped on restart

// Load memory from disk on startup. If the file doesn't exist yet or is corrupt,
// start fresh instead of crashing — a bad/missing memory file should never take the bot down.
let memory = new Map();
try {
  if (fs.existsSync(MEMORY_FILE)) {
    const raw = fs.readFileSync(MEMORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    memory = new Map(Object.entries(parsed));
    log(`💾 Loaded memory for ${memory.size} chat(s) from disk.`);
  }
} catch (err) {
  error("Memory file corrupt or unreadable, starting fresh:", err.message);
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
      error("Failed to save memory to disk:", err.message);
    }
  }, 2000);
}

function normalizeHistory(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === "object" && typeof entry.content === "string")
      .map((entry) => ({
        role: entry.role === "assistant" ? "assistant" : "user",
        content: String(entry.content).slice(0, 8000),
      }));
  }
  // Migrate the short-lived legacy format where a single text string could be
  // written accidentally. Keeping it as one user turn is safer than returning
  // malformed history to an AI provider.
  return typeof value === "string" && value.trim() ? [{ role: "user", content: value.slice(0, 8000) }] : [];
}

function getMemory(chatId) {
  return normalizeHistory(memory.get(chatId));
}

// Supports both the original saveMemory(chatId, history) API and the compact
// saveMemory(chatId, userText, assistantText) form used by the chat router.
function saveMemory(chatId, historyOrUserText, assistantText) {
  const existing = getMemory(chatId);
  const next = Array.isArray(historyOrUserText)
    ? normalizeHistory(historyOrUserText)
    : [
        ...existing,
        ...(String(historyOrUserText || "").trim() ? [{ role: "user", content: String(historyOrUserText).slice(0, 8000) }] : []),
        ...(String(assistantText || "").trim() ? [{ role: "assistant", content: String(assistantText).slice(0, 8000) }] : []),
      ];
  memory.set(chatId, next.slice(-MAX_HISTORY));
  scheduleSave();
}

function appendMemory(chatId, userText, assistantText) {
  saveMemory(chatId, userText, assistantText);
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
    error("Failed to flush memory:", err.message);
  }
}

module.exports = { getMemory, saveMemory, appendMemory, clearMemory, getAllChats, flushNow, _test: { normalizeHistory, memory } };
