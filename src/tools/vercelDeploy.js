// ── Vercel deploy (optional) ────────────────────────────────
// Deploys a built project to Vercel for a live preview URL.
// Supports BOTH static sites and build-step projects (package.json).
// Uses the Vercel CLI via npx (auto-detects framework and runs the build);
// falls back to the raw REST files-upload for static-only projects.
// Requires VERCEL_TOKEN in env. If not configured/available, returns
// success:false so the build continues without a preview (never blocks).

const axios = require("axios");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const VERCEL_API = "https://api.vercel.com";

function sanitizeProjectName(value) {
  return String(value || "aria-project").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "aria-project";
}

function redact(value, token = process.env.VERCEL_TOKEN) {
  const text = String(value || "");
  return token ? text.split(token).join("[redacted]") : text;
}

function extractDeploymentUrl(output) {
  const cleaned = redact(output).replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "");
  const matches = cleaned.match(new RegExp("https://(?:[a-z0-9-]+[.])?(?:vercel[.]app|vercel[.]sh|vercel[.]com)(?:/[^\\s)]*)?", "gi")) || [];
  return matches.length ? matches[matches.length - 1].replace(/[),.;]+$/, "") : null;
}

async function verifyDeployment(url) {
  try {
    const response = await axios.get(url, { timeout: 15000, maxContentLength: 2 * 1024 * 1024, validateStatus: () => true });
    if (response.status >= 400) return { success: false, error: `deployment returned HTTP ${response.status}` };
    return { success: true, url };
  } catch (error) {
    return { success: false, error: `deployment URL did not respond: ${error.message}` };
  }
}

function hasPackageJson(dir) {
  return fs.existsSync(path.join(dir, "package.json"));
}

// ── Primary path: Vercel CLI (handles static + framework builds) ──
async function deployViaCli(projectDir, projectName, token) {
  const { log } = require("../utils/logger");
  return new Promise((resolve) => {
    const args = [
      "vercel",
      "deploy",
      projectDir,
      "--prod",
      "--yes",
      "--name",
      sanitizeProjectName(projectName),
    ];
    execFile("npx", args, { env: { ...process.env, VERCEL_TOKEN: token }, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = (stdout || "") + "\n" + (stderr || "");
      log("[vercel] CLI deploy output:", redact(out).slice(-600));
      if (err) return resolve({ success: false, error: "CLI deploy failed: " + redact(err.message || "error") });
      const url = extractDeploymentUrl(out);
      if (url) return verifyDeployment(url).then(resolve);
      return resolve({ success: false, error: "CLI deploy finished but no deployment URL was found in output" });
    });
  });
}

// ── Fallback: REST files-upload (static only) ─────────────────────
async function deployViaApi(projectDir, projectName, token) {
  const { log, error } = require("../utils/logger");
  try {
    const files = [];
    function walk(dir, base) {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (f === "node_modules") continue;
        if (fs.statSync(fp).isDirectory()) { walk(fp, path.join(base, f)); continue; }
        const rel = path.posix.join(base, f);
        files.push({ file: rel, data: fs.readFileSync(fp, "base64"), encoding: "base64" });
      }
    }
    walk(projectDir, "");

    const res = await axios.post(`${VERCEL_API}/v13/deployments`, {
      name: sanitizeProjectName(projectName),
      files,
      projectSettings: { framework: null },
      target: "production",
    }, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    });

    const url = res.data?.url;
    if (url) return verifyDeployment("https://" + url);
    return { success: false, error: "No deployment URL returned" };
  } catch (err) {
    log("Vercel API deploy failed (non-fatal):", redact(err.message));
    return { success: false, error: redact(err.message) };
  }
}

async function deployToVercel(projectDir, projectName) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { success: false, error: "VERCEL_TOKEN not set" };
  const { log } = require("../utils/logger");

  try {
    if (hasPackageJson(projectDir)) {
      // Build-step project: the CLI is required to install deps and build.
      log("[vercel] package.json detected — using CLI for framework build");
      return await deployViaCli(projectDir, projectName, token);
    }
    // Static project: try CLI first (most reliable), fall back to REST API.
    log("[vercel] static project — deploying");
    const cli = await deployViaCli(projectDir, projectName, token);
    if (cli.success) return cli;
    log("[vercel] CLI deploy skipped/failed, falling back to REST API");
    return await deployViaApi(projectDir, projectName, token);
  } catch (err) {
    log("Vercel deploy failed (non-fatal):", redact(err.message));
    return { success: false, error: redact(err.message) };
  }
}

module.exports = { deployToVercel, _test: { sanitizeProjectName, extractDeploymentUrl, redact } };
