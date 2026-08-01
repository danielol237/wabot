const fs = require("fs");
const path = require("path");
const { log, error, warn } = require("./logger");

const DATA_DIR = path.join(__dirname, "../../data");
const TASKS_FILE = path.join(DATA_DIR, "backgroundTasks.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Structure: { [taskId]: { id, chatId, type, params, condition, lastChecked, lastValue, createdAt, active } }
// "type" determines which checker function runs (price, keyword, custom).
let tasks = {};

try {
  if (fs.existsSync(TASKS_FILE)) {
    tasks = JSON.parse(fs.readFileSync(TASKS_FILE, "utf8"));
  }
} catch (err) {
  error("Background tasks file corrupt, starting fresh:", err.message);
  tasks = {};
}

function save() {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
  } catch (err) {
    error("Failed to save background tasks:", err.message);
  }
}

const MAX_TASKS_PER_CHAT = 10; // keep this bounded — each one polls periodically, costs API calls

function createTask(chatId, type, params, condition) {
  const activeForChat = Object.values(tasks).filter((t) => t.chatId === chatId && t.active).length;
  if (activeForChat >= MAX_TASKS_PER_CHAT) {
    return { success: false, error: `Max ${MAX_TASKS_PER_CHAT} active watches per chat. Cancel one first with !watches then !unwatch [id].` };
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  tasks[id] = {
    id,
    chatId,
    type,
    params,
    condition,
    lastChecked: null,
    lastValue: null,
    createdAt: Date.now(),
    active: true,
  };
  save();
  return { success: true, task: tasks[id] };
}

function getActiveTasks() {
  return Object.values(tasks).filter((t) => t.active);
}

function getTasksForChat(chatId) {
  return Object.values(tasks).filter((t) => t.chatId === chatId && t.active);
}

function updateTaskCheck(taskId, value) {
  if (!tasks[taskId]) return;
  tasks[taskId].lastChecked = Date.now();
  tasks[taskId].lastValue = value;
  save();
}

function deactivateTask(taskId) {
  if (!tasks[taskId]) return false;
  tasks[taskId].active = false;
  save();
  return true;
}

function deactivateTaskForChat(chatId, taskId) {
  const task = tasks[taskId];
  if (!task || task.chatId !== chatId) return false;
  task.active = false;
  save();
  return true;
}

module.exports = {
  createTask,
  getActiveTasks,
  getTasksForChat,
  updateTaskCheck,
  deactivateTask,
  deactivateTaskForChat,
};
