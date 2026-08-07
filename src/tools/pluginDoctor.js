// ── Plugin Doctor ──────────────────────────────────────────
// !scanplugins — checks all plugins for issues

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PLUGINS_DIR = path.join(__dirname, "../../plugins");

function scanAll() {
  const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith(".js"));
  const results = [];

  for (const file of files) {
    const fp = path.join(PLUGINS_DIR, file);
    const stats = fs.statSync(fp);
    const sizeKB = (stats.size / 1024).toFixed(1);
    let status = "healthy";
    let issues = [];

    try {
      require("child_process").execSync('node --check "' + fp + '"', { stdio: "pipe" });
    } catch (e) {
      status = "error";
      issues.push("Syntax error");
    }

    const content = fs.readFileSync(fp, "utf8");

    if (content.includes("require(\"../") || content.includes('require("../')) {
      // Check if required files exist
      const requires = content.match(/require\(["'](\.\.\/[^"']+)["']\)/g) || [];
      for (const req of requires) {
        const reqPath = req.match(/["']([^"']+)["']/)?.[1];
        if (reqPath) {
          const fullPath = path.join(PLUGINS_DIR, "..", reqPath);
          if (!fs.existsSync(fullPath + ".js") && !fs.existsSync(fullPath)) {
            issues.push("Missing dependency: " + reqPath);
            if (status === "healthy") status = "warning";
          }
        }
      }
    }

    const hasExports = content.includes("module.exports");
    if (!hasExports) {
      issues.push("No module.exports");
      status = "warning";
    }

    results.push({
      name: file.replace(".js", ""),
      size: sizeKB + " KB",
      status,
      issues: issues.length > 0 ? issues : ["None"],
    });
  }

  return results;
}

function formatResults(results) {
  let text = "*🔍 Plugin Health Check*\n\n";
  results.forEach(r => {
    const icon = r.status === "healthy" ? "✅" : r.status === "warning" ? "⚠️" : "❌";
    text += icon + " *" + r.name + "* (" + r.size + ")\n";
    r.issues.forEach(i => { text += "   └ " + i + "\n"; });
    text += "\n";
  });
  text += "Total: " + results.length + " plugins | " + results.filter(r => r.status === "healthy").length + " healthy";
  return text;
}

module.exports = { scanAll, formatResults };
