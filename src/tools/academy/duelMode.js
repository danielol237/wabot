// ── ARIA Academy — AI-vs-Human Challenge Mode ───────────────────
// Gives the SAME engineering problem to the learner AND to ARIA. Both
// produce solutions; then they're compared on correctness, performance,
// security, complexity, maintainability, and cost. The learner can discover
// where they beat the AI and where the AI wins.
//
// Flow: !duel <problem> → ARIA solves it → you solve it → ARIA compares.

const fs = require("fs");
const path = require("path");
const { getAIResponse } = require("../ai");
const { runCode } = require("../codeSandbox");
const { addXp, recordAttempt } = require("./learnerModel");
const { levelUpText } = require("./xpSystem");

const STATE_FILE = path.join(__dirname, "../../../data/duelState.json");
let state = { chats: {} };
function load() { try { if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || { chats: {} }; } catch (_) { state = { chats: {} }; } }
function save() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) {} }
load();

function hasActiveFlow(chatId) { return !!(state.chats[chatId] && state.chats[chatId].step); }

// Provider error / requeue detection so raw AI error text never leaks to users.
function isProviderError(text) {
  const t = String(text || "").toLowerCase();
  return t.includes("ai reque") || t.includes("rate limit") || t.includes("requeue") ||
         t.includes("temporarily unavailable") || t.includes("try again later") ||
         t.includes("429") || t.startsWith("\u274c"); // ❌
}

const JUDGE_PROMPT = `You are an impartial engineering judge comparing two solutions to the same problem. Return ONLY JSON:
{
  "winner": "human" | "aria" | "tie",
  "score": { "human": 0-100, "aria": 0-100 },
  "breakdown": [
    { "dimension": "correctness|performance|security|complexity|maintainability|cost", "human": 0-10, "aria": 0-10, "note": "who wins this and why" }
  ],
  "assessment": "2-4 sentence honest assessment of both solutions."
}`;

// Start a duel: ARIA generates her solution to the problem.
async function start(chatId, uid, problem) {
  state.chats[chatId] = { uid, step: "human", problem, ariaSolution: null };
  save();
  return { text: `⚔️ *AI-vs-Human Duel*\n\n*Problem:* ${problem}\n\nI'm solving it on my end. When you're ready, send YOUR solution with:\n!submit <your code>\n\nYou're up. Show me what you've got. 😏` };
}

// Store ARIA's solution (generated via AI) — called lazily.
async function getAriaSolution(problem) {
  try {
    const res = await getAIResponse(`Solve this and output ONLY the code (no explanation, no markdown fences): ${problem}`, "ARIA", [], "You are a top-tier engineer. Output only runnable code.");
    if (isProviderError(res)) return "(ARIA's AI solver is temporarily unavailable — try the duel again shortly)";
    const cleaned = res.replace(/```[\s\S]*?\n|\n```/g, "").trim();
    return cleaned || "(ARIA produced no runnable solution)";
  } catch (e) {
    return "(ARIA's AI solver hit an error — try the duel again shortly)";
  }
}

// Submit the human's solution → ARIA judges both.
async function submitHuman(chatId, uid, humanCode) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return null;
  if (st.step !== "human") return null;
  st.humanCode = humanCode;
  st.step = "judging";
  save();
  const ariaCode = await getAriaSolution(st.problem);
  st.ariaCode = ariaCode;

  // Judge via AI.
  let verdict = null;
  try {
    const prompt = `PROBLEM:\n${st.problem}\n\nARIA'S SOLUTION:\n${ariaCode}\n\nHUMAN'S SOLUTION:\n${humanCode}`;
    const res = await getAIResponse(prompt, "Judge", [], JUDGE_PROMPT);
    const m = res.trim().replace(/```json|```/gi, "").match(/\{[\s\S]*\}/);
    verdict = JSON.parse(m ? m[0] : res.trim());
  } catch (e) {
    // Clean fallback — never leak the raw JSON parse error to the learner.
    verdict = { winner: "tie", score: { human: 50, aria: 50 }, breakdown: [], assessment: "My judge engine couldn't finish the comparison right now (temporary outage). I'll call it a tie so you can re-run when I'm back online.", _error: e.message };
  }

  st.verdict = verdict;
  st.step = "done";
  // Record + XP: small reward for participating, bigger for winning.
  recordAttempt(uid, { track: "duel", level: "challenge", lessonId: "duel", sectionType: "duel", correct: verdict.winner === "human" });
  const xp = verdict.winner === "human" ? 100 : verdict.winner === "tie" ? 50 : 25;
  const up = addXp(uid, xp, "Duel");
  save();

  return { verdict, ariaCode, humanCode, xp, text: formatVerdict(st, verdict, xp, up) };
}

function formatVerdict(st, v, xp, up) {
  const bd = (v.breakdown || []).map((d) => `• ${d.dimension}: human ${d.human}/10 vs aria ${d.aria}/10 — ${d.note}`).join("\n");
  const winner = v.winner === "human" ? "🏆 YOU WIN" : v.winner === "aria" ? "🤖 I win this one" : "🤝 Tie";
  return `⚔️ *Duel result*\n\n*${winner}*\n\n*Scores:* Human ${v.score?.human}/100 · ARIA ${v.score?.aria}/100\n\n*Breakdown:*\n${bd || "(none)"}\n\n*Assessment:* ${v.assessment}\n\n+${xp} XP${levelUpText(up)}\n\n---\n*MY solution:*\n\`\`\`\n${String(st.ariaCode).slice(0, 1500)}\n\`\`\`\n\n*YOUR solution:*\n\`\`\`\n${String(st.humanCode).slice(0, 1500)}\n\`\`\`\n\nReply !duel <problem> to run another.`;
}

// Command: !duel <problem>
async function handleDuelCommand(sock, msg, args, ctx) {
  const { reply } = require("../../utils/baileysHelpers");
  const uid = (ctx.senderJid || "").split("@")[0];
  const problem = (Array.isArray(args) ? args.join(" ") : args || "").trim();
  if (!problem) return reply(sock, msg, "Usage: !duel <problem>\nExample: !duel write a function that returns the nth Fibonacci number efficiently");
  const r = await start(ctx.chatId, uid, problem);
  return reply(sock, msg, r.text);
}

// Command: !submit <code>
async function handleSubmitCommand(sock, msg, args, ctx) {
  const { reply } = require("../../utils/baileysHelpers");
  const uid = (ctx.senderJid || "").split("@")[0];
  const code = (Array.isArray(args) ? args.join(" ") : args || "").trim();
  if (!hasActiveFlow(ctx.chatId)) return reply(sock, msg, "Start a duel first with !duel <problem>.");
  if (!code) return reply(sock, msg, "Usage: !submit <your code>");
  const r = await submitHuman(ctx.chatId, uid, code);
  return reply(sock, msg, r ? r.text : "No active duel in this chat.");
}

module.exports = { start, submitHuman, hasActiveFlow, handleDuelCommand, handleSubmitCommand };
