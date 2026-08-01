const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { getAIResponse } = require("./ai");
const { uploadToGofile } = require("./gofileUpload");
const { loadTemplate, matchTemplate: tmplMatch, TEMPLATES } = require("../templates/loader");
const {
  createProject,
  getProject,
  getActiveProjectForChat,
  getAllProjectsForChat,
  markFileStatus,
  advanceProject,
  setProjectStatus,
  getProgress,
  getFileContent,
  saveFileContent,
} = require("./projectState");

const TEMP_DIR = path.join(__dirname, "../../temp");
const MAX_FILES = 12; // hard ceiling per build — keeps requests bounded and Groq-token-realistic
const FILES_PER_BATCH = 4; // generate this many files per !build/!continue call before pausing

// ── Step 1: Plan ──────────────────────────────────────────────
// Dedicated strict system prompt for planning — bypasses ARIA's chatty personality
// prompt entirely, since that prompt was causing the model to wrap JSON output in
// emojis/markdown/commentary, which broke parsing especially on simple requests.
// ── Project Templates ─────────────────────────────────────────────
// Templates loaded from src/templates/ — see loader.js and the template folders
const PROJECT_TEMPLATES = {};
for (const [key, tmpl] of Object.entries(TEMPLATES)) {
  PROJECT_TEMPLATES[key] = {
    name: tmpl.name,
    match: tmpl.match,
    setup: (dir) => loadTemplate(key, dir),
  };
}

// Detect if a request matches a known template
function matchTemplate(request) {
  return tmplMatch(request);
}

// Zip and return the template as a starting point
async function scaffoldFromTemplate(request, templateKey) {
  const template = PROJECT_TEMPLATES[templateKey];
  if (!template) return null;
  return { template: templateKey, name: template.name };
}

const PLANNER_SYSTEM_PROMPT = `You are a JSON-only API. You respond with valid JSON arrays and nothing else. No greetings, no emojis, no markdown formatting, no explanations before or after the JSON. If you add anything other than the raw JSON array, the response will fail to parse and break the system calling you.`;

async function planProject(request, senderName, userId = null) {
  const { getPreferencesContext } = require("../utils/userPreferences");
  const preferencesContext = userId ? getPreferencesContext(userId) : "";

  const prompt = `A user wants this built: "${request}"

Design a file structure for this as a small, realistic project (NOT Hogwarts Legacy — keep scope to something genuinely buildable: a calculator, a todo app, a small landing page, a simple API, a basic game, a small Discord/WhatsApp bot module, etc).

If the user specified particular languages/technologies (e.g. "using only HTML, CSS, and JavaScript", "in Python", "as a React app"), respect that exactly — don't substitute a different stack.${preferencesContext}

Respond ONLY with a JSON array, no other text, no markdown fences. Each item: {"path": "relative/file/path.ext", "description": "what this file does"}.
Max ${MAX_FILES} files. Include only files genuinely needed — no filler.

Example output:
[{"path":"index.html","description":"Main HTML structure with calculator UI"},{"path":"style.css","description":"Styling for the calculator"},{"path":"script.js","description":"Calculator logic and button handlers"}]`;

  const response = await getAIResponse(prompt, senderName, [], PLANNER_SYSTEM_PROMPT, "");

  try {
    let cleaned = response.replace(/```json|```/g, "").trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) cleaned = arrayMatch[0];

    const files = JSON.parse(cleaned);
    if (!Array.isArray(files) || files.length === 0) throw new Error("Empty plan");
    return { success: true, files: files.slice(0, MAX_FILES) };
  } catch (err) {
    error("Plan parsing failed:", err.message, "Raw response:", response.slice(0, 300));
    return { success: false, error: "Couldn't plan this project. Try describing it more simply, e.g. 'a todo app in HTML/CSS/JS'." };
  }
}

// Dedicated system prompt for raw code generation — same reasoning as PLANNER_SYSTEM_PROMPT,
// keeps ARIA's chatty personality from wrapping code output in commentary/emojis.
const CODE_SYSTEM_PROMPT = `You are a code generation engine. You output ONLY raw file content — no greetings, no emojis, no explanations, no markdown code fences. Just the exact file content that should be written to disk.`;

