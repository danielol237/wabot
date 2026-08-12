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
// `challenge`: { lang, expected, tests? }. When `tests` is present (an array
// of { input, expected }) the code must pass ALL of them — including hidden
// ones — so a student can't just hardcode the one visible expected output.
// Returns { correct, xp, output, expected }.
async function gradeChallenge(uid, { track, level, lessonId, skill }, code, challenge) {
  const lang = challenge.lang || "js";
  const map = { js: "js", javascript: "js", py: "py", python: "py", ts: "js" };
  const runLang = map[lang] || "js";
  const tests = Array.isArray(challenge.tests) && challenge.tests.length ? challenge.tests : null;
  let correct = false;
  let output = "";
  let results = [];
  try {
    if (tests) {
      // Hidden-test harness: run the code once per test, feeding `input` as
      // stdin and requiring EVERY test's expected output to match.
      let allPass = true;
      for (const t of tests) {
        const input = String(t.input ?? "");
        const result = await runCode(code, runLang, { timeout: 5000, strict: true, stdin: input });
        if (result.blocked) {
          return { correct: false, xp: 0, output: result.output, expected: "", blocked: true };
        }
        const got = String(result?.output ?? result?.result ?? "").trim();
        const exp = String(t.expected ?? "").trim();
        const pass = exp ? got === exp : got.length > 0;
        results.push({ input, got, expected: exp, pass });
        if (!pass) allPass = false;
      }
      correct = allPass;
      output = results.map((r) => `[${r.pass ? "✓" : "✗"}] in=${r.input} → ${r.got}`).join("\n");
    } else {
      // Single-output mode (no hidden tests defined).
      const result = await runCode(code, runLang, { timeout: 5000, strict: true });
      if (result.blocked) {
        return { correct: false, xp: 0, output: result.output, expected: String(challenge.expected ?? "").trim(), blocked: true };
      }
      output = String(result?.output ?? result?.result ?? "").trim();
      const expected = String(challenge.expected ?? "").trim();
      correct = expected ? output === expected : output.length > 0;
      results = [{ got: output, expected, pass: correct }];
    }
  } catch (e) {
    output = "(runtime error)";
  }
  const xp = correct ? XP_CHALLENGE : 0;
  recordAttempt(uid, { track, level, lessonId, sectionType: "coding_challenge", correct, skill });
  // Evidence for the Evidence Engine.
  recordEvidence(uid, { track, level, type: "challenge", correct, score: correct ? 100 : 0, skill, detail: lessonId });
  return { correct, xp, output, expected: String(challenge.expected ?? "").trim(), results };
}

module.exports = { gradeQuiz, gradeChallenge, XP_QUIZ, XP_CHALLENGE };
