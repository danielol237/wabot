const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.env.ARIA_MEDIA_RUNTIME_DIR || path.join(process.cwd(), ".render", "media");
const BIN_DIRS = [
  path.join(ROOT, "bin"),
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
  return { ...process.env, PYTHONPATH: current };
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
      return { file, prefix: [], env: process.env, display: file };
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

module.exports = { ROOT, resolveYtDlp, commandArgs, describeYtDlp };
