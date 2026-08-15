const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Render and other PaaS hosts may start the process from a directory that is
// not the repository root. Resolve the project root from this module first,
// then allow an explicit runtime directory for operators who mount media tools
// elsewhere.
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const ROOT = process.env.ARIA_MEDIA_RUNTIME_DIR || path.join(PROJECT_ROOT, ".render", "media");
const BIN_DIRS = [
  path.join(ROOT, "bin"),
  path.join(PROJECT_ROOT, ".render", "bin"),
  path.join(process.cwd(), ".render", "media", "bin"),
  path.join(process.cwd(), ".render", "bin"),
  process.env.RENDER_MEDIA_BIN_DIR,
  "/opt/render/project/.render/media/bin",
  "/opt/render/project/.render/bin",
  "/opt/render/project/poetry/bin",
  "/opt/render/project/.venv/bin",
  "/usr/local/bin",
  "/usr/bin",
].filter(Boolean);

const PYTHON_DIRS = [
  path.join(ROOT, "python"),
  path.join(PROJECT_ROOT, ".render", "python"),
  path.join(process.cwd(), ".render", "media", "python"),
  path.join(process.cwd(), ".render", "python"),
  process.env.RENDER_MEDIA_PYTHON_DIR,
].filter(Boolean);

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function which(name) {
  try {
    const result = execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return result || null;
  } catch (_) {
    return null;
  }
}

function runtimeEnv(extra = {}) {
  const currentPath = process.env.PATH || "";
  const prefix = [...new Set(BIN_DIRS)].join(path.delimiter);
  return { ...process.env, PATH: `${prefix}${path.delimiter}${currentPath}`, ...extra };
}

function pythonCandidates() {
  const explicit = process.env.ARIA_PYTHON_BIN || process.env.PYTHON_BIN;
  const candidates = [
    explicit,
    ...BIN_DIRS.map((dir) => path.join(dir, "python3")),
    ...BIN_DIRS.map((dir) => path.join(dir, "python")),
    which("python3"),
    which("python"),
  ].filter(Boolean);
  return [...new Set(candidates)].filter((file) => isExecutable(file));
}

function moduleEnv(pythonDir) {
  const current = process.env.PYTHONPATH ? `${pythonDir}${path.delimiter}${process.env.PYTHONPATH}` : pythonDir;
  return runtimeEnv({ PYTHONPATH: current });
}

function hasPythonModule(python, pythonDir) {
  try {
    execFileSync(python, ["-c", "import yt_dlp, yt_dlp_ejs"], {
      env: moduleEnv(pythonDir),
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5000,
    });
    return true;
  } catch (_) {
    return false;
  }
}

function resolveYtDlp() {
  const explicit = process.env.ARIA_YTDLP_PATH || process.env.YTDLP_PATH || process.env.YT_DLP_PATH;
  const directCandidates = [
    explicit,
    ...BIN_DIRS.map((dir) => path.join(dir, "yt-dlp")),
    which("yt-dlp"),
  ].filter(Boolean);
  for (const file of [...new Set(directCandidates)]) {
    if (isExecutable(file)) {
      return { file, prefix: [], env: runtimeEnv(), display: file };
    }
  }

  for (const python of pythonCandidates()) {
    for (const pythonDir of PYTHON_DIRS) {
      if (hasPythonModule(python, pythonDir)) {
        return {
          file: python,
          prefix: ["-m", "yt_dlp"],
          env: moduleEnv(pythonDir),
          display: `${python} -m yt_dlp`,
        };
      }
    }
  }
  return null;
}

function commandArgs(command, args = []) {
  return [...(command?.prefix || []), ...args];
}

function describeYtDlp() {
  const command = resolveYtDlp();
  return command ? command.display : null;
}

function inspectYtDlp() {
  const command = resolveYtDlp();
  if (!command) return { available: false, command: null, version: null, error: "yt-dlp was not found in the configured runtime paths" };
  try {
    const version = execFileSync(command.file, commandArgs(command, ["--version"]), {
      env: command.env,
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { available: true, command: command.display, version: version || null, error: null };
  } catch (err) {
    return { available: false, command: command.display, version: null, error: String(err?.message || err).slice(0, 240) };
  }
}

module.exports = { PROJECT_ROOT, ROOT, resolveYtDlp, commandArgs, describeYtDlp, inspectYtDlp };