// ── Reviewer Agent ──────────────────────────────────────────────
// Distinct from the Coder above — this is a genuinely separate pass that looks
// at the WHOLE generated project together (not one file at a time), specifically
// hunting for cross-file issues the per-file syntax check can't catch: mismatched
// imports/exports, a file referencing another file that was never created,
// inconsistent naming between files, etc. This is the real fix for the
// "ui.js had an issue, attempting a fix" pattern — that happened because files
// were generated in isolation with no awareness of what the others actually contain.
const REVIEWER_SYSTEM_PROMPT = `You are a code reviewer. You're given multiple files from a small project. Find cross-file problems specifically — things a single-file check would miss:
- A file imports/requires something that doesn't exist in another file
- Function/variable names referenced in one file but never defined anywhere
- Inconsistent naming or API shape between files that are supposed to work together
- A file that's referenced (e.g. in HTML <script src="...">) but wasn't actually generated

Respond ONLY with a JSON array of issues found, no other text. Each item: {"file": "path", "issue": "description", "severity": "high"|"low"}.
If you genuinely find no cross-file issues, respond with an empty array: []`;

async function reviewProjectFiles(projectDir, fileList, senderName) {
  const fileContents = fileList
    .map((f) => {
      try {
        const content = fs.readFileSync(path.join(projectDir, f), "utf8");
        return `=== ${f} ===\n${content.slice(0, 2000)}`;
      } catch (err) {
        return `=== ${f} ===\n[Could not read this file: ${err.message}]`;
      }
    })
    .join("\n\n");

  const prompt = `Here are all the files in this project:\n\n${fileContents}\n\nReview for cross-file issues as instructed.`;

  try {
    const response = await getAIResponse(prompt, senderName, [], REVIEWER_SYSTEM_PROMPT, "");
    let cleaned = response.replace(/```json|```/g, "").trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) cleaned = arrayMatch[0];
    const issues = JSON.parse(cleaned);
    return Array.isArray(issues) ? issues : [];
  } catch (err) {
    error("Reviewer agent failed to produce usable output:", err.message);
    return []; // reviewer failing shouldn't block the build — just means no extra issues caught
  }
}

// ── Step 2: Generate code for one file ────────────────────────
async function generateFileContent(filePlan, projectContext, senderName) {
  const prompt = `You're building a small project. Here's the overall plan:
${projectContext}

Now write the COMPLETE content for this specific file: *${filePlan.path}*
Purpose: ${filePlan.description}

Rules:
- Write the full file content, no placeholders, no "// rest of code here"
- No explanations, no markdown fences — just the raw file content
- Make sure it actually works with the other files in the project (consistent imports, naming, etc)`;

  const response = await getAIResponse(prompt, senderName, [], CODE_SYSTEM_PROMPT, "");
  return response.replace(/^```[\w]*\n?/, "").replace(/```$/, "").trim();
}

