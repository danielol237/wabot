// ── Permanent User Memory ───────────────────────────────────
// Tracks users across sessions — remembers facts, preferences, stats.
// Distinct from chat-specific memory (memory.js) and project facts (learnedFacts.js).

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "userMemory.json");

let db = {};
try {
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (e) { db = {}; }

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); } catch (e) {}
}

// Get or create user profile
function getUser(userId) {
  if (!db[userId]) {
    db[userId] = {
      firstSeen: Date.now(),
      name: "",
      facts: [],
      interactions: 0,
      lastSeen: Date.now(),
      preferences: {},
      birthday: null,
      notes: [],
    };
    save();
  }
  return db[userId];
}

// Remember a fact about this user
function rememberFact(userId, fact) {
  const u = getUser(userId);
  if (!u.facts.includes(fact)) {
    u.facts.push(fact);
    if (u.facts.length > 100) u.facts.shift();
  }
  u.lastSeen = Date.now();
  save();
}

// Get all facts about a user as context string
function getUserContext(userId) {
  const u = getUser(userId);
  let ctx = "";
  if (u.name) ctx += `Their name is ${u.name}. `;
  if (u.birthday) ctx += `Their birthday is ${u.birthday}. `;
  if (u.facts.length > 0) ctx += `Facts: ${u.facts.slice(-10).join("; ")}. `;
  ctx += `We've interacted ${u.interactions} times. `;
  return ctx;
}

// Track interaction
function trackInteraction(userId, userName) {
  const u = getUser(userId);
  u.interactions++;
  u.lastSeen = Date.now();
  if (userName && !u.name) u.name = userName;
  save();
}

// Add a note
function addNote(userId, note) {
  const u = getUser(userId);
  u.notes.push({ text: note, date: Date.now() });
  save();
}

// Get user stats
function getUserStats(userId) {
  const u = getUser(userId);
  return {
    name: u.name,
    interactions: u.interactions,
    facts: u.facts.length,
    firstSeen: new Date(u.firstSeen).toLocaleDateString(),
    lastSeen: new Date(u.lastSeen).toLocaleDateString(),
  };
}

module.exports = { getUser, rememberFact, getUserContext, trackInteraction, addNote, getUserStats };
