const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const axios = require("axios");
const execFileAsync = promisify(execFile);
const { generateCodingText } = require("../codingProvider");
const { loadTemplate, matchTemplate: templateMatch, TEMPLATES } = require("../../templates/loader");
const { repairGeneratedProject, hasProviderFailureText } = require("../generatedProjectRepair");
const { checkProject } = require("../websiteQuality");
const { runBrowserSmoke } = require("../browserSmoke");
const { validateProject } = require("../projectValidator");
const { verifyPackageInSandbox } = require("./sandboxRunner");
const { analyzeRequirements, contractPrompt } = require("../codingRequirements");

const MAX_FILES = 16;
const TEMP_DIR = path.join(__dirname, "../../../temp");
const CODE_SYSTEM = "You are ARIA's senior coding agent. Return only the requested JSON. Build complete, runnable software. Treat every generated file as part of one shared codebase: define the HTML DOM contract before JavaScript, keep CSS selectors aligned with HTML, keep imports and scripts real, and never use placeholders or generic starter copy.";
const PLAN_SYSTEM = "You are ARIA's software architect. Return only valid JSON. Design a small but complete, runnable project. The file plan is a contract: every reference must point to a file or DOM element that will exist.";

function safeRelativePath(value) {
  const raw = String(value || "").replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || raw.includes("\0") || path.posix.isAbsolute(raw)) return null;
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) return null;
  if (/^(?:\.env(?:\.|$)|node_modules(?:\/|$)|.*(?:secret|credential|token|private[-_]?key))/i.test(raw)) return null;
  return parts.join("/");
}

function cleanJson(text) {
  const raw = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = Math.min(...[raw.indexOf("{"), raw.indexOf("[")].filter((n) => n >= 0));
  const last = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (first < 0 || last < first) throw new Error("Coding provider returned no JSON payload");
  return JSON.parse(raw.slice(first, last + 1));
}

function normalizeManifest(value) {
  const list = Array.isArray(value) ? value : value?.files;
  if (!Array.isArray(list)) throw new Error("Project plan must contain a files array");
  const seen = new Set();
  const files = [];
  for (const item of list) {
    const file = typeof item === "string" ? { path: item, description: "Project file" } : item;
    const safe = safeRelativePath(file?.path);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    files.push({ path: safe, description: String(file.description || "Project file").slice(0, 300) });
  }
  if (!files.length) throw new Error("Project plan contained no safe files");
  return files.slice(0, MAX_FILES);
}

function normalizeGeneratedFiles(value) {
  const list = Array.isArray(value) ? value : value?.files;
  if (!Array.isArray(list)) throw new Error("Generated project must contain a files array");
  const files = [];
  const seen = new Set();
  for (const item of list) {
    const safe = safeRelativePath(item?.path);
    if (!safe || seen.has(safe) || typeof item.content !== "string") continue;
    seen.add(safe);
    if (hasProviderFailureText(item.content)) throw new Error(`Provider failure was returned as source for ${safe}`);
    files.push({ path: safe, content: item.content });
  }
  if (!files.length) throw new Error("Generated project contained no safe file content");
  return files;
}

function mandatoryFiles(request, planned) {
  const lower = String(request || "").toLowerCase();
  const paths = new Set(planned.map((f) => f.path));
  const required = [];
  const add = (p, description) => { if (!paths.has(p)) required.push({ path: p, description }); };
  if (/(website|site|dashboard|landing|frontend|web app|react|vite|javascript|html|css)/.test(lower)) {
    add("index.html", "Complete semantic application shell and DOM contract");
    add("style.css", "Visual system, responsive layout, and states");
    add("app.js", "Interactions wired to the HTML contract");
  }
  if (paths.has("package.json") || /(node|npm|react|vite|server)/.test(lower)) add("package.json", "Runnable scripts and dependencies");
  return [...planned, ...required].slice(0, MAX_FILES);
}

function fallbackManifest(request) {
  const lower = String(request || "").toLowerCase();
  if (/(website|site|dashboard|landing|frontend|web app|html|css|javascript)/.test(lower)) {
    return [
      { path: "index.html", description: "Semantic dashboard shell with navigation, metric cards, activity feed, and settings sections" },
      { path: "style.css", description: "Responsive dark product interface with accessible states" },
      { path: "app.js", description: "Navigation, filtering, and interaction behavior" },
      { path: "README.md", description: "Run instructions and product notes" },
    ];
  }
  return [{ path: "README.md", description: "Run instructions" }];
}

