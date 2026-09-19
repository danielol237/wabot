const fs = require("fs");
const path = require("path");
const { log, error, warn } = require("./logger");

const DATA_DIR = path.join(__dirname, "../../data");
const FACTS_FILE = path.join(DATA_DIR, "learnedFacts.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Shared knowledge base, distinct from per-user preferences (userPreferences.js).
// "Daniel prefers React" is a personal preference. "Baileys is preferred over
// whatsapp-web.js for this project" is a shared fact anyone in the chat benefits
// from ARIA remembering. Stored per-chat, not per-user, since facts like this are
// usually contextual to the project/group, not to one specific person.
let facts = {};

try {
  if (fs.existsSync(FACTS_FILE)) {
    facts = JSON.parse(fs.readFileSync(FACTS_FILE, "utf8"));
  }
} catch (err) {
  error("Learned facts file corrupt, starting fresh:", err.message);
  facts = {};
}

function save() {
  try {
    fs.writeFileSync(FACTS_FILE, JSON.stringify(facts, null, 2));
    return true;
  } catch (err) {
    error("Failed to save learned facts:", err.message);
    return false;
  }
}

const MAX_FACTS_PER_CHAT = 50;

function learnFact(chatId, fact) {
  const value = String(fact || "").trim().slice(0, 500);
  if (!value) return { persisted: false, reason: "empty-value", recordCount: getFacts(chatId).length };
  if (!facts[chatId]) facts[chatId] = [];
  if (!facts[chatId].includes(value)) {
    facts[chatId].push(value);
    if (facts[chatId].length > MAX_FACTS_PER_CHAT) facts[chatId].shift();
  }
  const persisted = save();
  return { persisted, recordCount: getFacts(chatId).length, value };
}

function getFacts(chatId) {
  return facts[chatId] || [];
}

function searchFacts(chatId, query) {
  const lower = query.toLowerCase();
  return getFacts(chatId).filter((f) => f.toLowerCase().includes(lower));
}

function getFactsContext(chatId) {
  const list = getFacts(chatId);
  if (list.length === 0) return "";
  return `\n\nThings you've been told to remember about this chat/project: ${list.join("; ")}.`;
}

function forgetFact(chatId, index) {
  if (!facts[chatId]) return { persisted: false, reason: "not-found" };
  const raw = String(index ?? "").trim();
  const numeric = /^\d+$/.test(raw) ? Number(raw) : -1;
  const target = numeric >= 0 ? numeric : facts[chatId].findIndex((fact) => fact.toLowerCase() === raw.toLowerCase());
  if (target < 0 || !facts[chatId][target]) return { persisted: false, reason: "not-found" };
  const [value] = facts[chatId].splice(target, 1);
  const persisted = save();
  return { persisted, value };
}

module.exports = { learnFact, getFacts, searchFacts, getFactsContext, forgetFact };
