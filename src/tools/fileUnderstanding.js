// ── File Understanding Engine ──────────────────────────────
// Analyzes files: ZIP archives, code repos, documents.
// !analyze <file> — reads and summarizes any uploaded file

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const TEMP = path.join(__dirname, "../../temp");

// Analyze a file by its path
async function analyzeFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { error: "File not found or missing." };
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    const info = {
      name: path.basename(filePath),
      size: sizeMB + " MB",
      type: ext,
      modified: stats.mtime,
    };

    if (ext === ".zip" || ext === ".rar" || ext === ".tar" || ext === ".gz") {
      return analyzeArchive(filePath, info);
    }
    if (ext === ".js" || ext === ".py" || ext === ".html" || ext === ".css" || ext === ".json" || ext === ".md") {
      return analyzeCodeFile(filePath, info);
    }
    if (ext === ".txt" || ext === ".log" || ext === ".csv") {
      return analyzeTextFile(filePath, info);
    }
    if (ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".gif" || ext === ".webp") {
      info.note = "Image file. Use vision/OCR to analyze content.";
      return { info, summary: "Image file detected." };
    }

    return { info, summary: "Unknown file type: " + ext };
  } catch (err) {
    return { error: "Could not read file: " + err.message };
  }
}

function analyzeArchive(filePath, info) {
  return new Promise((resolve) => {
    // execFile => no shell interpolation (prevents command injection via filename)
    execFile("unzip", ["-l", filePath], { timeout: 15000 }, (err, stdout) => {
      if (err) {
        execFile("tar", ["tf", filePath], { timeout: 15000 }, (err2, stdout2) => {
          if (err2) return resolve({ info, summary: "Could not read archive.", error: (err || err2)?.message });
          return resolve(buildArchiveInfo(info, stdout2));
        });
        return;
      }
      resolve(buildArchiveInfo(info, stdout));
    });
  });
}

function buildArchiveInfo(info, output) {
  const lines = output.split("\n").filter((l) => l.trim());
  const fileCount = lines.length;
  const extensions = {};
  lines.forEach((l) => {
    const parts = l.trim().split(/\s+/);
    const filename = parts[parts.length - 1];
    if (filename && filename.includes(".")) {
      const ext = filename.split(".").pop().toLowerCase();
      extensions[ext] = (extensions[ext] || 0) + 1;
    }
  });

  const extSummary = Object.entries(extensions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([e, c]) => e + ": " + c + " files")
    .join(", ");

  info.type = "Archive";
  info.contents = fileCount + " files";
  info.extensions = extSummary;

  return {
    info,
    summary: "Archive with " + fileCount + " files. Types: " + extSummary + ".",
    fileList: lines.slice(0, 20),
  };
}

function analyzeCodeFile(filePath, info) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const totalLines = lines.length;
    const codeLines = lines.filter((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("#")).length;
    const commentLines = totalLines - codeLines;
    const functions = content.match(/function\s+\w+|def\s+\w+|=>\s*{|async\s+\w+|const\s+\w+\s*=\s*\(/g) || [];

    info.lines = totalLines;
    info.codeLines = codeLines;
    info.comments = commentLines;
    info.functions = functions.length;

    return {
      info,
      summary: totalLines + " lines (" + codeLines + " code, " + commentLines + " comments). " + functions.length + " functions defined.",
      content: content.slice(0, 2000),
    };
  } catch (err) {
    return { info, summary: "Could not read code file: " + err.message };
  }
}

function analyzeTextFile(filePath, info) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const words = content.split(/\s+/).length;

    info.lines = lines.length;
    info.words = words;

    return {
      info,
      summary: words + " words, " + lines.length + " lines.",
      content: content.slice(0, 2000),
    };
  } catch (err) {
    return { info, summary: "Could not read text file: " + err.message };
  }
}

module.exports = { analyzeFile };
