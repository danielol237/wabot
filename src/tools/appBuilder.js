const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { generateCodingText } = require("./codingProvider");
const { hasProviderFailureText } = require("./generatedProjectRepair");
const agent = require("./codingAgent");
const actionTask = require("./actionTask");
const {
  createProject, getProject, getActiveProjectForChat, getAllProjectsForChat, resolveProjectForChat,
  recordRevision, markFileStatus, setProjectStatus, recordDeployment, getProgress, getFileContent,
  saveFileContent,
} = require("./projectState");

const pendingPlans = new Map();

function trackBuildEvent(projectId, status, metadata = {}) {
  try { require("../utils/eventLog").trackOperation("build", String(projectId || "unassigned"), status, metadata); } catch (_) {}
}

async function planProject(request, senderName, userId = null) {
  return agent.planProject(request, senderName, userId);
}

async function thinkAboutProject(request, senderName, chatId, userId = null) {
  const result = await planProject(request, senderName, userId);
  if (!result.success) return result;
  pendingPlans.set(chatId, { request, files: result.files, plannedAt: Date.now() });
  return {
    success: true,
    message: `*Plan for: ${request}*\n\n${result.files.map((f) => `- *${f.path}* — ${f.description}`).join("\n")}\n\n${result.files.length} files planned. Say “build it” to generate the complete project.`,
  };
}

function getPendingPlan(chatId) {
  const pending = pendingPlans.get(chatId);
  if (!pending) return null;
  if (Date.now() - pending.plannedAt > 30 * 60 * 1000) { pendingPlans.delete(chatId); return null; }
  return pending;
}

async function buildProject(request, senderName, chatId, onProgress = null, userId = null) {
  const brief = String(request || "").trim();
  if (!brief) return { success: false, error: "Tell me what to build." };
  const task = actionTask.createTask({
    type: "project.build",
    goal: brief,
    chatId,
    steps: [
      { id: "plan", label: "Define project contract" },
      { id: "generate", label: "Generate connected codebase", dependsOn: ["plan"] },
      { id: "verify", label: "Run validation, repair, and runtime checks", dependsOn: ["generate"] },
      { id: "persist", label: "Persist verified project artifact", dependsOn: ["verify"] },
    ],
  });
  try {
    const bridge = require("../core/productBridge");
    bridge.recordProductActivity({ product: "developer", action: "build.requested", context: bridge.ownerContext("developer-whatsapp"), aggregateType: "chat", aggregateId: chatId, metadata: { request: brief.slice(0, 180) }, usage: { category: "developer", metric: "build-requests", units: 1 } });
  } catch (_) {}

  if (onProgress) await onProgress("Understanding the brief and defining the complete project contract...");
  let planned;
  const planStep = await actionTask.runStep(task, "plan", async () => {
    const pending = getPendingPlan(chatId);
    const plan = pending?.files ? { files: pending.files } : await planProject(brief, senderName, userId);
    if (!plan?.files?.length) throw new Error("I could not create a safe project plan.");
    planned = plan.files;
    return { fileCount: planned.length, files: planned.map((file) => file.path) };
  }, { verify: (result) => Number(result?.fileCount) > 0 });
  if (planStep.state !== actionTask.STATES.COMPLETED) return { success: false, task: actionTask.summary(task), error: planStep.error || "I could not create a safe project plan." };
  pendingPlans.delete(chatId);
  const files = agent.mandatoryFiles ? agent.mandatoryFiles(brief, planned) : planned;
  const project = createProject(chatId, brief, files, { workflow: "contract-first" });
  trackBuildEvent(project.id, "planned", { fileCount: files.length, workflow: "contract-first" });
  if (onProgress) await onProgress(`Generating the complete project as one connected codebase (${files.length} files)...`);

  let result;
  const generateStep = await actionTask.runStep(task, "generate", async () => {
    result = await agent.executeBuild({ request: brief, manifest: files, projectId: project.id, onProgress });
    if (!result.success) throw new Error(result.error || "Project generation failed.");
    return { fileCount: result.files?.length || 0, generatedFallback: Boolean(result.generatedFallback) };
  }, { verify: (value) => Number(value?.fileCount) > 0 });
  if (generateStep.state !== actionTask.STATES.COMPLETED) {
    actionTask.finish(task);
    setProjectStatus(project.id, "failed");
    trackBuildEvent(project.id, "failed", { error: generateStep.error, stage: result?.verification?.stage || "generation", taskId: task.id });
    if (result?.root) agent.cleanup(result.root);
    return { success: false, projectId: project.id, error: generateStep.error, verification: result?.verification, task: actionTask.summary(task) };
  }

  const finalPaths = result.files.map((file) => file.path);
  for (let i = 0; i < project.files.length; i += 1) {
    const plannedFile = project.files[i];
    const generated = result.files.find((file) => file.path === plannedFile.path);
    if (generated) markFileStatus(project.id, i, "done", generated.content);
    else markFileStatus(project.id, i, "done_with_warning");
  }
  for (const file of result.files) {
    if (!project.files.some((plannedFile) => plannedFile.path === file.path)) saveFileContent(project.id, file.path, file.content);
  }
  const verifyStep = await actionTask.runStep(task, "verify", async () => {
    if (result.verification?.success !== true) throw new Error("The project did not complete verification.");
    return {
    validation: result.verification?.validation || null,
    browser: result.verification?.browser || null,
    build: result.verification?.build || null,
    };
  }, { verify: (value) => result.verification?.success === true && Boolean(value?.validation) });
  if (verifyStep.state !== actionTask.STATES.COMPLETED) {
    actionTask.finish(task);
    setProjectStatus(project.id, "failed");
    trackBuildEvent(project.id, "failed", { error: verifyStep.error, stage: "verification", taskId: task.id });
    if (result.root) agent.cleanup(result.root);
    return { success: false, projectId: project.id, error: verifyStep.error || "Project verification was not completed.", verification: result.verification, task: actionTask.summary(task) };
  }
  const persistStep = await actionTask.runStep(task, "persist", async () => {
    setProjectStatus(project.id, "done");
    recordRevision(project.id, "verified-build", "Generated and verified as one connected project", finalPaths);
    trackBuildEvent(project.id, "completed", { fileCount: finalPaths.length, workflow: "contract-first", taskId: task.id });
    return { projectId: project.id, fileCount: finalPaths.length };
  }, { verify: (value) => value?.projectId === project.id });
  actionTask.finish(task);
  if (persistStep.state !== actionTask.STATES.COMPLETED) {
    if (result.root) agent.cleanup(result.root);
    return { success: false, projectId: project.id, error: persistStep.error || "The verified project could not be persisted.", task: actionTask.summary(task) };
  }
  try { if (result.root) agent.cleanup(result.root); } catch (_) {}
  return {
    success: true,
    projectId: project.id,
    projectName: project.name,
    fileCount: finalPaths.length,
    files: finalPaths,
    warnings: result.verification.quality?.warnings?.map((w) => w.issue) || [],
    verificationState: "VALID",
    projectValidation: result.verification.validation,
    browserSmoke: result.verification.browser,
    buildVerification: result.verification.build?.skipped ? "not_required" : "passed",
    repairFixes: result.repairFixes,
    qualityWarnings: result.verification.quality?.warnings || [],
    zipPath: result.zipPath,
    generatedFallback: result.generatedFallback,
    task: actionTask.summary(task),
  };
}