// ── Step 2.5: Basic verification — catches obvious syntax errors ──
// Honest scope: this checks JS files with Node's own parser (fast, no deps) and
// does a basic balanced-tag sanity check on HTML. It does NOT run npm install or
// a real build step — that would need a much heavier sandboxed environment than
// a small bot process safely has room for. This catches "obviously broken" output,
// not deep logical bugs.
function verifyFile(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".js" || ext === ".jsx" || ext === ".mjs") {
    try {
      new (require("vm").Script)(content, { filename: filePath });
      return { valid: true };
    } catch (err) {
      // JSX won't parse as plain JS — only flag this for plain .js files
      if (ext === ".js" || ext === ".mjs") {
        return { valid: false, error: err.message };
      }
      return { valid: true }; // skip strict check for jsx, too many false positives
    }
  }

  if (ext === ".json") {
    try {
      JSON.parse(content);
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  if (ext === ".html") {
    const openTags = (content.match(/<(html|head|body|div|script)\b/gi) || []).length;
    const closeTags = (content.match(/<\/(html|head|body|div|script)>/gi) || []).length;
    if (openTags > 0 && closeTags === 0) {
      return { valid: false, error: "No closing tags found — likely incomplete HTML." };
    }
  }

  return { valid: true }; // no specific check for this file type — assume fine
}

// ── Attempt to repair a file that failed verification ──────────
async function repairFile(filePlan, brokenContent, errorMsg, senderName) {
  const prompt = `This file has a syntax error. Fix it and return ONLY the corrected complete file content, no explanations, no markdown fences.

File: ${filePlan.path}
Error: ${errorMsg}

Broken content:
${brokenContent}`;

  const response = await getAIResponse(prompt, senderName, [], CODE_SYSTEM_PROMPT, "");
  return response.replace(/^```[\w]*\n?/, "").replace(/```$/, "").trim();
}

// ── Think mode: show the plan only, don't generate any code yet ──
// Saves the plan as a "pending" project so a follow-up !build can use it
// directly instead of re-planning from scratch.
const pendingPlans = new Map(); // chatId -> { request, files, plannedAt }

async function thinkAboutProject(request, senderName, chatId, userId = null) {
  const planResult = await planProject(request, senderName, userId);
  if (!planResult.success) return planResult;

  pendingPlans.set(chatId, { request, files: planResult.files, plannedAt: Date.now() });

  const fileList = planResult.files.map((f) => `📄 *${f.path}*\n   ${f.description}`).join("\n\n");
  return {
    success: true,
    message: `*🧠 Plan for: ${request}*\n\n${fileList}\n\n_${planResult.files.length} files planned. Say "build it" or \`!build\` to start generating, or describe changes if you want a different approach._`,
  };
}

function getPendingPlan(chatId) {
  const plan = pendingPlans.get(chatId);
  if (!plan) return null;
  // Plans older than 30 min are considered stale — don't silently build something you forgot about
  if (Date.now() - plan.plannedAt > 30 * 60 * 1000) {
    pendingPlans.delete(chatId);
    return null;
  }
  return plan;
}

function clearPendingPlan(chatId) {
  pendingPlans.delete(chatId);
}


async function buildProject(request, senderName, chatId, onProgress, userId = null) {
  // If a !think plan exists for this chat, use it directly instead of re-planning —
  // this is what makes "think first, then build" actually save the planning step
  // rather than silently redoing it.
  const pending = getPendingPlan(chatId);
  let files;

  if (pending) {
    files = pending.files;
    clearPendingPlan(chatId);
    if (onProgress) await onProgress(`🧠 Using the plan from earlier — ${files.length} files. Generating...`);
  } else {
    const planResult = await planProject(request, senderName, userId);
    if (!planResult.success) return planResult;
    files = planResult.files;
  }

  const project = createProject(chatId, request, files);
  if (onProgress) await onProgress(`📐 *Planner:* Designed ${files.length} files for *${request}*.\nProject ID: \`${project.id}\`\n👨‍💻 *Coder:* Starting generation...`);

  return await processProjectBatch(project.id, senderName, onProgress);
}

async function continueProject(chatId, senderName, onProgress, projectId = null) {
  const project = projectId ? getProject(projectId) : getActiveProjectForChat(chatId);

  if (!project) {
    return { success: false, error: "No active project found. Start one with `!build [description]`." };
  }
  if (project.status === "done") {
    return { success: false, error: `Project \`${project.id}\` is already complete.` };
  }
  if (project.status === "cancelled") {
    return { success: false, error: `Project \`${project.id}\` was cancelled.` };
  }

  return await processProjectBatch(project.id, senderName, onProgress);
}

// ── Processes one batch of files (FILES_PER_BATCH at a time), with verification ──
async function processProjectBatch(projectId, senderName, onProgress) {
  const project = getProject(projectId);
  if (!project) return { success: false, error: "Project not found." };

  const projectDir = path.join(TEMP_DIR, `project_${project.id}`);
  fs.mkdirSync(projectDir, { recursive: true });

  const projectContext = project.files.map((f) => `- ${f.path}: ${f.description}`).join("\n");
  const batchEnd = Math.min(project.currentIndex + FILES_PER_BATCH, project.files.length);

  for (let i = project.currentIndex; i < batchEnd; i++) {
    const filePlan = project.files[i];
    if (onProgress) await onProgress(`👨‍💻 *Coder:* Writing ${i + 1}/${project.files.length} — ${filePlan.path}`);

    try {
      let content = await generateFileContent(filePlan, projectContext, senderName);
      let verification = verifyFile(filePlan.path, content);

      // One repair attempt if verification fails — keeps this bounded, not an infinite loop
      if (!verification.valid) {
        if (onProgress) await onProgress(`🔍 *Reviewer:* Found an issue in ${filePlan.path}, sending to Fixer...`);
        content = await repairFile(filePlan, content, verification.error, senderName);
        verification = verifyFile(filePlan.path, content);
      }

      const fullPath = path.join(projectDir, filePlan.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");

      markFileStatus(project.id, i, verification.valid ? "done" : "done_with_warning", content);
    } catch (err) {
      error(`Failed to generate ${filePlan.path}:`, err.message);
      markFileStatus(project.id, i, "failed");
    }

    advanceProject(project.id);
  }

  const updatedProject = getProject(project.id);
  const progress = getProgress(updatedProject);

  // Still more files to go — pause here, tell them to !continue
  if (updatedProject.currentIndex < updatedProject.files.length) {
    setProjectStatus(project.id, "paused");
    return {
      success: true,
      paused: true,
      projectId: project.id,
      progress,
      message: `⏸️ Generated ${progress.done}/${progress.total} files. Reply \`!continue\` to keep going.`,
    };
  }

  // All files done — package and upload
  setProjectStatus(project.id, "done");
  return await finalizeProject(updatedProject, projectDir, onProgress);
}

async function finalizeProject(project, projectDir, onProgress) {
  const doneFiles = project.files.filter((f) => f.status === "done" || f.status === "done_with_warning");
  const warningFiles = project.files.filter((f) => f.status === "done_with_warning");

  if (doneFiles.length === 0) {
    cleanupDir(projectDir);
    return { success: false, error: "Failed to generate any files. Try a simpler request." };
  }

  const readmeContent = `# ${project.goal}\n\nGenerated by ARIA.\n\n## Files\n${doneFiles.map((f) => `- ${f.path}`).join("\n")}\n`;
  fs.writeFileSync(path.join(projectDir, "README.md"), readmeContent, "utf8");

  // Reviewer Agent pass — a genuinely separate look at ALL files together,
  // catching cross-file issues that per-file generation/verification can't see.
  if (onProgress) await onProgress("🔍 *Reviewer:* Checking the whole project for cross-file issues...");
  const crossFileIssues = await reviewProjectFiles(projectDir, doneFiles.map((f) => f.path), project.goal);
  const highSeverityIssues = crossFileIssues.filter((i) => i.severity === "high");

  if (onProgress && crossFileIssues.length > 0) {
    const issueSummary = crossFileIssues.slice(0, 5).map((i) => `• ${i.file}: ${i.issue}`).join("\n");
    await onProgress(`🔍 *Reviewer:* Found ${crossFileIssues.length} cross-file issue(s):\n${issueSummary}`);
  }

  // Real build verification — only for npm-based projects (anything with package.json).
  // Plain HTML/CSS/JS projects skip this since there's nothing to "build."
  // This actually runs npm install + npm run build, not just a syntax check.
  const hasPackageJson = fs.existsSync(path.join(projectDir, "package.json"));
  let buildWarning = null;

  if (hasPackageJson) {
    if (onProgress) await onProgress("🧪 *Tester:* Running npm install + build...");
    const buildResult = await runBuildVerification(projectDir);

    if (!buildResult.success) {
      if (onProgress) await onProgress(`🧪 *Tester:* Build failed, handing off to Fixer...\n${buildResult.error.slice(0, 300)}`);
      const repaired = await attemptBuildRepair(projectDir, buildResult.error, project);

      if (repaired) {
        const retryResult = await runBuildVerification(projectDir);
        if (!retryResult.success) {
          buildWarning = `Build still fails after one auto-repair attempt. You may need to fix this manually:\n${retryResult.error.slice(0, 500)}`;
        }
      } else {
        buildWarning = `Build failed and auto-repair couldn't identify a fix:\n${buildResult.error.slice(0, 500)}`;
      }
    }

    // Clean up node_modules before zipping — no point shipping a huge dependency tree,
    // the recipient will run their own npm install
    cleanupDir(path.join(projectDir, "node_modules"));
  }

  // Optional live preview via Vercel — only attempted for static projects (no
  // package.json/build step) since those deploy instantly with zero config.
  // Entirely skipped if VERCEL_TOKEN isn't set; never blocks the rest of the build.
  let previewUrl = null;
  if (!hasPackageJson && process.env.VERCEL_TOKEN) {
    if (onProgress) await onProgress("🌐 *Deployer:* Setting up a live preview...");
    try {
      const { deployToVercel } = require("./vercelDeploy");
      const { log, error, warn } = require("../utils/logger");
      const deployResult = await deployToVercel(projectDir, project.goal);
      if (deployResult.success) previewUrl = deployResult.url;
    } catch (err) {
      error("Vercel deploy step failed (non-fatal):", err.message);
    }
  }

  if (onProgress) await onProgress("📦 *Packager:* Zipping the project...");

  const zipPath = path.join(TEMP_DIR, `${project.id}.zip`);
  const zipResult = await zipDirectory(projectDir, zipPath);
  cleanupDir(projectDir);

  if (!zipResult.success) return { success: false, error: zipResult.error };

  if (onProgress) await onProgress("☁️ *Uploader:* Sending to Gofile...");

  // Retry upload up to 2 extra times before giving up — covers transient network blips
  let uploadResult = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    uploadResult = await uploadToGofile(zipPath, `${slugify(project.goal)}.zip`);
    if (uploadResult.success) break;
    if (attempt < 2 && onProgress) await onProgress(`📦 *Uploader:* Attempt ${attempt + 1} failed, retrying...`);
  }

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  if (!uploadResult.success) {
    return { success: false, error: `Built successfully but upload failed after 3 attempts: ${uploadResult.error}` };
  }

  return {
    success: true,
    fileCount: doneFiles.length,
    files: doneFiles.map((f) => f.path),
    warnings: warningFiles.map((f) => f.path),
    buildWarning,
    previewUrl,
    crossFileIssues: highSeverityIssues,
    downloadUrl: uploadResult.downloadPage,
  };
}

function getProjectStatus(chatId, projectId = null) {
  const project = projectId ? getProject(projectId) : getActiveProjectForChat(chatId);
  if (!project) return null;
  return { project, progress: getProgress(project) };
}

function listProjects(chatId) {
  return getAllProjectsForChat(chatId).map((p) => ({ ...p, progress: getProgress(p) }));
}

function cancelProject(chatId, projectId = null) {
  const project = projectId ? getProject(projectId) : getActiveProjectForChat(chatId);
  if (!project) return false;
  setProjectStatus(project.id, "cancelled");
  // Clean up any partial files on disk
  const projectDir = path.join(TEMP_DIR, `project_${project.id}`);
  cleanupDir(projectDir);
  return true;
}

// ── Edit an existing file in a completed/in-progress project ──────
// "Reply to the project, say 'add dark mode'" — finds the named file's stored
// content, asks the AI to apply the requested change, saves the new version.
// Only edits ONE file at a time (the one specified); doesn't regenerate the
// whole project, which is the whole point versus just running !build again.
async function editProjectFile(chatId, filename, instruction, senderName, projectId = null) {
  const project = projectId ? getProject(projectId) : getActiveProjectForChat(chatId);
  if (!project) return { success: false, error: "No project found to edit. Build one first with !build." };

  const filePlan = project.files.find((f) => f.path === filename || f.path.endsWith("/" + filename));
  if (!filePlan) {
    const available = project.files.map((f) => f.path).join(", ");
    return { success: false, error: `Couldn't find "${filename}" in this project. Available files: ${available}` };
  }

  const currentContent = getFileContent(project.id, filePlan.path);
  if (currentContent === null) {
    return { success: false, error: `No saved content found for ${filePlan.path} — it may have failed to generate originally.` };
  }

  const prompt = `Here's an existing file from a project called "${project.goal}":

File: ${filePlan.path}

Current content:
${currentContent}

Requested change: "${instruction}"

Apply this change and return the COMPLETE updated file content. No explanations, no markdown fences — just the full file.`;

  const response = await getAIResponse(prompt, senderName, [], CODE_SYSTEM_PROMPT, "");
  const newContent = response.replace(/^```[\w]*\n?/, "").replace(/```$/, "").trim();

  const verification = verifyFile(filePlan.path, newContent);
  saveFileContent(project.id, filePlan.path, newContent);

  return {
    success: true,
    filename: filePlan.path,
    content: newContent,
    warning: verification.valid ? null : `Heads up — this edit may have introduced an issue: ${verification.error}`,
  };
}

// ── Real build verification: actually runs npm install + npm run build ──
// This is genuinely heavier than the syntax check — it executes whatever scripts
// the generated package.json defines. That's an acceptable risk on your own machine
// where you're the one running it, but should NEVER run on a shared/multi-tenant server.
function runBuildVerification(projectDir) {
  return new Promise((resolve) => {
    const installCmd = `cd "${projectDir}" && npm install --no-audit --no-fund 2>&1`;
    exec(installCmd, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (installErr, installOut) => {
      if (installErr) {
        resolve({ success: false, error: `npm install failed:\n${installOut}` });
        return;
      }

      // Only run the build script if one actually exists — not every project has "build"
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
      } catch (err) {
        resolve({ success: true }); // can't read package.json, skip build step rather than fail the whole thing
        return;
      }

      if (!pkg.scripts || !pkg.scripts.build) {
        resolve({ success: true }); // no build script defined — install succeeding is enough
        return;
      }

      const buildCmd = `cd "${projectDir}" && npm run build 2>&1`;
      exec(buildCmd, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (buildErr, buildOut) => {
        if (buildErr) {
          resolve({ success: false, error: `npm run build failed:\n${buildOut}` });
        } else {
          resolve({ success: true });
        }
      });
    });
  });
}

