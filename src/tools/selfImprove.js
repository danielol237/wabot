// ── Self-Improvement Engine ────────────────────────────────
// ARIA reads her own code, finds issues, optimizes, and improves.
// Runs periodically and on-demand via !evolve command.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { getAIResponse } = require("./ai");

const SRC_DIR = path.join(__dirname, "..");
const LOG_FILE = path.join(__dirname, "../../data/selfImprove.json");

let state = { improvements: [], lastCheck: 0, evolutionStage: 1 };

function load() {
  try { if (fs.existsSync(LOG_FILE)) state = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch (e) {}
}

function save() {
  try { fs.writeFileSync(LOG_FILE, JSON.stringify(state, null, 2)); } catch (e) {}
}

load();

// Get code stats for self-awareness
function getCodeStats() {
  let totalLines = 0, totalFiles = 0, errors = [];
  function walk(dir) {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const fp = path.join(dir, f);
        if (f === "node_modules" || f === ".git" || f === "sessions" || f === "temp" || f === "data") continue;
        if (fs.statSync(fp).isDirectory()) { walk(fp); continue; }
        if (f.endsWith(".js")) {
          totalFiles++;
          const content = fs.readFileSync(fp, "utf8");
          const lines = content.split("\n").length;
          totalLines += lines;
          // Simple syntax check (catch obvious issues)
          if (content.includes("TODO") || content.includes("FIXME")) {
            errors.push(`${fp}: has TODO/FIXME`);
          }
        }
      }
    } catch (e) {}
  }
  walk(SRC_DIR);
  return { totalFiles, totalLines, errors: errors.slice(0, 10) };
}

// Scan for potential improvements
async function scanForImprovements() {
  const stats = getCodeStats();
  const prompt = `You are an expert code reviewer. Here are stats about a WhatsApp bot project:

- ${stats.totalFiles} JavaScript files
- ${stats.totalLines} total lines of code
${stats.errors.length > 0 ? `- Known issues: ${stats.errors.join("; ")}` : "- No known issues"}

The project is at: ${SRC_DIR}

Give me 3 specific, actionable improvements that could be made to this codebase. Focus on:
1. Performance optimizations 
2. Bug fixes
3. Feature additions that would have the biggest impact

For each improvement, specify:
- Which file to change
- What to change
- Why it matters

Respond in a numbered list format, keep each item under 200 chars.`;

  try {
    const response = await getAIResponse(prompt, "ARIA_self", [], null, "You are an AI analyzing your own source code. Be direct and specific.");
    return { improvements: response.split("\n").filter(l => l.trim()), stats };
  } catch (e) {
    return { improvements: ["Self-scan failed: " + e.message], stats };
  }
}

// Apply a fix if safe to do so
async function applyFix(filePath, findStr, replaceStr) {
  try {
    const fullPath = path.join(SRC_DIR, filePath);
    if (!fs.existsSync(fullPath)) return { success: false, error: "File not found" };

    let content = fs.readFileSync(fullPath, "utf8");
    if (!content.includes(findStr)) return { success: false, error: "Pattern not found in file" };

    // Backup
    const backup = fullPath + ".backup";
    if (!fs.existsSync(backup)) fs.copyFileSync(fullPath, backup);

    content = content.replace(findStr, replaceStr);
    fs.writeFileSync(fullPath, content);

    // Verify syntax — use execFile (args array) so the path is never interpreted
    // by a shell. This prevents command injection via a crafted filePath.
    return new Promise((resolve) => {
      execFile("node", ["--check", fullPath], (err) => {
        if (err) {
          // Rollback
          if (fs.existsSync(backup)) fs.copyFileSync(backup, fullPath);
          resolve({ success: false, error: "Syntax error after fix, rolled back" });
        } else {
          state.improvements.push({ file: filePath, at: Date.now() });
          state.evolutionStage++;
          save();
          resolve({ success: true });
        }
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Run self-evolution cycle
async function evolve() {
  const scan = await scanForImprovements();
  state.lastCheck = Date.now();
  save();
  return scan;
}

// Get evolution stats
function getEvolutionStats() {
  return {
    stage: state.evolutionStage,
    improvements: state.improvements.length,
    lastCheck: state.lastCheck ? new Date(state.lastCheck).toLocaleString() : "Never",
    codeStats: getCodeStats(),
  };
}

module.exports = { evolve, applyFix, getEvolutionStats, scanForImprovements };
