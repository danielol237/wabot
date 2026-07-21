// ── Workspace System ──────────────────────────────────────
// !workspace — manage projects and ongoing work
// !workspace new <name> — create project
// !resume <name> — continue project

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/workspace.json");
let ws = {};
try { if (fs.existsSync(FILE)) ws = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { ws = {}; }
function save() { try { fs.writeFileSync(FILE, JSON.stringify(ws, null, 2)); } catch (e) {} }

function getWorkspace(userId) {
  if (!ws[userId]) { ws[userId] = { projects: [], current: null, notes: [] }; save(); }
  return ws[userId];
}

function createProject(userId, name, desc) {
  const w = getWorkspace(userId);
  w.projects.push({ id: w.projects.length + 1, name, desc, status: "active", createdAt: Date.now(), updatedAt: Date.now(), files: [], notes: [] });
  w.current = name;
  save();
  return w.projects[w.projects.length - 1];
}

function setCurrent(userId, name) {
  const w = getWorkspace(userId);
  const p = w.projects.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!p) return null;
  w.current = p.name;
  save();
  return p;
}

function archiveProject(userId, name) {
  const w = getWorkspace(userId);
  const p = w.projects.find(x => x.name.toLowerCase() === name.toLowerCase() && x.status === "active");
  if (!p) return false;
  p.status = "archived";
  save();
  return true;
}

function renameProject(userId, oldName, newName) {
  const w = getWorkspace(userId);
  const p = w.projects.find(x => x.name.toLowerCase() === oldName.toLowerCase());
  if (!p) return false;
  p.name = newName;
  save();
  return true;
}

function formatWorkspace(userId) {
  const w = getWorkspace(userId);
  const active = w.projects.filter(p => p.status === "active");
  const archived = w.projects.filter(p => p.status === "archived");
  let text = "*📂 Workspace*";
  if (w.current) text += "\nCurrent: *" + w.current + "*";
  text += "\n\n*Active Projects:*\n";
  if (active.length === 0) text += "  None\n";
  else active.forEach(p => { text += "  " + p.id + ". *" + p.name + "* — " + (p.desc || "") + "\n"; });
  if (archived.length > 0) {
    text += "\n*Archived:*\n";
    archived.slice(-3).forEach(p => { text += "  " + p.name + "\n"; });
  }
  return text;
}

module.exports = { getWorkspace, createProject, setCurrent, archiveProject, renameProject, formatWorkspace };