// ── Attempts one repair pass when build verification fails ──────
// Reads the error output, asks the AI which file(s) are likely responsible,
// regenerates just those files, and returns whether a fix was attempted.
async function attemptBuildRepair(projectDir, errorOutput, project) {
  const repairPrompt = `A build failed with this error output:
${errorOutput.slice(0, 1500)}

Project files: ${project.files.map((f) => f.path).join(", ")}

Which ONE file is most likely the cause? Respond with ONLY the file path, nothing else.`;

  try {
    const targetPath = (await getAIResponse(repairPrompt, "system", [], CODE_SYSTEM_PROMPT, "")).trim();
    const fullPath = path.join(projectDir, targetPath);

    if (!fs.existsSync(fullPath)) {
      return false; // AI pointed at a file that doesn't exist, can't proceed safely
    }

    const currentContent = fs.readFileSync(fullPath, "utf8");
    const fixedContent = await repairFile({ path: targetPath, description: "part of the project" }, currentContent, errorOutput.slice(0, 800), "system");

    fs.writeFileSync(fullPath, fixedContent, "utf8");
    return true;
  } catch (err) {
    error("Build repair attempt failed:", err.message);
    return false;
  }
}

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve) => {
    exec(`cd "${sourceDir}" && zip -r "${outPath}" .`, (err, stdout, stderr) => {
      if (err) {
        error("Zip error:", stderr);
        resolve({ success: false, error: "Failed to package the project." });
      } else {
        resolve({ success: true });
      }
    });
  });
}

function cleanupDir(dir) {
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    error("Cleanup failed:", err.message);
  }
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "project";
}

module.exports = { buildProject, continueProject, getProjectStatus, listProjects, cancelProject, thinkAboutProject, getPendingPlan, editProjectFile };
