// Dependency-aware project validation for generated projects.
// This is deliberately deterministic: unknown checks are NOT_VERIFIED, never silently valid.
const fs = require("fs");
const path = require("path");

const STATES = Object.freeze({ VALID: "VALID", INVALID: "INVALID", NOT_VERIFIED: "NOT_VERIFIED" });
const SOURCE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx"]);
const BUILTIN_MODULES = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https", "module",
  "net", "os", "path", "process", "stream", "string_decoder", "timers", "tls", "url", "util", "url", "zlib",
]);

function listFiles(root, out = [], base = "") {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (["node_modules", ".git", ".cache", "coverage"].includes(entry.name)) continue;
    const rel = path.posix.join(base, entry.name);
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) listFiles(full, out, rel);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
}

function packageName(specifier) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) return null;
  if (specifier.startsWith("node:")) return specifier.slice(5).split("/")[0];
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}

function sourceImports(content) {
  const found = new Set();
  const patterns = [
    /(?:import\s+(?:[^"']+?\s+from\s+)?|export\s+[^"']+?\s+from\s+|require\s*\(\s*)["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content))) found.add(match[1]);
  }
  return [...found];
}

function resolveSource(root, specifier, fromFile) {
  const base = path.resolve(root, path.dirname(fromFile), specifier);
  const candidates = [base, ...[".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".json"].map((ext) => `${base}${ext}`)];
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return path.relative(root, candidate); } catch (_) {}
  }
  for (const index of ["index.js", "index.ts", "index.jsx", "index.tsx"]) {
    try { if (fs.statSync(path.join(base, index)).isFile()) return path.relative(root, path.join(base, index)); } catch (_) {}
  }
  return null;
}

function validateProject(root) {
  const files = listFiles(root);
  const fileSet = new Set(files.map((f) => f.replaceAll("\\", "/")));
  const errors = [];
  const warnings = [];
  const checks = { syntax: STATES.NOT_VERIFIED, dependencies: STATES.NOT_VERIFIED, imports: STATES.NOT_VERIFIED, scripts: STATES.NOT_VERIFIED, env: STATES.NOT_VERIFIED };
  const packageFile = path.join(root, "package.json");
  const pkg = fs.existsSync(packageFile) ? readJson(packageFile) : null;

  if (fs.existsSync(packageFile) && !pkg) {
    errors.push({ check: "package", message: "package.json is not valid JSON" });
    checks.syntax = STATES.INVALID;
  } else if (pkg) checks.syntax = STATES.VALID;
  else checks.syntax = STATES.NOT_VERIFIED;

  const declared = new Set(Object.keys({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}), ...(pkg?.optionalDependencies || {}) }));
  const imports = [];
  for (const file of files) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    let content;
    try { content = fs.readFileSync(path.join(root, file), "utf8"); } catch (error) { errors.push({ check: "read", file, message: error.message }); continue; }
    for (const specifier of sourceImports(content)) imports.push({ file, specifier });
  }
  if (pkg) {
    checks.dependencies = STATES.VALID;
    for (const item of imports) {
      const dep = packageName(item.specifier);
      if (dep && !BUILTIN_MODULES.has(dep) && !declared.has(dep)) {
        errors.push({ check: "dependencies", file: item.file, message: `Imported package "${dep}" is not declared in package.json` });
        checks.dependencies = STATES.INVALID;
      }
    }
  }
  if (imports.length) {
    checks.imports = STATES.VALID;
    for (const item of imports) {
      if (!item.specifier.startsWith(".")) continue;
      if (!resolveSource(root, item.specifier, item.file)) {
        errors.push({ check: "imports", file: item.file, message: `Imported local module "${item.specifier}" does not exist` });
        checks.imports = STATES.INVALID;
      }
    }
  } else checks.imports = STATES.NOT_VERIFIED;

  if (pkg) {
    checks.scripts = STATES.VALID;
    for (const name of ["build", "start", "dev", "test"]) {
      if (pkg.scripts?.[name] && typeof pkg.scripts[name] !== "string") {
        errors.push({ check: "scripts", message: `package script "${name}" is not a string` });
        checks.scripts = STATES.INVALID;
      }
    }
    if (!pkg.scripts || Object.keys(pkg.scripts).length === 0) warnings.push({ check: "scripts", message: "package.json has no scripts; build/runtime verification is limited" });
  }

  const envNames = new Set();
  for (const file of files) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const content = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) envNames.add(match[1]);
  }
  if (envNames.size) {
    checks.env = STATES.NOT_VERIFIED;
    const example = fs.existsSync(path.join(root, ".env.example")) ? fs.readFileSync(path.join(root, ".env.example"), "utf8") : "";
    const missing = [...envNames].filter((name) => !new RegExp(`^${name}=`, "m").test(example));
    if (missing.length) warnings.push({ check: "env", message: `Environment variables are referenced without documentation: ${missing.join(", ")}` });
  }

  const invalid = errors.length > 0;
  return {
    state: invalid ? STATES.INVALID : STATES.VALID,
    checks,
    files,
    imports,
    errors,
    warnings,
    verifiedAt: new Date().toISOString(),
  };
}

module.exports = { STATES, validateProject, _test: { sourceImports, packageName, resolveSource } };
