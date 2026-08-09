// ── ARIA Household / Shared Mode ──────────────────────────────
// Lets one ARIA serve a family, team, or small community with:
//   • shared tasks & resources (shared list)
//   • per-person memory partitions (each member has private memory)
//   • privacy walls (a member's private data isn't visible to others)
//   • household admin controls (an owner manages the group)
//
// Model: a household has an owner + members. Shared state is visible to all
// members; private notes are per-member. ARIA addresses everyone by name and
// partitions context per person.

const fs = require("fs");
const path = require("path");
const { error } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "households.json");

// { [householdId]: { id, name, owner, members: [jid], sharedTasks: [], sharedNotes: [], created } }
let db = {};
try {
  if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) { error("Households file corrupt, starting fresh:", err.message); db = {}; }

function save() { try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); } catch (err) { error("Failed to save households:", err.message); } }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── Household CRUD ───────────────────────────────────────────
function createHousehold(id, owner, name) {
  if (db[id]) return { error: "A household already exists for this chat." };
  const hh = { id, name: name || "Household", owner, members: [owner], sharedTasks: [], sharedNotes: [], created: Date.now() };
  db[id] = hh;
  save();
  return { success: true, household: hh };
}

function getHousehold(id) { return db[id] || null; }
function listHouseholds() { return Object.values(db); }

function addMember(id, jid) {
  const hh = db[id];
  if (!hh) return { error: "No household in this chat. Start one with !household create <name>" };
  if (!hh.members.includes(jid)) { hh.members.push(jid); save(); }
  return { success: true, household: hh };
}

function removeMember(id, jid, requester) {
  const hh = db[id];
  if (!hh) return { error: "No household here." };
  if (hh.owner !== requester && hh.owner !== jid) return { error: "Only the household owner can remove members." };
  hh.members = hh.members.filter((m) => m !== jid);
  save();
  return { success: true };
}

function isMember(id, jid) {
  const hh = db[id];
  return !!hh && hh.members.includes(jid);
}

// ── Shared tasks ─────────────────────────────────────────────
function addSharedTask(id, jid, text) {
  const hh = db[id];
  if (!hh) return { error: "No household here." };
  if (!isMember(id, jid)) return { error: "Only household members can use this." };
  const task = { id: uid(), text, by: jid, done: false, created: Date.now() };
  hh.sharedTasks.push(task);
  save();
  return { success: true, task };
}

function toggleSharedTask(id, taskId) {
  const hh = db[id];
  if (!hh) return { error: "No household here." };
  const task = hh.sharedTasks.find((t) => t.id === taskId);
  if (!task) return { error: "Task not found." };
  task.done = !task.done;
  save();
  return { success: true, task };
}

function listSharedTasks(id) {
  const hh = db[id];
  if (!hh) return [];
  return hh.sharedTasks;
}

// ── Shared notes (visible to all members) ────────────────────
function addSharedNote(id, jid, text) {
  const hh = db[id];
  if (!hh) return { error: "No household here." };
  if (!isMember(id, jid)) return { error: "Only household members can use this." };
  hh.sharedNotes.push({ id: uid(), text, by: jid, ts: Date.now() });
  save();
  return { success: true };
}

function listSharedNotes(id) {
  const hh = db[id];
  if (!hh) return [];
  return hh.sharedNotes;
}

module.exports = {
  createHousehold, getHousehold, listHouseholds,
  addMember, removeMember, isMember,
  addSharedTask, toggleSharedTask, listSharedTasks,
  addSharedNote, listSharedNotes,
};
