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

function createProject(chatId, goal, plannedFiles, metadata = {}) {
  const id = uuidv4().slice(0, 8);
  projects[id] = {
    id,
    chatId,
    goal,
    files: plannedFiles.map((f) => ({ ...f, status: "pending" })), // pending | done | failed
    currentIndex: 0,
    status: "running", // running | paused | done | failed | cancelled
    createdAt: Date.now(),
    ...(metadata.templateKey ? { templateKey: metadata.templateKey } : {}),
    ...(metadata.workflow ? { workflow: String(metadata.workflow).slice(0, 40) } : {}),
    ...(metadata.research ? { research: { query: String(metadata.research.query || "").slice(0, 240), notes: String(metadata.research.notes || "").slice(0, 5000), unavailable: Boolean(metadata.research.unavailable) } } : {}),
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

function markFileStatus(projectId, fileIndex, status, content = null) {
  const project = projects[projectId];
  if (!project || !project.files[fileIndex]) return;
  project.files[fileIndex].status = status;
  save();

  // Store actual generated content separately from the lightweight metadata file —
  // this is what makes "edit this existing project file" possible later, since
  // finalizeProject() deletes the working directory after zipping/uploading.
  if (content !== null) {
    saveFileContent(projectId, project.files[fileIndex].path, content);
  }
}

const CONTENT_DIR = path.join(DATA_DIR, "project_files");
if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });

function contentFilePath(projectId, filePath) {
  // Flatten the relative path into a safe filename (no nested dirs needed on disk)
  const safeName = filePath.replace(/[\/\\]/g, "__");
  return path.join(CONTENT_DIR, `${projectId}__${safeName}`);
}

function saveFileContent(projectId, filePath, content) {
  try {
    fs.writeFileSync(contentFilePath(projectId, filePath), content, "utf8");
  } catch (err) {
    console.error(`Failed to save content for ${filePath}:`, err.message);
  }
}

function getFileContent(projectId, filePath) {
  try {
    return fs.readFileSync(contentFilePath(projectId, filePath), "utf8");
  } catch (err) {
    return null; // file genuinely doesn't exist or was never saved — caller handles this
  }
}

function deleteProjectFiles(projectId) {
  const project = projects[projectId];
  if (!project) return;
  for (const file of project.files) {
    try {
      const fp = contentFilePath(projectId, file.path);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (err) {
      console.error("Failed to delete stored file content:", err.message);
    }
  }
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

function recordDeployment(projectId, deployment = {}) {
  const project = projects[projectId];
  if (!project) return null;
  project.deployment = {
    ...(project.deployment || {}),
    provider: deployment.provider || project.deployment?.provider || "vercel",
    deploymentId: deployment.deploymentId || project.deployment?.deploymentId || null,
    vercelProjectId: deployment.vercelProjectId || project.deployment?.vercelProjectId || null,
    url: deployment.url || project.deployment?.url || null,
    target: deployment.target || project.deployment?.target || "preview",
    state: deployment.state || project.deployment?.state || null,
    updatedAt: Date.now(),
  };
  save();
  return project.deployment;
}

function getProgress(project) {
  const done = project.files.filter((f) => ["done", "done_with_warning"].includes(f.status)).length;
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
  recordDeployment,
  getProgress,
  getFileContent,
  saveFileContent,
  deleteProjectFiles,
};

