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
  } catch (err) {
    error("Failed to save learned facts:", err.message);
  }
}

const MAX_FACTS_PER_CHAT = 50;

function learnFact(chatId, fact) {
  if (!facts[chatId]) facts[chatId] = [];
  if (!facts[chatId].includes(fact)) {
    facts[chatId].push(fact);
    if (facts[chatId].length > MAX_FACTS_PER_CHAT) facts[chatId].shift();
  }
  save();
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
  if (!facts[chatId] || !facts[chatId][index]) return false;
  facts[chatId].splice(index, 1);
  save();
  return true;
}

module.exports = { learnFact, getFacts, searchFacts, getFactsContext, forgetFact };

