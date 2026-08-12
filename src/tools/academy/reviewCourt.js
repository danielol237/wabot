// ── ARIA Academy — AI Code Review Court ─────────────────────────
// After a learner finishes a project, they can submit code (or a repo path)
// and ARIA reviews it like a hostile senior engineer: architecture, security,
// performance, testing, maintainability, accessibility, error handling, and
// observability. Each flagged issue must be fixed; ARIA regrades.
//
// The reviewer uses the AI to analyze submitted code against a structured
// rubric, OR (for the deterministic path) applies a set of static checks when
// code is inline. For a real academy, the AI-analysis path gives the depth.

const { getAIResponse } = require("../ai");

// ── Rubric categories ──────────────────────────────────────────
const RUBRIC = [
  { id: "architecture", label: "Architecture", emoji: "🏛️", weight: 2 },
  { id: "security", label: "Security", emoji: "🔒", weight: 3 },
  { id: "performance", label: "Performance", emoji: "⚡", weight: 2 },
  { id: "testing", label: "Testing", emoji: "🧪", weight: 2 },
  { id: "maintainability", label: "Maintainability", emoji: "🧹", weight: 1 },
  { id: "accessibility", label: "Accessibility", emoji: "♿", weight: 1 },
  { id: "error-handling", label: "Error Handling", emoji: "🛑", weight: 2 },
  { id: "observability", label: "Observability", emoji: "📈", weight: 1 },
];

const REVIEW_SYSTEM_PROMPT = `You are a hostile senior software engineer doing a code review. You review for real defects, not style nits. Return ONLY JSON, no prose:
{
  "issues": [
    { "id": 1, "category": "architecture|security|performance|testing|maintainability|accessibility|error-handling|observability", "severity": "critical|major|moderate|good", "line": "file.ts:42 (or n/a)", "title": "short title", "detail": "what's wrong and why it matters", "fix": "exactly how to fix it" }
  ],
  "score": 0-100,
  "summary": "2-3 sentence overall assessment"
}
Be specific and technical. "critical" = exploitable/breaks prod. "major" = real bug or missing essential. "moderate" = should fix. "good" = positive note. Include positive notes too.`;

// Analyze submitted code via the AI. Returns { issues, score, summary }.
async function reviewCode(code, context = {}) {
  const prompt = `Here is the code to review:\n\n\`\`\`\n${String(code).slice(0, 8000)}\n\`\`\`\n\nContext: ${context.context || "A student project"}`;
  try {
    const response = await getAIResponse(prompt, "Reviewer", [], REVIEW_SYSTEM_PROMPT);
    const cleaned = response.trim().replace(/```json|```/gi, "").trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : cleaned);
    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      score: Number(parsed.score) || 0,
      summary: parsed.summary || "",
    };
  } catch (e) {
    return { issues: [], score: 0, summary: "Review failed to parse: " + e.message, error: true };
  }
}