async function continueProject(chatId, senderName, onProgress = null, projectId = null) {
  const project = projectId ? getProject(projectId) : getActiveProjectForChat(chatId);
  if (!project) return { success: false, error: "No active project found. Build a new project first." };
  if (project.status === "done") return { success: false, error: `Project ${project.id} is already complete.` };
  return buildProject(project.goal, senderName, chatId, onProgress);
}

function getProjectStatus(chatId, projectReference = null) {
  const project = projectReference ? resolveProjectForChat(chatId, projectReference) : (getActiveProjectForChat(chatId) || resolveProjectForChat(chatId));
  return project ? { project, progress: getProgress(project) } : null;
}
function listProjects(chatId) { return getAllProjectsForChat(chatId).map((project) => ({ ...project, progress: getProgress(project) })); }
function cancelProject(chatId, projectId = null) {
  const project = projectId ? getProject(projectId) : getActiveProjectForChat(chatId);
  if (!project) return false;
  setProjectStatus(project.id, "cancelled");
  return true;
}

function mergePlannedFiles(files, mandatory, max = 12) {
  const out = [];
  const seen = new Set();
  for (const file of [...(mandatory || []), ...(files || [])]) {
    const safe = agent.safeRelativePath(file?.path);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    out.push({ ...file, path: safe });
  }
  return out.slice(0, max);
}

function checkFrontendConsistency(projectDir, files) {
  const result = require("./generatedProjectRepair").repairGeneratedProject(projectDir, files);
  return result.failures.map((item) => ({ file: item.file, issue: item.issue }));
}

async function editProjectFile(chatId, filename, instruction, senderName, projectId = null) {
  const project = projectId ? getProject(projectId) : resolveProjectForChat(chatId);
  if (!project || project.chatId !== chatId) return { success: false, error: "No project found to edit." };
  const file = project.files.find((item) => item.path === filename || item.path.endsWith(`/${filename}`));
  if (!file) return { success: false, error: `Could not find ${filename}. Available files: ${project.files.map((item) => item.path).join(", ")}` };
  const current = getFileContent(project.id, file.path);
  if (current === null) return { success: false, error: `No saved content exists for ${file.path}.` };
  try {
    const response = await generateCodingText(`Update this file as part of the project “${project.goal}”.\nRequested change: ${instruction}\n\nFile: ${file.path}\nCurrent content:\n${current}\n\nReturn only the complete updated file content. Preserve every existing DOM, import, and API contract unless the requested change requires updating it.`, { system: "You are a senior software engineer. Return only complete source content.", maxTokens: 20000, temperature: 0.1 });
    const content = response.replace(/^```[\w-]*\n?/, "").replace(/```$/, "").trim();
    if (!content || hasProviderFailureText(content)) throw new Error("Provider returned unusable source content");
    saveFileContent(project.id, file.path, content);
    recordRevision(project.id, "edit", instruction, [file.path]);
    return { success: true, filename: file.path, content };
  } catch (error) { return { success: false, error: String(error.message || error).slice(0, 500) }; }
}

