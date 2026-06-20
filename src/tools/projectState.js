const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DATA_DIR = path.join(__dirname, "../../data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Structure: { [projectId]: { id, chatId, goal, files: [{path, description, status}], currentIndex, status, createdAt } }
let projects = {};

try {
  if (fs.existsSync(PROJECTS_FILE)) {
    projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8"));
  }
} catch (err) {
  console.error("Projects file corrupt, starting fresh:", err.message);
  projects = {};
}

function save() {
  try {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  } catch (err) {
    console.error("Failed to save projects:", err.message);
  }
}

function createProject(chatId, goal, plannedFiles) {
  const id = uuidv4().slice(0, 8);
  projects[id] = {
    id,
    chatId,
    goal,
    files: plannedFiles.map((f) => ({ ...f, status: "pending" })), // pending | done | failed
    currentIndex: 0,
    status: "running", // running | paused | done | failed | cancelled
    createdAt: Date.now(),
  };
  save();
  return projects[id];
}

function getProject(id) {
  return projects[id] || null;
}

// Finds the most recent non-finished project for a chat — used by !continue/!status
// when the person doesn't specify a project ID
function getActiveProjectForChat(chatId) {
  const chatProjects = Object.values(projects)
    .filter((p) => p.chatId === chatId && (p.status === "running" || p.status === "paused"))
    .sort((a, b) => b.createdAt - a.createdAt);
  return chatProjects[0] || null;
}

function getAllProjectsForChat(chatId) {
  return Object.values(projects)
    .filter((p) => p.chatId === chatId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function markFileStatus(projectId, fileIndex, status) {
  const project = projects[projectId];
  if (!project || !project.files[fileIndex]) return;
  project.files[fileIndex].status = status;
  save();
}

function advanceProject(projectId) {
  const project = projects[projectId];
  if (!project) return;
  project.currentIndex++;
  save();
}

function setProjectStatus(projectId, status) {
  const project = projects[projectId];
  if (!project) return;
  project.status = status;
  save();
}

function getProgress(project) {
  const done = project.files.filter((f) => f.status === "done").length;
  return { done, total: project.files.length, percent: Math.round((done / project.files.length) * 100) };
}

module.exports = {
  createProject,
  getProject,
  getActiveProjectForChat,
  getAllProjectsForChat,
  markFileStatus,
  advanceProject,
  setProjectStatus,
  getProgress,
};