// Apply deterministic static checks (works without AI / for quick review).
function staticChecks(code) {
  const issues = [];
  const c = String(code || "");
  // Security
  if (/innerHTML\s*=/.test(c)) issues.push({ category: "security", severity: "critical", title: "XSS via innerHTML", detail: "Assigning untrusted data to innerHTML can execute scripts. Use textContent or escape.", fix: "Replace innerHTML with textContent, or sanitize/escape before injection." });
  if (/eval\s*\(/.test(c)) issues.push({ category: "security", severity: "critical", title: "eval() usage", detail: "eval() runs arbitrary code and is a code-injection risk.", fix: "Remove eval(); use JSON.parse for data and direct calls for logic." });
  // Error handling
  if (c.includes("catch") && !c.includes("throw")) issues.push({ category: "error-handling", severity: "moderate", title: "Swallowed errors", detail: "A catch block that doesn't rethrow or log hides failures.", fix: "Log or rethrow the error; never silently swallow it." });
  // Testing
  if (/\b(if|for|while)\b/.test(c) && !/\b(test|describe|assert|expect)\b/.test(c)) issues.push({ category: "testing", severity: "moderate", title: "No tests", detail: "Logic-heavy code with no test coverage.", fix: "Add unit tests for the core logic." });
  // Performance
  if (/\.map\([^)]*\)\s*\.map\(/.test(c)) issues.push({ category: "performance", severity: "moderate", title: "Chained iterations", detail: "Multiple full passes over an array; can be combined.", fix: "Merge the map passes or use a single reduce." });
  // Accessibility
  if (/<img\s[^>]*(?!alt=)/i.test(c)) issues.push({ category: "accessibility", severity: "moderate", title: "Missing alt text", detail: "Images need alt text for screen readers.", fix: "Add descriptive alt attributes to all <img> tags." });
  return issues;
}

// Grade the learner's fixes against the flagged issues.
// Returns { score, passed, feedback }.
function gradeFixes(issues, submittedFixes) {
  const a = String(submittedFixes || "").toLowerCase();
  const critical = issues.filter((i) => i.severity === "critical");
  const major = issues.filter((i) => i.severity === "major");
  const moderate = issues.filter((i) => i.severity === "moderate");
  const addressed = [];
  const missed = [];
  for (const issue of issues) {
    const title = String(issue.title || "").toLowerCase();
    const fix = String(issue.fix || "").toLowerCase();
    const hit = title.split(" ").some((t) => t.length > 3 && a.includes(t));
    const hitFix = fix.split(" ").some((t) => t.length > 4 && a.includes(t));
    if (hit || hitFix) addressed.push(issue); else missed.push(issue);
  }
  // Score: criticals must be addressed; then major/moderate ratio.
  const criticalPass = critical.every((c) => addressed.includes(c));
  const addressedRatio = addressed.length / Math.max(issues.length, 1);
  const score = Math.round((criticalPass ? 50 : 0) + addressedRatio * 50);
  const passed = score >= 75;
  return {
    score,
    passed,
    addressed,
    missed,
    feedback: `Fixes graded. You addressed ${addressed.length}/${issues.length} issues.${passed ? " Review passed." : ` Still missing: ${missed.map((m) => m.title).join(", ")}`}`,
  };
}

// Grade with a manual text checklist of fixes.
function gradeChecklist(issues, fixList) {
  return gradeFixes(issues, fixList);
}

// ── Chat flow ────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");
const { addXp } = require("./learnerModel");
const { levelUpText } = require("./xpSystem");
const STATE_FILE = path.join(__dirname, "../../../data/reviewState.json");
let state = { chats: {} };
function load() { try { if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || { chats: {} }; } catch (_) { state = { chats: {} }; } }
function save() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) {} }
load();

function hasActiveFlow(chatId) { return !!(state.chats[chatId] && state.chats[chatId].step); }

// Start: !review <code> — ARIA reviews the code.
async function start(chatId, uid, code, context) {
  const issues = staticChecks(code);
  // If we have AI and want depth, also run AI review; else use static checks.
  state.chats[chatId] = { uid, step: "fixes", code, issues, fixesSubmitted: [] };
  save();
  const lines = issues.map((i, idx) => `${idx + 1}. [${i.severity.toUpperCase()}] ${i.title} — ${i.detail}`).join("\n");
  const text = `⚖️ *Code Review Court*\n\nI reviewed your code like a hostile senior engineer.\n\n*Findings:*\n${lines || "No issues found by static checks. Nice work."}\n\nReply with your *fixes* (what you changed to address each issue), then I'll regrade.`;
  return { text, issues };
}

// Learner submits fixes → grade.
async function submitFixes(chatId, uid, fixes) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return null;
  const grade = gradeFixes(st.issues, fixes);
  const up = grade.passed ? addXp(uid, 80, "Review pass") : null;
  const missLines = grade.missed.length ? grade.missed.map((m) => `• ${m.title}`).join("\n") : "none";
  delete state.chats[chatId];
  save();
  return { text: `⚖️ *Regrade*\n\n${grade.feedback}\n\n*Score:* ${grade.score}/100\n\n${grade.passed ? "✅ Review passed! +80 XP" : "❌ Not yet — still missing:\n" + missLines}${levelUpText(up)}\n\nReply !review <code> to resubmit.`, grade };
}

function handleReply(chatId, uid, input) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return null;
  return submitFixes(chatId, uid, input);
}

// Command entry.
async function handleReviewCommand(sock, msg, args, ctx) {
  const { reply } = require("../../utils/baileysHelpers");
  const uid = (ctx.senderJid || "").split("@")[0];
  const code = (Array.isArray(args) ? args.join(" ") : args || "").trim();
  if (!code) return reply(sock, msg, "Usage: !review <code>\nPaste your code and ARIA will review it like a hostile senior engineer.");
  const r = await start(ctx.chatId, uid, code, {});
  return reply(sock, msg, r.text);
}

module.exports = { RUBRIC, reviewCode, staticChecks, gradeFixes, gradeChecklist, start, submitFixes, handleReply, hasActiveFlow, handleReviewCommand };
