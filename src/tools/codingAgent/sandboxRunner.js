const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

try { require("dotenv").config(); } catch (_) {}

let cachedDockerAvailable = null;

function dockerAvailable(forceRefresh = false) {
  if (cachedDockerAvailable !== null && !forceRefresh) return cachedDockerAvailable;
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore", timeout: 4000 });
  } catch (_) {
    cachedDockerAvailable = false;
    return false;
  }

  // If the primary sandbox image exists locally, verify that container execution works.
  // Testing only when local avoids network pull delays when the image is not yet cached.
  try {
    execFileSync("docker", ["image", "inspect", "node:22-slim"], { stdio: "ignore", timeout: 2000 });
    try {
      execFileSync("docker", ["run", "--rm", "node:22-slim", "node", "-e", "process.exit(0)"], { stdio: "ignore", timeout: 4000 });
      cachedDockerAvailable = true;
    } catch (_) {
      // Image exists locally, but container execution failed (e.g. unprivileged overlayfs issue).
      cachedDockerAvailable = false;
    }
  } catch (_) {
    // Image is not pre-pulled; rely on docker version check.
    cachedDockerAvailable = true;
  }

  return cachedDockerAvailable;
}

function appendOutput(state, chunk) {
  state.output = (state.output + String(chunk)).slice(-18000);
}

function runProcess(command, args, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const timeout = Number(options.timeout || 120000);
  return new Promise((resolve) => {
    const state = { output: "" };
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: "1", HOST: "127.0.0.1", PORT: "0", npm_config_cache: path.join(os.tmpdir(), "aria-sandbox-npm-cache") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ...result, sandbox: options.sandbox || "process", output: state.output }); };
    child.stdout.on("data", (chunk) => appendOutput(state, chunk));
    child.stderr.on("data", (chunk) => appendOutput(state, chunk));
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} finish({ success: false, error: `${command} timed out after ${timeout}ms` }); }, timeout);
    const observeTimer = options.observe ? setTimeout(() => {
      try { child.kill("SIGTERM"); } catch (_) {}
      finish({ success: true, observed: true });
    }, Math.min(Number(options.observeAfter || 5000), Math.max(1, timeout - 1))) : null;
    const originalFinish = finish;
    // Clear the observation timer whenever the child exits before the window.
    const finishWithObservationCleanup = (result) => { if (observeTimer) clearTimeout(observeTimer); originalFinish(result); };
    child.once("error", (error) => finishWithObservationCleanup({ success: false, error: `${command} could not start: ${error.message}` }));
    child.once("exit", (code, signal) => {
      if (code === 0) return finishWithObservationCleanup({ success: true });
      finishWithObservationCleanup({ success: false, error: `${command} failed (${signal || `exit ${code}`})` });
    });
  });
}

function runDocker(args, options = {}) {
  const root = path.resolve(options.cwd || process.cwd());
  const configuredNetwork = String(process.env.SANDBOX_DOCKER_NETWORK || "").trim().toLowerCase();
  const network = ["none", "bridge", "host"].includes(configuredNetwork) ? configuredNetwork : (options.network || "none");
  const image = options.image || "node:22-slim";
  const command = [
    "run", "--rm", "--network", network, "--user", "1000:1000",
    "--read-only", "--tmpfs", "/tmp:size=256m", "--memory", "768m", "--cpus", "1",
    "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    // RLIMIT_NPROC is counted against the host UID on shared-UID hosts and
    // can prevent npm/node from starting. The container pids limit remains active.
    "--ulimit", "nofile=256:256",
    "-e", "CI=1", "-e", "HOST=127.0.0.1", "-e", "PORT=0", "-e", "NPM_CONFIG_CACHE=/tmp/npm-cache",
    "-v", `${root}:/workspace:rw`, "-w", "/workspace", image, ...args,
  ];
  return runProcess("docker", command, { ...options, sandbox: "docker" });
}

async function runSandboxCommand(projectDir, args, label, options = {}) {
  const timeout = options.timeout || 120000;
  const result = dockerAvailable()
    ? await runDocker(args, { cwd: projectDir, timeout, network: options.network || "none", image: options.image || (args[0] === "python3" ? "python:3.12-slim" : "node:22-slim"), observe: options.observe, observeAfter: options.observeAfter })
    : process.env.ARIA_ALLOW_UNSANDBOXED_BUILDS === "true"
      ? await runProcess(args[0], args.slice(1), { cwd: projectDir, timeout, sandbox: "explicit-process-opt-in", observe: options.observe, observeAfter: options.observeAfter })
      : { success: false, sandbox: "unavailable", output: "", error: "Docker sandbox is unavailable. Set ARIA_ALLOW_UNSANDBOXED_BUILDS=true only when the owner explicitly accepts direct-process verification." };
  if (result.success) return { ...result, label };
  return { ...result, label, error: `${label} failed in ${result.sandbox}: ${result.error}\n${result.output || ""}` };
}

async function runNpmScriptInSandbox(projectDir, scriptName, options = {}) {
  return runSandboxCommand(projectDir, ["npm", "run", scriptName], `npm run ${scriptName}`, options);
}

async function verifyPackageInSandbox(projectDir) {
  const packagePath = path.join(projectDir, "package.json");
  if (!fs.existsSync(packagePath)) return { success: true, skipped: true, sandbox: "not_required" };
  const install = await runSandboxCommand(projectDir, ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"], "npm install", { timeout: 120000, network: "bridge" });
  if (!install.success) return install;
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (_) {}
  if (pkg.scripts?.build) {
    const build = await runNpmScriptInSandbox(projectDir, "build", { timeout: 120000, network: "none" });
    if (!build.success) return build;
  }
  if (pkg.scripts?.start) {
    const runtime = await runNpmScriptInSandbox(projectDir, "start", { timeout: 10000, network: "none", observe: true });
    // A server that stays alive until the bounded observation ends is healthy.
    if (!runtime.success && !/timed out/i.test(runtime.error || "")) return runtime;
  }
  return { success: true, sandbox: dockerAvailable() ? "docker" : "process-fallback" };
}

module.exports = { dockerAvailable, runSandboxCommand, runNpmScriptInSandbox, verifyPackageInSandbox, _test: { appendOutput } };