function fallbackFiles(request) {
  const title = String(request || "ARIA workspace").replace(/\s+/g, " ").trim().slice(0, 70) || "ARIA workspace";
  const safeTitle = title.replace(/[&<>"']/g, "");
  return [
    { path: "index.html", content: `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="description" content="A focused ARIA workspace for projects, deployments, and system health.">\n  <meta property="og:title" content="${safeTitle}">\n  <title>${safeTitle}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <div class="app-shell">\n    <aside class="sidebar" aria-label="Primary navigation">\n      <a class="brand" href="#dashboard"><span class="brand-mark">A</span><span>ARIA Console</span></a>\n      <nav class="nav-list">\n        <a class="nav-link active" href="#dashboard" data-section="dashboard">Overview</a>\n        <a class="nav-link" href="#deployments" data-section="deployments">Deployments</a>\n        <a class="nav-link" href="#settings" data-section="settings">Settings</a>\n      </nav>\n      <div class="sidebar-footer"><span class="status-dot"></span><span>All systems operational</span></div>\n    </aside>\n    <main class="main-content">\n      <header class="topbar"><div><p class="eyebrow">Workspace / ${safeTitle}</p><h1>Build with confidence.</h1><p class="lede">A clear view of the work moving through your product.</p></div><button class="primary-button" id="new-project" type="button">New project</button></header>\n      <section id="dashboard" class="dashboard-section" data-section-panel="dashboard">\n        <div class="metric-grid">\n          <article class="metric-card"><span class="metric-label">Active projects</span><strong>12</strong><span class="metric-trend positive">+18.4% this month</span></article>\n          <article class="metric-card"><span class="metric-label">Successful builds</span><strong>98.6%</strong><span class="metric-trend positive">Above target</span></article>\n          <article class="metric-card"><span class="metric-label">Average deploy</span><strong>3m 42s</strong><span class="metric-trend neutral">Last 30 days</span></article>\n        </div>\n        <div class="content-grid">\n          <article class="panel activity-panel"><div class="panel-heading"><div><p class="eyebrow">Live feed</p><h2>Recent activity</h2></div><button class="quiet-button" id="refresh-activity" type="button">Refresh</button></div><ul class="activity-list" id="activity-list"><li><span class="activity-icon success">✓</span><div><strong>Dashboard build verified</strong><span>2 minutes ago · production</span></div></li><li><span class="activity-icon info">↗</span><div><strong>Preview deployed to staging</strong><span>18 minutes ago · web</span></div></li><li><span class="activity-icon warning">!</span><div><strong>Dependency update available</strong><span>1 hour ago · package audit</span></div></li></ul></article>\n          <article class="panel health-panel"><div class="panel-heading"><div><p class="eyebrow">Runtime</p><h2>System health</h2></div><span class="health-badge">Healthy</span></div><div class="health-row"><span>API response</span><strong>124ms</strong></div><div class="health-row"><span>Build queue</span><strong>2 jobs</strong></div><div class="health-row"><span>Uptime</span><strong>99.98%</strong></div></article>\n        </div>\n      </section>\n      <section id="deployments" class="dashboard-section hidden" data-section-panel="deployments"><div class="panel"><p class="eyebrow">Release history</p><h2>Deployments</h2><p class="panel-copy">Your verified releases will appear here with their checks, preview links, and rollback points.</p></div></section>\n      <section id="settings" class="dashboard-section hidden" data-section-panel="settings"><div class="panel"><p class="eyebrow">Workspace controls</p><h2>Settings</h2><p class="panel-copy">Configure environments, notifications, and delivery preferences from one place.</p></div></section>\n    </main>\n  </div>\n  <script src="app.js"></script>\n</body>\n</html>\n` },
    { path: "style.css", content: `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#edf2f7;background:#0b1018;line-height:1.5;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-width:320px;background:radial-gradient(circle at 80% 0%,#1b2940 0,#0b1018 42%);color:#edf2f7}.app-shell{display:flex;min-height:100vh}.sidebar{width:248px;padding:28px 18px;border-right:1px solid #253247;background:#0d1420;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-weight:700}.brand-mark{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#7c5cff;color:white}.nav-list{display:grid;gap:8px;margin-top:56px}.nav-link{padding:11px 14px;border-radius:9px;color:#91a0b8;text-decoration:none}.nav-link:hover,.nav-link.active{background:#1b2940;color:#fff}.sidebar-footer{margin-top:auto;color:#8290a8;font-size:12px;display:flex;align-items:center;gap:8px}.status-dot{width:8px;height:8px;border-radius:50%;background:#46d39a;box-shadow:0 0 0 4px #46d39a22}.main-content{width:min(1240px,100%);padding:56px clamp(22px,5vw,72px)}.topbar{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:42px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:#8191aa;font-size:11px;font-weight:700;margin:0 0 10px}.topbar h1{font-size:clamp(32px,4vw,54px);letter-spacing:-.055em;line-height:1.02;margin:0 0 12px}.lede,.panel-copy{color:#91a0b8;max-width:600px;margin:0}.primary-button,.quiet-button{border:0;border-radius:9px;padding:12px 17px;font:inherit;cursor:pointer}.primary-button{background:#8b72ff;color:#fff;box-shadow:0 8px 24px #8b72ff33}.quiet-button{background:transparent;color:#b7c2d3}.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px}.metric-card,.panel{border:1px solid #253247;background:#111a28;border-radius:16px;padding:22px}.metric-card{display:grid;gap:8px}.metric-label{font-size:13px;color:#91a0b8}.metric-card strong{font-size:32px;letter-spacing:-.04em}.metric-trend{font-size:12px}.positive{color:#46d39a}.neutral{color:#91a0b8}.content-grid{display:grid;grid-template-columns:1.45fr 1fr;gap:16px}.panel-heading{display:flex;justify-content:space-between;align-items:start;margin-bottom:20px}.panel h2{margin:0;font-size:20px;letter-spacing:-.02em}.activity-list{list-style:none;padding:0;margin:0;display:grid;gap:2px}.activity-list li{display:flex;gap:14px;align-items:center;padding:15px 0;border-bottom:1px solid #253247}.activity-list li:last-child{border-bottom:0}.activity-list strong,.activity-list span{display:block}.activity-list strong{font-size:14px}.activity-list div span{font-size:12px;color:#8191aa;margin-top:3px}.activity-icon{display:grid!important;place-items:center;width:32px;height:32px;border-radius:9px;background:#182435;font-weight:800}.success{color:#46d39a}.info{color:#8faaff}.warning{color:#ffca72}.health-badge{font-size:12px;color:#46d39a;background:#46d39a18;border:1px solid #46d39a55;border-radius:999px;padding:5px 9px}.health-row{display:flex;justify-content:space-between;padding:16px 0;border-bottom:1px solid #253247;color:#91a0b8;font-size:14px}.health-row:last-child{border:0}.health-row strong{color:#edf2f7}.hidden{display:none!important}@media(max-width:820px){.sidebar{width:76px;padding:24px 12px}.brand span:last-child,.nav-link{font-size:0}.nav-link:before{content:'•';font-size:20px}.sidebar-footer{font-size:0}.main-content{padding:34px 18px}.topbar{align-items:start;flex-direction:column}.metric-grid,.content-grid{grid-template-columns:1fr}.metric-card strong{font-size:28px}}` },
    { path: "app.js", content: `(() => {\n  const panels = [...document.querySelectorAll('.dashboard-section')];\n  const links = [...document.querySelectorAll('.nav-link[data-section]')];\n  function showSection(name) {\n    panels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.sectionPanel !== name));\n    links.forEach((link) => link.classList.toggle('active', link.dataset.section === name));\n  }\n  links.forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); showSection(link.dataset.section); history.replaceState(null, '', '#' + link.dataset.section); }));\n  document.getElementById('refresh-activity')?.addEventListener('click', (event) => { event.currentTarget.textContent = 'Updated'; setTimeout(() => { event.currentTarget.textContent = 'Refresh'; }, 1200); });\n  document.getElementById('new-project')?.addEventListener('click', () => { window.alert('Project creation is ready for your next brief.'); });\n  showSection(location.hash.slice(1) || 'dashboard');\n})();\n` },
    { path: "README.md", content: `# ${safeTitle}\n\nA verified ARIA-generated project.\n\n## Run\n\nOpen index.html in a browser.\n` },
  ];
}

async function planProject(request) {
  const fallback = fallbackManifest(request);
  const requirements = await analyzeRequirements(request);
  try {
    const response = await generateCodingText(`Create the complete file manifest for this product contract:\n${contractPrompt(requirements)}\n\nReturn JSON: {"files":[{"path":"relative/path","description":"purpose"}]}. Include every file needed for a complete runnable project, documentation, and the requested interactions. Keep it under ${MAX_FILES} files.`, { system: PLAN_SYSTEM, maxTokens: 4000, temperature: 0.1 });
    return { success: true, requirements, files: mandatoryFiles(request, normalizeManifest(cleanJson(response))) };
  } catch (error) {
    return { success: false, requirements, fallback: false, providerError: error.code || "CODING_PROVIDER_ERROR", error: `I could not safely plan this project: ${String(error.message || error).slice(0, 700)}` };
  }
}

async function generateWholeProject(request, manifest, requirements = null) {
  try {
    const contract = requirements || await analyzeRequirements(request);
    const response = await generateCodingText(`Implement this complete product, not a code sample.\n\nPRODUCT CONTRACT:\n${contractPrompt(contract)}\n\nFILE CONTRACT:\n${manifest.map((f) => `- ${f.path}: ${f.description}`).join("\n")}\n\nReturn JSON only in this exact shape: {"files":[{"path":"...","content":"complete file content"}]}. Return every planned file, with complete content. Implement the user's actual domain instead of a generic dashboard. Include realistic copy, working interactions, responsive behavior, accessibility, error/empty states, and README run instructions. Do not use markdown fences, placeholder copy, fake buttons, undefined DOM selectors, missing in-page targets, invented imports, or unexplained dependencies. HTML, CSS, JavaScript, and package scripts must share one explicit contract.`, { system: CODE_SYSTEM, maxTokens: 60000, temperature: 0.15 });
    const files = normalizeGeneratedFiles(cleanJson(response));
    const generatedPaths = new Set(files.map((file) => file.path));
    const missing = manifest.map((file) => file.path).filter((file) => !generatedPaths.has(file));
    if (missing.length) throw new Error(`Coding provider omitted planned files: ${missing.join(", ")}`);
    return { success: true, files, requirements: contract };
  } catch (error) {
    return { success: false, error: `Complete project generation failed: ${String(error.message || error).slice(0, 700)}`, providerError: error.code || "CODING_PROVIDER_ERROR" };
  }
}

function writeFiles(root, files) {
  fs.mkdirSync(root, { recursive: true });
  for (const file of files) {
    const safe = safeRelativePath(file.path);
    if (!safe) throw new Error(`Unsafe generated path: ${file.path}`);
    const target = path.join(root, safe);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, "utf8");
  }
}

function readProjectFiles(root) {
  const out = [];
  function walk(dir, base = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", ".cache", "coverage"].includes(entry.name)) continue;
      const rel = path.posix.join(base, entry.name);
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out.push({ path: rel, content: fs.readFileSync(full, "utf8") });
    }
  }
  walk(root);
  return out;
}

