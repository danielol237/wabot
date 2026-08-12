// ── ARIA Sandboxed Code Executor ──────────────────────────────
// Runs code inside a Docker container with hard isolation:
//   • non-root user (uid 1000)
//   • no network access (--network none)
//   • read-only filesystem with a small writable /tmp tmpfs
//   • CPU, memory, and timeout limits
//   • auto-kill on timeout
// If Docker isn't available, it FALLS BACK to the old timeout-only executor
// and flags the run as UNSANDBOXED so callers know the risk.

const { execFile, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { log, error, warn } = require("../utils/logger");

const TEMP_DIR = path.join(__dirname, "../../temp");
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || "node:20-slim";

// Preflight: is docker available on this host?
let dockerAvailable = null;
function checkDocker() {
  if (dockerAvailable !== null) return dockerAvailable;
  return new Promise((resolve) => {
    execFile("docker", ["--version"], { timeout: 5000 }, (err) => {
      dockerAvailable = !err;
      resolve(dockerAvailable);
    });
  });
}

// ── Primary: run in a sandboxed container ─────────────────────
async function runSandboxed(code, lang, opts = {}) {
  const id = uuidv4();
  const ext = lang === "python" || lang === "py" ? "py"
    : lang === "sh" || lang === "bash" ? "sh"
    : lang === "js" || lang === "node" ? "js" : "js";

  const filePath = path.join(TEMP_DIR, `${id}.${ext}`);
  fs.writeFileSync(filePath, code);

  const containerName = `aria-sandbox-${id}`;
  // Which interpreter runs inside the container
  let runCmd;
  if (lang === "js" || lang === "node") runCmd = ["node", `/work/main.${ext}`];
  else if (lang === "py" || lang === "python") runCmd = ["python3", `/work/main.${ext}`];
  else if (lang === "sh" || lang === "bash") runCmd = ["bash", `/work/main.${ext}`];
  else runCmd = ["node", `/work/main.${ext}`];

  const timeoutSec = opts.timeout || 15;
  const memLimit = opts.memory || "128m";
  const cpuLimit = opts.cpus || "0.5";

  const dockerArgs = [
    "run", "--rm",
    "--name", containerName,
    "--network", "none",
    "--user", "1000:1000",
    "--read-only",
    "--tmpfs", "/tmp:size=32m",
    "--memory", memLimit,
    "--cpus", cpuLimit,
    // ── Abuse hardening (fork-bomb / process-exhaustion / privilege-escape) ──
    "--pids-limit", "64",                       // hard cap on processes (no fork bomb)
    "--cap-drop", "ALL",                        // no Linux capabilities
    "--security-opt", "no-new-privileges",      // can't escalate via setuid/execve
    "--ulimit", "nproc=64:64",                  // per-user process limit
    "--ulimit", "nofile=64:64",                 // file-descriptor limit
    "--stop-timeout", "3",
    "-v", `${filePath}:/work/main.${ext}:ro`,
    "-w", "/work",
    SANDBOX_IMAGE,
    ...runCmd,
  ];

  return new Promise((resolve) => {
    execFile("docker", dockerArgs, { timeout: (timeoutSec + 5) * 1000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(filePath); } catch (_) {}
      const output = (stdout || stderr || "").slice(0, 4000);
      if (err && err.killed) {
        return resolve({ success: false, output: "❌ Timed out / killed in sandbox.", sandboxed: true });
      }
      if (err) {
        // err.message often contains "docker: ..." — keep the useful part
        return resolve({ success: false, output: (stderr || err.message).slice(0, 2000), sandboxed: true });
      }
      resolve({ success: true, output: output || "(no output)", sandboxed: true });
    });
  });
}

// ── Fallback: timeout-only (UNSANDBOXED — unsafe, avoid) ──────
// Only reachable via an EXPLICIT allowUnsafe:true opt-in. Default-safe: by
// default untrusted/learner code is BLOCKED, never silently run on the host
// process that holds WhatsApp/GitHub/DB credentials.
function runUnsafe(code, lang, opts = {}) {
  const id = uuidv4();
  const ext = lang === "python" || lang === "py" ? "py"
    : lang === "sh" || lang === "bash" ? "sh" : "js";
  const filePath = path.join(TEMP_DIR, `${id}.${ext}`);
  fs.writeFileSync(filePath, code);
  const cmd = lang === "sh" || lang === "bash" ? "bash" : lang === "py" || lang === "python" ? "python3" : "node";

  return new Promise((resolve) => {
    exec(`${cmd} "${filePath}"`, { timeout: (opts.timeout || 15) * 1000, maxBuffer: 1024 * 500 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(filePath); } catch (_) {}
      const output = (stdout || stderr || "(no output)").slice(0, 4000);
      resolve({ success: !err || !!stdout, output, sandboxed: false });
    });
  });
}

// ── Main entry ────────────────────────────────────────────────
// `strict` (used by the Academy assessment engine): refuse to run if Docker
// isn't available rather than falling back to the unsandboxed executor.
// Student code must never execute directly on the process that holds
// WhatsApp/GitHub/DB credentials. The non-strict path keeps the timeout-only
// fallback for owner-gated general use.
async function runCode(code, lang = "js", opts = {}) {
  const available = await checkDocker();
  if (!available) {
    // DEFAULT-SAFE: if the caller didn't explicitly pass allowUnsafe:true,
    // untrusted code is blocked rather than run unsandboxed. The only way to
    // reach runUnsafe now is an explicit, trusted opt-in.
    if (opts.allowUnsafe) {
      warn("Docker unavailable — code run UNSANDBOXED via explicit allowUnsafe opt-in.");
      return runUnsafe(code, lang, opts);
    }
    const reason = opts.strict
      ? "❌ Sandbox unavailable (no Docker). Code blocked for safety."
      : "❌ Sandbox unavailable (no Docker). Code blocked — no unsandboxed fallback for untrusted code.";
    return { success: false, output: reason, sandboxed: false, blocked: true };
  }
  return runSandboxed(code, lang, opts);
}

module.exports = { runCode, runSandboxed, runUnsafe, checkDocker };
