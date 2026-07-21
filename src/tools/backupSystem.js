// ── Backup & Restore ──────────────────────────────────────
// !backup — creates ZIP of plugins, memory, data
// !restore — reply to ZIP to restore

const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const HOME = path.join(__dirname, "../..");
const DATA = path.join(HOME, "data");
const PLUGINS = path.join(HOME, "plugins");
const TEMP = path.join(HOME, "temp");

async function createBackup() {
  const id = uuidv4().slice(0, 8);
  const outFile = path.join(TEMP, "aria_backup_" + id + ".zip");

  return new Promise((resolve) => {
    // Include data dir, plugin list, user memory
    const cmd = 'cd "' + HOME + '" && zip -r "' + outFile + '" data/ plugins/*.js -x "data/pokemon.json" 2>&1';
    exec(cmd, { timeout: 30000 }, (err, stdout) => {
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
  return new Promise((resolve) => {
    const cmd = 'cd "' + HOME + '" && unzip -o "' + zipPath + '" 2>&1';
    exec(cmd, { timeout: 30000 }, (err, stdout) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true, output: stdout.slice(0, 500) });
    });
  });
}

module.exports = { createBackup, restoreBackup };