async function runBuildVerification(root) {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) return { success: true, skipped: true };
  return verifyPackageInSandbox(root);
}

async function browserCheck(root) {
  if (!fs.existsSync(path.join(root, "index.html")) || process.env.ARIA_SKIP_BROWSER_SMOKE === "true") return { success: true, skipped: true };
  return runBrowserSmoke(root, { timeoutMs: 30000 });
}

async function verifyProject(root, files) {
  const paths = files.map((f) => f.path || f);
  const repair = repairGeneratedProject(root, paths);
  if (repair.failures.length) return { success: false, stage: "artifact", repair, error: repair.failures.map((f) => `${f.file}: ${f.issue}`).join("; ") };
  const validation = validateProject(root);
  const quality = checkProject(root, paths);
  if (validation.errors.length || quality.blocking.length) {
    return { success: false, stage: "static", repair, validation, quality, error: [...validation.errors.map((e) => `${e.file || "project"}: ${e.message}`), ...quality.blocking.map((e) => `${e.file}: ${e.issue}`)].slice(0, 12).join("; ") };
  }
  const build = await runBuildVerification(root);
  if (!build.success) return { success: false, stage: "build", repair, validation, quality, build, error: build.error };
  const browser = await browserCheck(root);
  if (!browser.success) return { success: false, stage: "browser", repair, validation, quality, build, browser, error: browser.error };
  return { success: true, repair, validation, quality, build, browser };
}

