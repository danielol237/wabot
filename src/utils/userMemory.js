// ── Permanent User Memory ───────────────────────────────────
// Tracks users across sessions — remembers facts, preferences, stats.
// Persistence now flows through the unified ProfileStore (audit #18) instead of
// its own JSON file, so all user-keyed memory lives in one record. Public API
// unchanged.

const { getSection, setSection } = require("./profileStore");

// Get or create user profile
function getUser(userId) {
  return getSection(userId, "user");
}

// Remember a fact about this user
function rememberFact(userId, fact) {
  const u = getUser(userId);
  if (!Array.isArray(u.facts)) u.facts = [];
  if (!u.facts.includes(fact)) {
    u.facts.push(fact);
    if (u.facts.length > 100) u.facts.shift();
  }
  u.lastSeen = Date.now();
  setSection(userId, "user", u);
}

// Get all facts about a user as context string
function getUserContext(userId) {
  const u = getUser(userId);
  let ctx = "";
  if (u.name) ctx += `Their name is ${u.name}. `;
  if (u.birthday) ctx += `Their birthday is ${u.birthday}. `;
  if (Array.isArray(u.facts) && u.facts.length > 0) ctx += `Facts: ${u.facts.slice(-10).join("; ")}. `;
  ctx += `We've interacted ${u.interactions || 0} times. `;
  return ctx;
}

// Track interaction
function trackInteraction(userId, userName) {
  const u = getUser(userId);
  if (!u.firstSeen) u.firstSeen = Date.now();
  u.interactions = (u.interactions || 0) + 1;
  u.lastSeen = Date.now();
  if (userName && !u.name) u.name = userName;
  setSection(userId, "user", u);
}

// Add a note
function addNote(userId, note) {
  const u = getUser(userId);
  if (!Array.isArray(u.notes)) u.notes = [];
  u.notes.push({ text: note, date: Date.now() });
  setSection(userId, "user", u);
}

// Get user stats
function getUserStats(userId) {
  const u = getUser(userId);
  return {
    name: u.name,
    interactions: u.interactions || 0,
    facts: Array.isArray(u.facts) ? u.facts.length : 0,
    firstSeen: u.firstSeen ? new Date(u.firstSeen).toLocaleDateString() : "—",
    lastSeen: u.lastSeen ? new Date(u.lastSeen).toLocaleDateString() : "—",
  };
}

module.exports = { getUser, rememberFact, getUserContext, trackInteraction, addNote, getUserStats };
