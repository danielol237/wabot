const fs = require("fs");
const path = require("path");
const { getAIResponse } = require("./ai");
const { getRecentErrors } = require("./botAdmin");

const DATA_DIR = path.join(__dirname, "../../data");
const PENDING_FIX_FILE = path.join(DATA_DIR, "pendingFix.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DIAGNOSIS_SYSTEM_PROMPT = `You are a senior debugger analyzing real error logs from a running Node.js app. Given recent errors, you:
1. Identify the most likely root cause
2. Name the specific file that needs fixing, if identifiable from the stack trace
3. Propose the exact fix as a unified diff or "replace X with Y" instruction — be precise enough that the change could be applied mechanically

Respond ONLY with JSON, no other text: {"diagnosis": "...", "file": "path/or/null", "proposedFix": "...", "confidence": "high"|"medium"|"low"}
If the errors are too vague to diagnose confidently, say so honestly in "diagnosis" and set confidence to "low".`;

// Reads recent errors, asks the AI to diagnose + propose a fix, and saves the
// proposal to disk WITHOUT applying it. This is a deliberate, permanent boundary:
// diagnosis and proposal happen automatically, but writing to any file requires
// a separate explicit !approve from the owner. There is no path in this code
// that applies a fix without that step — self-healing here means "tells you
// what it thinks is wrong and how to fix it," not "edits itself unattended."
async function runSelfCheck(senderName) {
  const errors = getRecentErrors(10);
  if (errors.length === 0) {
    return { success: true, noIssues: true, message: "✅ No recent errors logged. Nothing to diagnose." };
  }

  const errorSummary = errors.map((e) => `[${e.time}] [${e.context}] ${e.error}`).join("\n");
  const prompt = `Recent error log from ARIA (a WhatsApp bot):\n\n${errorSummary}\n\nDiagnose the most likely root cause and propose a fix.`;

  try {
    const response = await getAIResponse(prompt, senderName, [], DIAGNOSIS_SYSTEM_PROMPT, "");
    let cleaned = response.replace(/```json|```/g, "").trim();
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) cleaned = objMatch[0];

    const diagnosis = JSON.parse(cleaned);

    // Save as a pending fix — NOT applied yet, just stored for !approve to act on later
    fs.writeFileSync(PENDING_FIX_FILE, JSON.stringify({ ...diagnosis, proposedAt: Date.now() }, null, 2));

    return { success: true, diagnosis };
  } catch (err) {
    console.error("Self-check diagnosis failed:", err.message);
    return { success: false, error: "Couldn't produce a clear diagnosis from the current logs." };
  }
}

function getPendingFix() {
  try {
    if (!fs.existsSync(PENDING_FIX_FILE)) return null;
    const fix = JSON.parse(fs.readFileSync(PENDING_FIX_FILE, "utf8"));
    // A proposal older than 1 hour is considered stale — don't let someone approve
    // an old fix for a problem that may have already changed or been resolved differently
    if (Date.now() - fix.proposedAt > 60 * 60 * 1000) return null;
    return fix;
  } catch (err) {
    return null;
  }
}

function clearPendingFix() {
  try {
    if (fs.existsSync(PENDING_FIX_FILE)) fs.unlinkSync(PENDING_FIX_FILE);
  } catch (err) {
    console.error("Failed to clear pending fix:", err.message);
  }
}

module.exports = { runSelfCheck, getPendingFix, clearPendingFix };