async function autoUpgradeProject(chatId, instruction, senderName, projectReference = null, onProgress = null) {
  const project = resolveProjectForChat(chatId, projectReference);
  if (!project) return { success: false, error: "I could not find that saved project." };
  const request = String(instruction || "Improve the visual quality, specificity, accessibility, responsiveness, and interactions without changing the product purpose.").trim();
  if (onProgress) await onProgress("Rebuilding the saved project as one connected codebase and rerunning verification...");
  const result = await buildProject(`${project.goal}\nOwner upgrade request: ${request}`, senderName, chatId, onProgress);
  if (!result.success) return result;
  return { success: true, projectId: result.projectId, projectName: result.projectName, revision: getProject(result.projectId)?.revision, changed: result.files, warnings: result.warnings || [] };
}

async function deployProject(chatId, projectId = null, options = {}) {
  const project = projectId ? getProject(projectId) : getAllProjectsForChat(chatId).find((item) => item.status === "done");
  if (!project || project.chatId !== chatId) return { success: false, error: "No completed project found for this chat." };
  const root = fs.mkdtempSync(path.join(require("os").tmpdir(), `aria-deploy-${project.id}-`));
  try {
    for (const file of project.files || []) {
      const content = getFileContent(project.id, file.path);
      const safe = agent.safeRelativePath(file.path);
      if (content === null || !safe) continue;
      const target = path.join(root, safe); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content, "utf8");
    }
    const { deployToVercel } = require("./vercelDeploy");
    const target = options.target === "production" ? "production" : "preview";
    const result = await deployToVercel(root, project.goal, { projectId: project.id, target, vercelProjectId: project.deployment?.vercelProjectId });
    if (result.success) recordDeployment(project.id, { ...result, target });
    return result.success ? { success: true, projectId: project.id, url: result.url, deploymentId: result.deploymentId || null, target } : { success: false, error: result.error || "Vercel deployment failed." };
  } finally { agent.cleanup(root); }
}

function githubHeaders(token) { return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ARIA-Bot" }; }
async function publishProjectToGitHub(chatId, projectId, options = {}) {
  const project = getProject(projectId); const token = String(process.env.GITHUB_TOKEN || "").trim();
  if (!project || project.chatId !== chatId) return { success: false, error: "That project is not available in this chat." };
  if (!token) return { success: false, error: "GitHub delivery was requested, but GITHUB_TOKEN is not configured." };
  const headers = githubHeaders(token); const api = "https://api.github.com";
  try {
    const user = await axios.get(`${api}/user`, { headers, timeout: 15000 });
    const owner = String(process.env.GITHUB_OWNER || user.data?.login || "").trim();
    const repoName = agent.slugify(options.repoName || project.goal);
    const created = await axios.post(`${api}/user/repos`, { name: repoName, private: options.private !== false, auto_init: true, description: `Built and verified by ARIA: ${String(project.goal).slice(0, 180)}` }, { headers, timeout: 15000 });
    const files = [];
    for (const file of project.files || []) { const content = getFileContent(project.id, file.path); const safe = agent.safeRelativePath(file.path); if (content !== null && safe) files.push({ path: safe, content }); }
    files.push({ path: "ARIA_VERIFICATION.md", content: `# ARIA verification\n\nProject: ${project.id}\nStatus: ${project.status}\nGenerated: ${new Date().toISOString()}\n` });
    for (const file of files) await axios.put(`${api}/repos/${owner}/${created.data.name}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}`, { message: `Add ${file.path}`, content: Buffer.from(file.content).toString("base64"), branch: "main" }, { headers, timeout: 20000 });
    recordDeployment(project.id, { provider: "github", url: created.data.html_url, target: "repository", state: "published" });
    return { success: true, owner, repo: created.data.name, url: created.data.html_url, fileCount: files.length };
  } catch (error) { return { success: false, error: `GitHub delivery failed: ${String(error.response?.data?.message || error.message).slice(0, 300)}` }; }
}

module.exports = {
  buildProject, continueProject, deployProject, publishProjectToGitHub, getProjectStatus, listProjects, cancelProject,
  thinkAboutProject, getPendingPlan, editProjectFile, autoUpgradeProject,
  _test: {
    safeRelativePath: agent.safeRelativePath,
    matchTemplate: agent.matchTemplate,
    scaffoldFromTemplate: agent.scaffoldFromTemplate,
    shouldResearchBuild: agent.shouldResearchBuild,
    slugify: agent.slugify,
    fallbackManifest: agent.fallbackManifest,
    normalizeManifest: agent.normalizeManifest,
    normalizeGeneratedFiles: agent.normalizeGeneratedFiles,
    mergePlannedFiles,
    checkFrontendConsistency,
    runBuildVerification: agent.runBuildVerification,
  },
};
