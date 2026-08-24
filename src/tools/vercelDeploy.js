// ── Vercel deployment integration ─────────────────────────────
// Preview-first deployment for generated projects. Production promotion is
// explicit, deployment names are project-scoped, and file uploads are bounded.

const axios = require("axios");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const VERCEL_API = "https://api.vercel.com";
const VERCEL_CLI_VERSION = "59.5.0";
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

function sanitizeProjectName(value) {
  return String(value || "aria-project").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "aria-project";
}

function deploymentName(projectName, projectId) {
  const suffix = projectId ? `-${sanitizeProjectName(projectId).slice(-10)}` : "";
  const base = sanitizeProjectName(projectName || "aria-project");
  return sanitizeProjectName(`${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`);
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

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function verifyDeployment(url, { timeoutMs = 120000, intervalMs = 2500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await axios.get(url, { timeout: 15000, maxContentLength: 2 * 1024 * 1024, validateStatus: () => true });
      lastStatus = response.status;
      if (response.status >= 200 && response.status < 400) return { success: true, url, status: response.status };
      lastError = `deployment returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(intervalMs);
  }
  return { success: false, url, error: `${lastError || "deployment did not become ready"}${lastStatus ? ` (last HTTP ${lastStatus})` : ""}` };
}

function safeFiles(projectDir) {
  const files = [];
  let totalBytes = 0;
  function walk(dir, base) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".cache" || entry.name === "coverage") continue;
      const fp = path.join(dir, entry.name);
      const stat = fs.lstatSync(fp);
      if (stat.isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${fp}`);
      if (stat.isDirectory()) { walk(fp, path.posix.join(base, entry.name)); continue; }
      if (!stat.isFile()) throw new Error(`special files are not allowed: ${fp}`);
      totalBytes += stat.size;
      if (files.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES) throw new Error("deployment exceeds file or size limits");
      const rel = path.posix.join(base, entry.name);
      const data = fs.readFileSync(fp);
      files.push({ file: rel, data, sha: crypto.createHash("sha1").update(data).digest("hex"), size: data.length });
    }
  }
  walk(projectDir, "");
  return files;
}

function cliEnv(token) {
  return {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME || "/tmp",
    VERCEL_TOKEN: token,
    CI: "1",
  };
}

async function deployViaCli(projectDir, projectName, token, options = {}) {
  const { log } = require("../utils/logger");
  const target = options.target === "production" ? "production" : "preview";
  const name = deploymentName(projectName, options.projectId);
  return new Promise((resolve) => {
    const args = ["--yes", `vercel@${VERCEL_CLI_VERSION}`, "deploy", projectDir, "--yes", "--name", name];
    if (target === "production") args.push("--prod");
    else args.push("--target=preview");
    execFile("npx", args, { env: cliEnv(token), timeout: 180000, maxBuffer: 4 * 1024 * 1024 }, async (err, stdout, stderr) => {
      const out = (stdout || "") + "\n" + (stderr || "");
      log("[vercel] CLI deploy output:", redact(out).slice(-800));
      if (err) return resolve({ success: false, error: "CLI deploy failed: " + redact(err.message || "error") });
      const url = extractDeploymentUrl(stdout || out);
      if (!url) return resolve({ success: false, error: "CLI deploy finished but no deployment URL was found in output" });
      resolve(await verifyDeployment(url));
    });
  });
}

async function uploadFile(file, token) {
  await axios.post(`${VERCEL_API}/v2/files`, file.data, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": file.size,
      "x-vercel-digest": file.sha,
    },
    timeout: 30000,
    maxContentLength: 0,
    maxBodyLength: MAX_TOTAL_BYTES,
  });
}

async function deployViaApi(projectDir, projectName, token, options = {}) {
  const { log } = require("../utils/logger");
  try {
    const files = safeFiles(projectDir);
    for (const file of files) await uploadFile(file, token);
    const body = {
      name: deploymentName(projectName, options.projectId),
      files: files.map(({ file, sha, size }) => ({ file, sha, size })),
      projectSettings: { framework: null },
      target: options.target === "production" ? "production" : "preview",
    };
    if (options.vercelProjectId) body.project = options.vercelProjectId;
    const res = await axios.post(`${VERCEL_API}/v13/deployments`, body, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: 30000,
      maxContentLength: 2 * 1024 * 1024,
      maxBodyLength: 2 * 1024 * 1024,
    });
    const url = res.data?.url ? `https://${res.data.url}` : null;
    if (!url) return { success: false, error: "No deployment URL returned" };
    const verified = await verifyDeployment(url);
    return { ...verified, deploymentId: res.data?.id || null, vercelProjectId: res.data?.projectId || options.vercelProjectId || null };
  } catch (err) {
    log("Vercel API deploy failed (non-fatal):", redact(err.message));
    return { success: false, error: redact(err.message) };
  }
}

async function deployToVercel(projectDir, projectName, options = {}) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { success: false, error: "VERCEL_TOKEN not set" };
  const { log } = require("../utils/logger");
  const target = options.target === "production" ? "production" : "preview";

  try {
    log(`[vercel] deploying ${fs.existsSync(path.join(projectDir, "package.json")) ? "package" : "static"} project through pinned CLI`);
    const cli = await deployViaCli(projectDir, projectName, token, { ...options, target });
    if (cli.success) return cli;
    log("[vercel] CLI deploy failed, falling back to documented upload API");
    const api = await deployViaApi(projectDir, projectName, token, { ...options, target });
    return api.success ? api : { success: false, error: `${cli.error || "CLI deployment failed"}; API fallback: ${api.error || "failed"}` };
  } catch (err) {
    log("Vercel deploy failed (non-fatal):", redact(err.message));
    return { success: false, error: redact(err.message) };
  }
}

module.exports = {
  deployToVercel,
  _test: { sanitizeProjectName, deploymentName, extractDeploymentUrl, redact, safeFiles },
};
