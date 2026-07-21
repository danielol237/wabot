// ── Task Board System ──────────────────────────────────────
// !todo — list tasks
// !todo add <task> — add task
// !done <n> — mark complete

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/tasks.json");
let tasks = {};
try { if (fs.existsSync(FILE)) tasks = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { tasks = {}; }
function save() { try { fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2)); } catch (e) {} }

function getTasks(userId) {
  if (!tasks[userId]) { tasks[userId] = []; save(); }
  return tasks[userId];
}

function addTask(userId, text) {
  const t = getTasks(userId);
  t.push({ id: t.length + 1, text, done: false, createdAt: Date.now() });
  save();
  return t[t.length - 1];
}

function markDone(userId, id) {
  const t = getTasks(userId);
  const task = t.find(x => x.id === id);
  if (!task) return null;
  task.done = true;
  task.doneAt = Date.now();
  save();
  return task;
}

function deleteTask(userId, id) {
  const t = getTasks(userId);
  const idx = t.findIndex(x => x.id === id);
  if (idx === -1) return false;
  t.splice(idx, 1);
  save();
  return true;
}

function formatTasks(userId) {
  const t = getTasks(userId);
  const pending = t.filter(x => !x.done);
  const done = t.filter(x => x.done);
  let text = "*📋 Task Board*\\n\\n";
  if (pending.length === 0 && done.length === 0) return "No tasks. Add one with *!todo add <task>*";
  if (pending.length > 0) {
    text += "*Pending:*\\n";
    pending.forEach(x => { text += (x.id) + ". " + x.text + "\\n"; });
  }
  if (done.length > 0) {
    text += "\\n*Completed:*\\n";
    done.slice(-5).forEach(x => { text += "✅ " + x.text + "\\n"; });
  }
  return text;
}

module.exports = { getTasks, addTask, markDone, deleteTask, formatTasks };
