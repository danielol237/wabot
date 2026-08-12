// ── ARIA Academy — Assessment Engine ─────────────────────────────
// Grades quiz answers and coding challenges, and records every attempt to
// the Learner Model. Pure logic — no chat, no state of its own.

const { recordAttempt, recordEvidence } = require("./learnerModel");
const { runCode } = require("../codeSandbox");

const XP_QUIZ = 15;
const XP_CHALLENGE = 40;

// Grade a quiz answer. Returns { correct, xp, explanation }.
function gradeQuiz(uid, { track, level, lessonId, skill }, question, selectedLetter) {
  const a = String(selectedLetter).trim().toUpperCase();
  const correct = !!question && a === String(question.answer).toUpperCase();
  const xp = correct ? XP_QUIZ : 0;
  recordAttempt(uid, { track, level, lessonId, sectionType: "quiz", correct, skill });
  // Record evidence for the Evidence Engine (defensible mastery).
  recordEvidence(uid, { track, level, type: "quiz", correct, score: correct ? 100 : 0, skill, detail: lessonId });
  return {
    correct,
    xp,
    answer: question?.answer,
    explanation: correct ? question.explanation : question.retryExplanation,
  };
}

// Grade a coding challenge by running it and comparing output.
// `challenge`: { lang, expected }. Returns { correct, xp, output, expected }.
async function gradeChallenge(uid, { track, level, lessonId, skill }, code, challenge) {
  const lang = challenge.lang || "js";
  const map = { js: "js", javascript: "js", py: "py", python: "py", ts: "js" };
  const runLang = map[lang] || "js";
  let correct = false;
  let output = "";
  try {
    // Strict mode: academy student code MUST run in the Docker sandbox. If the
    // sandbox is unavailable, the run is blocked (never executed unsandboxed on
    // the process holding credentials) and graded as a fail with a clear note.
    const result = await runCode(code, runLang, { timeout: 5000, strict: true });
    if (result.blocked) {
      return { correct: false, xp: 0, output: result.output, expected: String(challenge.expected ?? "").trim(), blocked: true };
    }
    output = String(result?.output ?? result?.result ?? "").trim();
    const expected = String(challenge.expected ?? "").trim();
    // Expected empty means "must produce some output" OR exact match if provided.
    correct = expected ? output === expected : output.length > 0;
  } catch (e) {
    output = "(runtime error)";
  }
  const xp = correct ? XP_CHALLENGE : 0;
  recordAttempt(uid, { track, level, lessonId, sectionType: "coding_challenge", correct, skill });
  // Evidence for the Evidence Engine.
  recordEvidence(uid, { track, level, type: "challenge", correct, score: correct ? 100 : 0, skill, detail: lessonId });
  return { correct, xp, output, expected: String(challenge.expected ?? "").trim() };
}

module.exports = { gradeQuiz, gradeChallenge, XP_QUIZ, XP_CHALLENGE };
