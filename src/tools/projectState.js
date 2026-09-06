const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Render instances need a persistent disk mounted at this path if project memory
// must survive a replacement/redeploy. GitHub delivery remains the durable source
// of truth when a project is published there.
const DATA_DIR = path.resolve(process.env.ARIA_PROJECT_DATA_DIR || path.join(__dirname, "../../data"));
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const CONTENT_DIR = path.join(DATA_DIR, "project_files");

for (const dir of [DATA_DIR, CONTENT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
}

let projects = {};
try {
  if (fs.existsSync(PROJECTS_FILE)) projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8"));
} catch (err) {
  console.error("Projects file corrupt, starting fresh:", err.message);
  projects = {};
}

function save() {
  try {
    const tmp = `${PROJECTS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(projects, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, PROJECTS_FILE);
    try { fs.chmodSync(PROJECTS_FILE, 0o600); } catch (_) {}
  } catch (err) {
    console.error("Failed to save projects:", err.message);
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/^(?:the|my|that|this)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function projectName(goal) {
  const text = String(goal || "").trim().replace(/^(?:build|create|make|develop|design)\s+(?:me\s+)?/i, "").replace(/^(?:a|an|the)\s+/i, "");
  const compact = text.replace(/\s+(?:and|then)\s+(?:deploy|publish|push|host)\b.*$/i, "").trim();
  return compact.slice(0, 100) || "Untitled ARIA project";
}

function projectSlug(name) {
  return normalizeText(name).replace(/\s+/g, "-").slice(0, 70) || "aria-project";
}

function touch(project, action = null) {
  project.updatedAt = Date.now();
  project.lastUsedAt = project.updatedAt;
  if (action) project.lastAction = String(action).slice(0, 120);
}

function createProject(chatId, goal, plannedFiles, metadata = {}) {
  const id = uuidv4().slice(0, 8);
  const name = String(metadata.name || projectName(goal)).slice(0, 100);
  projects[id] = {
    id,
    chatId,
    goal,
    name,
    slug: projectSlug(name),
    aliases: Array.isArray(metadata.aliases) ? metadata.aliases.map((v) => String(v).slice(0, 80)).slice(0, 10) : [],
    files: plannedFiles.map((f) => ({ ...f, status: "pending" })),
    currentIndex: 0,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastUsedAt: Date.now(),
    revision: 0,
    history: [{ revision: 0, action: "created", summary: "Project planned", at: Date.now() }],
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

function getActiveProjectForChat(chatId) {
  return Object.values(projects)
    .filter((p) => p.chatId === chatId && (p.status === "running" || p.status === "paused"))
    .sort((a, b) => (b.lastUsedAt || b.updatedAt || b.createdAt) - (a.lastUsedAt || a.updatedAt || a.createdAt))[0] || null;
}

function getAllProjectsForChat(chatId) {
  return Object.values(projects)
    .filter((p) => p.chatId === chatId)
    .sort((a, b) => (b.lastUsedAt || b.updatedAt || b.createdAt) - (a.lastUsedAt || a.updatedAt || a.createdAt));
}

function resolveProjectForChat(chatId, reference = null) {
  const available = getAllProjectsForChat(chatId);
  if (!available.length) return null;
  const query = normalizeText(reference);
  if (!query) return available[0];
  const direct = available.find((p) => p.id === String(reference).trim());
  if (direct) return direct;
  const scored = available.map((p) => {
    const fields = [p.name, p.slug, p.goal, ...(p.aliases || []), p.deployment?.url, p.deployment?.repository].map(normalizeText).filter(Boolean);
    let score = 0;
    for (const field of fields) {
      if (field === query) score = Math.max(score, 100);
      else if (field.startsWith(query)) score = Math.max(score, 80);
      else if (field.includes(query)) score = Math.max(score, 60);
    }
    return { p, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || (b.p.lastUsedAt || 0) - (a.p.lastUsedAt || 0));
  return scored[0]?.p || null;
}

function recordRevision(projectId, action, summary, files = []) {
  const project = projects[projectId];
  if (!project) return null;
  project.revision = Number(project.revision || 0) + 1;
  project.history = Array.isArray(project.history) ? project.history : [];
  project.history.push({ revision: project.revision, action: String(action || "updated").slice(0, 80), summary: String(summary || "").slice(0, 300), files: Array.isArray(files) ? files.slice(0, 20) : [], at: Date.now() });
  project.history = project.history.slice(-30);
  touch(project, action);
  save();
  return project;
}

function markFileStatus(projectId, fileIndex, status, content = null) {
  const project = projects[projectId];
  if (!project || !project.files[fileIndex]) return;
  project.files[fileIndex].status = status;
  touch(project, `file:${status}`);
  save();
  if (content !== null) saveFileContent(projectId, project.files[fileIndex].path, content);
}

function contentFilePath(projectId, filePath) {
  const safeName = String(filePath || "").replace(/[\/\\]/g, "__");
  return path.join(CONTENT_DIR, `${projectId}__${safeName}`);
}

function saveFileContent(projectId, filePath, content) {
  try {
    fs.writeFileSync(contentFilePath(projectId, filePath), content, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.error(`Failed to save content for ${filePath}:`, err.message);
  }
}

function getFileContent(projectId, filePath) {
  try { return fs.readFileSync(contentFilePath(projectId, filePath), "utf8"); } catch (_) { return null; }
}

function deleteProjectFiles(projectId) {
  const project = projects[projectId];
  if (!project) return;
  for (const file of project.files) {
    try { const fp = contentFilePath(projectId, file.path); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (err) { console.error("Failed to delete stored file content:", err.message); }
  }
}

function advanceProject(projectId) {
  const project = projects[projectId];
  if (!project) return;
  project.currentIndex++;
  touch(project, "file-progress");
  save();
}

function setProjectStatus(projectId, status) {
  const project = projects[projectId];
  if (!project) return;
  project.status = status;
  touch(project, `status:${status}`);
  save();
}

function recordDeployment(projectId, deployment = {}) {
  const project = projects[projectId];
  if (!project) return null;
  const current = {
    ...(project.deployment || {}),
    provider: deployment.provider || project.deployment?.provider || "vercel",
    deploymentId: deployment.deploymentId || project.deployment?.deploymentId || null,
    vercelProjectId: deployment.vercelProjectId || project.deployment?.vercelProjectId || null,
    url: deployment.url || project.deployment?.url || null,
    target: deployment.target || project.deployment?.target || "preview",
    state: deployment.state || project.deployment?.state || null,
    repository: deployment.repository || project.deployment?.repository || null,
    commit: deployment.commit || project.deployment?.commit || null,
    updatedAt: Date.now(),
  };
  project.deployment = current;
  project.deployments = Array.isArray(project.deployments) ? project.deployments : [];
  project.deployments.push({ ...current });
  project.deployments = project.deployments.slice(-20);
  touch(project, `deploy:${current.provider}`);
  save();
  return project.deployment;
}

function getProgress(project) {
  const total = Array.isArray(project?.files) ? project.files.length : 0;
  const done = (project?.files || []).filter((f) => ["done", "done_with_warning"].includes(f.status)).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

module.exports = {
  createProject,
  getProject,
  getActiveProjectForChat,
  getAllProjectsForChat,
  resolveProjectForChat,
  recordRevision,
  markFileStatus,
  advanceProject,
  setProjectStatus,
  recordDeployment,
  getProgress,
  getFileContent,
  saveFileContent,
  deleteProjectFiles,
  projectName,
  projectSlug,
  _test: { normalizeText, contentFilePath, DATA_DIR, PROJECTS_FILE },
};
