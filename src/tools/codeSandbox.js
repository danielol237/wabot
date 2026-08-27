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
// Python needs a Python runtime; node:20-slim has none. Auto-pick a python image
// for python code unless the operator explicitly overrode SANDBOX_IMAGE.
function imageFor(lang) {
  if (process.env.SANDBOX_IMAGE) return process.env.SANDBOX_IMAGE;
  const isPy = lang === "py" || lang === "python";
  return isPy ? "python:3.12-slim" : "node:20-slim";
}

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
    imageFor(lang),
    ...runCmd,
  ];

  return new Promise((resolve) => {
    const { spawn } = require("child_process");
    // If stdin is provided, pass it through with `-i` (interactive) so the
    // container actually receives it on the program's stdin. Without `-i`,
    // docker run doesn't attach stdin and the program sees EOF. We use spawn +
    // a real stdin write because execFile's `input` option doesn't reliably
    // deliver stdin through `docker run`.
    if (opts.stdin != null) dockerArgs.splice(dockerArgs.indexOf("--rm") + 1, 0, "-i");
    const proc = spawn("docker", dockerArgs);
    let stdout = "", stderr = "", killReason = null, settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { fs.unlinkSync(filePath); } catch (_) {}
      try {
        require("../utils/eventLog").trackOperation("tool", "code-execution", result.success ? "succeeded" : "failed", {
          language: lang,
          sandboxed: Boolean(result.sandboxed),
          timedOut: Boolean(result.timedOut),
          blocked: Boolean(result.blocked),
          exitCode: result.exitCode ?? null,
        });
      } catch (_) {}
      resolve(result);
    };
    const killWithReason = (reason) => {
      if (killReason || settled) return;
      killReason = reason;
      try { proc.kill("SIGKILL"); } catch (_) {}
    };
    const timer = setTimeout(() => killWithReason("timeout"), (timeoutSec + 5) * 1000);
    proc.stdout.on("data", (d) => {
      if (settled) return;
      stdout += String(d);
      if (stdout.length > 4000) { stdout = stdout.slice(0, 4000); killWithReason("output_limit"); }
    });
    proc.stderr.on("data", (d) => {
      if (settled) return;
      stderr += String(d);
      if (stderr.length > 4000) { stderr = stderr.slice(0, 4000); killWithReason("output_limit"); }
    });
    proc.on("error", (e) => finish({ success: false, output: "docker error: " + e.message, sandboxed: true }));
    proc.on("close", (code, signal) => {
      if (killReason === "timeout") return finish({ success: false, output: "❌ Timed out / killed in sandbox.", sandboxed: true, timedOut: true });
      if (killReason === "output_limit") return finish({ success: false, output: "❌ Output limit exceeded in sandbox.", sandboxed: true, outputLimit: true });
      const output = (stdout || stderr || "").slice(0, 4000);
      if (code !== 0 || signal) return finish({ success: false, output: (stderr || stdout || `exit ${code || signal}`).slice(0, 2000), sandboxed: true, exitCode: code, signal: signal || null });
      finish({ success: true, output: output || "(no output)", sandboxed: true, exitCode: 0 });
    });
    // Write stdin, then close so the program sees EOF.
    if (opts.stdin != null) {
      proc.stdin.write(String(opts.stdin));
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
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
      const result = { success: !err, output, sandboxed: false, exitCode: err ? (typeof err.code === "number" ? err.code : null) : 0 };
      try {
        require("../utils/eventLog").trackOperation("tool", "code-execution", result.success ? "succeeded-unsandboxed" : "failed-unsandboxed", {
          language: lang,
          sandboxed: false,
          explicitOptIn: true,
          exitCode: result.exitCode,
        });
      } catch (_) {}
      resolve(result);
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

module.exports = { runCode, runSandboxed, runUnsafe, checkDocker, imageFor };
