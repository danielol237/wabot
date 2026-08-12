// ── ARIA Academy — Teach-it-back ────────────────────────────────
// The learner explains a concept in their own words. ARIA grades the
// explanation for correctness, completeness, clarity — AND detects specific
// misconceptions (wrong mental models). Explaining is the strongest test of
// understanding; it surfaces gaps that answering questions hides.
//
// Flow: !explain <topic> → learner writes their explanation → ARIA grades
// against a rubric and lists any misconceptions → recorded to learner model.

const fs = require("fs");
const path = require("path");
const { getAIResponse } = require("../ai");
const { addXp, recordAttempt } = require("./learnerModel");
const { levelUpText } = require("./xpSystem");

const STATE_FILE = path.join(__dirname, "../../../data/explainState.json");
let state = { chats: {} };
function load() { try { if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || { chats: {} }; } catch (_) { state = { chats: {} }; } }
function save() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) {} }
load();

function hasActiveFlow(chatId) { return !!(state.chats[chatId] && state.chats[chatId].step); }

const GRADER_PROMPT = `You are an expert CS educator grading a learner's explanation of a concept. Detect real misconceptions, not just missing polish. Return ONLY JSON:
{
  "score": 0-100,
  "grade": "A"|"B"|"C"|"D"|"F",
  "correct": true|false,
  "misconceptions": [
    { "idea": "the wrong mental model the learner expressed", "truth": "the correct concept", "severity": "critical|moderate|minor" }
  ],
  "strengths": ["what the learner got right"],
  "feedback": "2-3 sentences, encouraging but honest, pointing at the biggest misconception if any."
}`;

// Detect provider error / requeue so raw AI error text never leaks.
function isProviderError(text) {
  const t = String(text || "").toLowerCase();
  return t.includes("ai reque") || t.includes("rate limit") || t.includes("requeue") ||
         t.includes("temporarily unavailable") || t.includes("try again later") ||
         t.includes("429") || t.includes("failed on all providers") || t.startsWith("\u274c");
}

const CONCEPTS = [
  "asynchronous programming", "promises", "closures", "rest apis", "sql indexes",
  "database transactions", "the event loop", "prototypal inheritance", "time complexity / big o",
  "http caching", "web sockets", "microservices", "dependency injection", "memoization",
  "design patterns", "git branching", "unit testing", "load balancing", "caching",
  "mvc architecture", "oauth", "normalization", "hash tables", "recursion", "garbage collection",
  "css specificity", "javascript hoisting", "generators", "cors", "rate limiting",
];

function randomTopic() { return CONCEPTS[Math.floor(Math.random() * CONCEPTS.length)]; }

function start(chatId, uid, topic) {
  const t = (topic && topic.trim()) || randomTopic();
  state.chats[chatId] = { uid, step: "explain", topic: t, startedAt: Date.now() };
  save();
  return { text: `🧑‍🏫 *Teach-it-back*\n\nExplain "${t}" to me like I've never heard of it. Show me you actually understand it — not just definitions.\n\nAim for 3-6 sentences. Reply when ready.` };
}

// Grade the learner's explanation via AI (clean fallback if unavailable).
async function submitExplanation(chatId, uid, explanation) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return null;
  if (st.step !== "explain") return null;
  st.explanation = explanation;
  st.step = "graded";

  let grade = null;
  try {
    const prompt = `Topic to explain: ${st.topic}\n\nLearner's explanation:\n"${String(explanation).slice(0, 2500)}"`;
    const res = await getAIResponse(prompt, "Grader", [], GRADER_PROMPT);
    if (isProviderError(res)) throw new Error("provider_unavailable");
    const m = res.trim().replace(/```json|```/gi, "").match(/\{[\s\S]*\}/);
    grade = JSON.parse(m ? m[0] : res.trim());
  } catch (e) {
    const unavailable = e.message === "provider_unavailable";
    grade = {
      score: null, grade: "—", correct: false, offline: true,
      misconceptions: [], strengths: [],
      feedback: unavailable
        ? "My grading engine is temporarily offline. Reply !explain to retry once I'm back."
        : "I couldn't finish grading that right now (temporary outage). Reply !explain to retry.",
    };
  }

  st.grade = grade;
  // Record to learner model.
  const xp = grade.offline ? 0 : grade.correct ? 50 : grade.score >= 70 ? 30 : 10;
  if (!grade.offline) recordAttempt(uid, { track: "teach", level: "explain", lessonId: st.topic, sectionType: "explain", correct: grade.correct, skill: st.topic });
  const up = xp ? addXp(uid, xp, "Teach-back") : null;
  delete state.chats[chatId];
  save();
  return { topic: st.topic, explanation, grade, xp, up, text: formatGrade(st, grade, xp, up) };
}

function formatGrade(st, g, xp, up) {
  if (g.offline) {
    return `🧑‍🏫 *Teach-it-back — ${st.topic}*\n\n${g.feedback}\n\n(no XP this round)`;
  }
  const miscon = (g.misconceptions && g.misconceptions.length)
    ? g.misconceptions.map((m) => `• *${m.severity?.toUpperCase()}* You said: "${m.idea}" → actually: ${m.truth}`).join("\n")
    : "None detected — clean mental model. 🎯";
  const strengths = (g.strengths && g.strengths.length) ? g.strengths.map((s) => `• ${s}`).join("\n") : "(none noted)";
  return `🧑‍🏫 *Teach-it-back — ${st.topic}*\n\n*Score:* ${g.score}/100 (${g.grade})\n\n*Misconceptions:*\n${miscon}\n\n*What you got right:*\n${strengths}\n\n*Feedback:* ${g.feedback}\n\n+${xp} XP${levelUpText(up)}\n\nReply !explain <topic> for another, or !explain for a random one.`;
}

async function handleExplainCommand(sock, msg, args, ctx) {
  const { reply } = require("../../utils/baileysHelpers");
  const uid = (ctx.senderJid || "").split("@")[0];
  const topic = (Array.isArray(args) ? args.join(" ") : args || "").trim();
  const r = start(ctx.chatId, uid, topic);
  return reply(sock, msg, r.text);
}

module.exports = { start, submitExplanation, hasActiveFlow, handleExplainCommand, CONCEPTS };
