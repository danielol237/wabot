// ── Personal OS — Deep Memory System ───────────────────────
// ARIA remembers everything about each user permanently.
// Tracks preferences, habits, mood, past conversations, projects.

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/personalOS.json");
let db = {};
try { if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { db = {}; }
function save() { try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); } catch (e) {} }

function getUser(userId) {
  if (!db[userId]) {
    db[userId] = {
      firstSeen: Date.now(),
      name: "",
      facts: [],
      preferences: {},
      projects: [],
      mood: "neutral",
      habits: [],
      lastConversations: [],
      dailyRoutine: "",
      devices: [],
      reminders: [],
      notes: [],
      stats: { messagesSent: 0, commandsUsed: 0, sessionsActive: 0 },
    };
    save();
  }
  return db[userId];
}

function remember(userId, key, value) {
  const u = getUser(userId);
  u.preferences[key] = value;
  save();
}

function addFact(userId, fact) {
  const u = getUser(userId);
  if (!u.facts.includes(fact)) {
    u.facts.push(fact);
    if (u.facts.length > 200) u.facts.shift();
  }
  save();
}

function addProject(userId, name, type) {
  const u = getUser(userId);
  u.projects.push({ name, type, started: Date.now(), status: "active" });
  save();
}

function trackMood(userId, mood) {
  const u = getUser(userId);
  u.mood = mood;
  if (!u.moodHistory) u.moodHistory = [];
  u.moodHistory.push({ mood, time: Date.now() });
  if (u.moodHistory.length > 50) u.moodHistory.shift();
  save();
}

function getPersonalizedGreeting(userId) {
  const u = getUser(userId);
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  let greeting = timeGreeting + " " + (u.name || "") + ". ";
  if (u.projects.length > 0) {
    const active = u.projects.filter(p => p.status === "active");
    if (active.length > 0) greeting += "Continue your " + active[0].name + " project? ";
  }
  if (u.reminders.length > 0) {
    const due = u.reminders.filter(r => !r.done);
    if (due.length > 0) greeting += "You have " + due.length + " pending reminder" + (due.length > 1 ? "s" : "") + ". ";
  }
  return greeting;
}

function getUserContext(userId) {
  const u = getUser(userId);
  let ctx = "Personalized context for " + (u.name || "this user") + ": ";
  if (u.facts.length > 0) ctx += "Known facts: " + u.facts.slice(-10).join("; ") + ". ";
  if (Object.keys(u.preferences).length > 0) ctx += "Preferences: " + JSON.stringify(u.preferences) + ". ";
  if (u.projects.length > 0) ctx += "Active projects: " + u.projects.filter(p => p.status === "active").map(p => p.name).join(", ") + ". ";
  ctx += "Messages sent: " + (u.stats?.messagesSent || 0) + ".";
  return ctx;
}

module.exports = { getUser, remember, addFact, addProject, trackMood, getPersonalizedGreeting, getUserContext };