async function repairWithProvider(root, request, failure) {
  try {
    const current = readProjectFiles(root);
    const response = await generateCodingText(`Repair this complete project, not just one file.\nBrief: ${request}\nFailure: ${failure}\n\nCurrent files:\n${current.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n").slice(0, 50000)}\n\nReturn JSON only: {"files":[{"path":"...","content":"complete corrected content"}]}. Return every file you change, preserving all unchanged files' contracts. Fix the root cause across HTML, CSS, and JavaScript together.`, { system: CODE_SYSTEM, maxTokens: 50000, temperature: 0.1 });
    const files = normalizeGeneratedFiles(cleanJson(response));
    writeFiles(root, files);
    return { success: true, files };
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
}

async function zipDirectory(root, outPath) {
  try { await execFileAsync("zip", ["-qr", outPath, "."], { cwd: root, timeout: 120000 }); return { success: true }; }
  catch (error) { return { success: false, error: `Failed to package the project: ${error.message}` }; }
}

function cleanup(root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} }

async function executeBuild({ request, manifest, requirements, projectId, onProgress }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aria-build-${projectId || "project"}-`));
  try {
    const generated = await generateWholeProject(request, manifest, requirements);
    if (!generated.success) return generated;
    writeFiles(root, generated.files);
    const paths = generated.files.map((f) => f.path);
    let verification = await verifyProject(root, generated.files);
    let repairs = [...(verification.repair?.fixes || [])];
    for (let attempt = 0; !verification.success && attempt < 2; attempt += 1) {
      if (onProgress) await onProgress(`Repair pass ${attempt + 1}/2: ${verification.stage} failure`);
      const deterministic = repairGeneratedProject(root, paths);
      repairs.push(...deterministic.fixes);
      verification = await verifyProject(root, readProjectFiles(root));
      if (verification.success) break;
      const aiRepair = await repairWithProvider(root, request, verification.error);
      if (!aiRepair.success) break;
      verification = await verifyProject(root, readProjectFiles(root));
    }
    if (!verification.success) return { success: false, error: `Project could not be verified after complete-project repair: ${verification.error}`, verification, generatedFallback: generated.fallback, requirements: generated.requirements };
    const finalFiles = readProjectFiles(root);
    const zipPath = path.join(TEMP_DIR, `${projectId || Date.now()}.zip`);
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const zipped = await zipDirectory(root, zipPath);
    if (!zipped.success) return { success: false, error: zipped.error };
    return { success: true, files: finalFiles, repairFixes: repairs, verification, zipPath, generatedFallback: generated.fallback, requirements: generated.requirements, root };
  } catch (error) { return { success: false, error: String(error.message || error) }; }
  finally { /* root is retained until the caller copies project files, then removed */ }
}

function matchTemplate(request) { return templateMatch(String(request || "")); }
function scaffoldFromTemplate(request, key) { const template = TEMPLATES[key]; return template ? { template: key, name: template.name, request, files: template.files.map((p) => ({ path: p, description: `${template.name} starter ${p}` })) } : null; }
function shouldResearchBuild(request) {
  const text = String(request || "").trim();
  return text.length < 90 || /real[- ]world|problem|dataset|research|integrated|solution bundle|hackathon|capstone|social impact|for farmers|for students/i.test(text);
}
function slugify(text) { return String(text || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "project"; }

module.exports = { planProject, generateWholeProject, executeBuild, verifyProject, safeRelativePath, matchTemplate, scaffoldFromTemplate, shouldResearchBuild, slugify, readProjectFiles, writeFiles, cleanup, fallbackManifest, fallbackFiles, mandatoryFiles, normalizeManifest, normalizeGeneratedFiles, runBuildVerification };
