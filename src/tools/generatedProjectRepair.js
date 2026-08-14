const fs = require("fs");
const path = require("path");

const PROVIDER_FAILURE_RE = /AI request failed on all providers|user not found|cerebras\/gemini\/groq\/openrouter all tried/i;

function readText(projectDir, relativePath) {
  try { return fs.readFileSync(path.join(projectDir, relativePath), "utf8"); } catch (_) { return null; }
}

function hasProviderFailureText(content) {
  return typeof content === "string" && PROVIDER_FAILURE_RE.test(content.slice(0, 4000));
}

function normalizePackage(projectDir, files) {
  const relativePath = files.includes("package.json") ? "package.json" : null;
  if (!relativePath) return { fixes: [], changed: {} };
  const filePath = path.join(projectDir, relativePath);
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_) { return { fixes: [], changed: {} }; }
  const sourceFiles = files.filter((file) => /\.(?:js|cjs|mjs|jsx|ts|tsx)$/.test(file));
  const source = sourceFiles.map((file) => readText(projectDir, file) || "").join("\n");
  const fixes = [];
  if (pkg.type === "module" && /\brequire\s*\(|\bmodule\.exports\b|__dirname\b/.test(source)) {
    delete pkg.type;
    fixes.push("removed package.json type=module because generated server/config files use CommonJS");
  }
  pkg.scripts = { ...(pkg.scripts || {}) };
  if (files.includes("server.js") && !pkg.scripts.start) {
    pkg.scripts.start = "node server.js";
    fixes.push("added npm start for server.js");
  }
  if (files.includes("vite.config.js")) {
    if (!pkg.scripts.dev) { pkg.scripts.dev = "vite"; fixes.push("added npm run dev for Vite"); }
    if (!pkg.scripts.build) { pkg.scripts.build = "vite build"; fixes.push("added npm run build for Vite"); }
  }
  if (!fixes.length) return { fixes, changed: {} };
  const content = JSON.stringify(pkg, null, 2) + "\n";
  fs.writeFileSync(filePath, content, "utf8");
  return { fixes, changed: { [relativePath]: content } };
}

function inspectGeneratedArtifacts(projectDir, files) {
  const failures = [];
  for (const relativePath of files) {
    if (!/\.(?:css|html|js|cjs|mjs|jsx|ts|tsx|json)$/.test(relativePath)) continue;
    const content = readText(projectDir, relativePath);
    if (content !== null && hasProviderFailureText(content)) {
      failures.push({ file: relativePath, issue: "The file contains a raw AI-provider failure instead of generated source content." });
    }
  }
  return failures;
}

function repairGeneratedProject(projectDir, files) {
  const normalized = normalizePackage(projectDir, files);
  const failures = inspectGeneratedArtifacts(projectDir, files);
  return { fixes: normalized.fixes, changed: normalized.changed, failures };
}

module.exports = { repairGeneratedProject, hasProviderFailureText };
