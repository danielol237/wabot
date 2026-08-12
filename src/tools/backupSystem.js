// ── Backup & Restore ──────────────────────────────────────
// !backup — creates ZIP of plugins, memory, data
// !restore — reply to ZIP to restore

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");

const HOME = path.join(__dirname, "../..");
const DATA = path.join(HOME, "data");
const PLUGINS = path.join(HOME, "plugins");
const TEMP = path.join(HOME, "temp");

async function createBackup() {
  const id = uuidv4().slice(0, 8);
  const outFile = path.join(TEMP, "aria_backup_" + id + ".zip");

  return new Promise((resolve) => {
    // Only zip the data dir and plugin files (as paths relative to HOME)
    const args = ["-r", outFile, "data/", "plugins/"];
    execFile("zip", args, { cwd: HOME, timeout: 30000 }, (err) => {
      if (err && !fs.existsSync(outFile)) {
        resolve({ success: false, error: err.message });
        return;
      }
      const stats = fs.statSync(outFile);
      resolve({ success: true, filePath: outFile, size: (stats.size / 1024).toFixed(1) + " KB" });
    });
  });
}

async function restoreBackup(zipPath) {
  // Only allow restoring a backup file from inside our own temp dir to avoid
  // arbitrary path traversal. Never trust a zip path from an external source.
  const resolved = path.resolve(zipPath);
  if (!resolved.startsWith(path.resolve(TEMP) + path.sep)) {
    return { success: false, error: "Restore path must be inside the bot's temp directory." };
  }

  return new Promise((resolve) => {
    // List entries and refuse anything that escapes the target directory (zip-slip)
    const listArgs = ["-Z1", resolved];
    execFile("unzip", listArgs, { cwd: HOME, timeout: 15000 }, (err, stdout) => {
      if (err) return resolve({ success: false, error: err.message });

      const entries = (stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
      for (const entry of entries) {
        // Absolute path, parent traversal, or drive letter all indicate a slip
        if (entry.startsWith("/") || entry.startsWith("\\") || entry.includes("..")) {
          return resolve({ success: false, error: `Refusing to restore: entry "${entry}" escapes the target directory.` });
        }
      }

      const extractArgs = ["-o", resolved];
      execFile("unzip", extractArgs, { cwd: HOME, timeout: 30000 }, (unzipErr, unzipOut) => {
        if (unzipErr) resolve({ success: false, error: unzipErr.message });
        else resolve({ success: true, output: (unzipOut || "").slice(0, 500) });
      });
    });
  });
}

// ── Auto GitHub backup ─────────────────────────────────────────
// Push the backup ZIP to a PRIVATE GitHub gist as base64, so there's an
// off-server copy without needing a separate hosting service. Requires
// GITHUB_TOKEN with gist scope in env. Returns success:false if not configured
// (never blocks). On success returns the gist URL.
async function backupToGist() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { success: false, error: "GITHUB_TOKEN not set" };

  const b = await createBackup();
  if (!b.success) return { success: false, error: b.error };
  try {
    const content = fs.readFileSync(b.filePath).toString("base64");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const res = await axios.post(
      "https://api.github.com/gists",
      {
        description: `ARIA backup ${stamp}`,
        public: false,
        files: {
          [`aria_backup_${stamp}.zip.b64`]: { content },
        },
      },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 30000 }
    );
    try { fs.unlinkSync(b.filePath); } catch (_) {}
    return { success: true, url: res.data?.html_url, size: b.size };
  } catch (err) {
    try { fs.unlinkSync(b.filePath); } catch (_) {}
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

module.exports = { createBackup, restoreBackup, backupToGist };
