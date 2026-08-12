// ── ARIA Study System v2 ─────────────────────────────────────────
// Interactive learning flow with ASSESSMENT. User runs !study, picks a
// language, picks a level, then works through lessons. Lessons can contain a
// QUIZ (knowledge check with XP) and an EXERCISE (coding practice). Progress,
// XP, mastery, and streaks are tracked per user and persisted.
//
// Flow: !study → lang → level → lesson view → [quiz → XP] → next
//
// This upgrades the v1 "lesson navigator" into a real learning engine:
//   • lesson IDs + curriculum versioning (progress survives curriculum edits)
//   • quizzes with XP, wrong-answer explanation + retry
//   • XP / mastery % / streak per user
//   • dashboard progress center data

const fs = require("fs");
const path = require("path");
const { LANGUAGES } = require("../data/studyCurriculum");
const CURRICULUM_VERSION = 2;

const STATE_FILE = path.join(__dirname, "../../data/studyState.json");
const PROGRESS_FILE = path.join(__dirname, "../../data/studyProgress.json");

let state = { chats: {} };
let progress = { users: {} };

function load(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) || fallback; }
  catch (_) {}
  return fallback;
}
function save(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch (_) {}
}
state = load(STATE_FILE, { chats: {} });
progress = load(PROGRESS_FILE, { users: {} });
progress.curriculumVersion = progress.curriculumVersion || CURRICULUM_VERSION;

const CMD_LANGS = ["html", "css", "js", "react", "node", "python", "cpp", "git"];
const LEVELS = [
  { id: "beginner", label: "Beginner", emoji: "🌱" },
  { id: "intermediate", label: "Intermediate", emoji: "🌿" },
  { id: "advanced", label: "Advanced", emoji: "🔥" },
  { id: "pro", label: "Pro", emoji: "👑" },
];

// XP awards
const XP_LESSON = 25;   // navigating/reading a lesson
const XP_QUIZ = 15;     // correct quiz answer
const XP_EXERCISE = 40; // correct coding exercise

// ── Lesson lookup ─────────────────────────────────────────────
// Resolve a lesson by language/level/index. Returns { lesson, idx, id }.
function lessonAt(lang, level, idx) {
  const lessons = LANGUAGES[lang]?.levels?.[level] || [];
  const i = Math.max(0, Math.min(idx || 0, lessons.length - 1));
  const lesson = lessons[i];
  return { lesson, idx: i, lessons, id: lesson?.id || `${lang}-${level}-${i}` };
}

// ── User progress helpers ─────────────────────────────────────
function userRec(uid) {
  progress.users[uid] = progress.users[uid] || { xp: 0, streak: 0, lastStudy: null, langs: {} };
  const u = progress.users[uid];
  // migrate version
  if (!u.langs) u.langs = {};
  if (!u.totalXp) u.totalXp = 0;
  return u;
}

function langRec(uid, lang) {
  const u = userRec(uid);
  u.langs[lang] = u.langs[lang] || { lessons: {}, quizCorrect: 0, quizTotal: 0, exercises: 0 };
  return u.langs[lang];
}

function addXp(uid, amt) {
  const u = userRec(uid);
  u.totalXp = (u.totalXp || 0) + amt;
  u.xp = (u.xp || 0) + amt;
  // streak: last study today keeps it; if last study was yesterday, +1; else reset
  const today = new Date().toDateString();
  if (u.lastStudy === today) { /* same day, no change */ }
  else if (u.lastStudy) {
    const diff = Math.floor((Date.now() - new Date(u.lastStudy + "T00:00:00").getTime()) / 86400000);
    u.streak = diff <= 1 ? (u.streak || 0) + 1 : 1;
  } else u.streak = 1;
  u.lastStudy = today;
  save(PROGRESS_FILE, progress);
}

// Mark a lesson as read (by id) → +XP
function markLessonRead(uid, lang, level, idx, id) {
  const rec = langRec(uid, lang);
  rec.lessons[id] = rec.lessons[id] || { idx, read: 0, quizCorrect: 0, quizAttempts: 0, exerciseDone: false };
  if (!rec.lessons[id].read) {
    rec.lessons[id].read = 1;
    addXp(uid, XP_LESSON);
  } else {
    save(PROGRESS_FILE, progress);
  }
}

// Record a quiz answer. Returns { correct, xp, explanation, lessonXp... }.
function quizAnswer(uid, lang, level, idx, id, answerLetter) {
  const { lesson } = lessonAt(lang, level, idx);
  const quiz = lesson.quiz;
  const rec = langRec(uid, lang);
  rec.lessons[id] = rec.lessons[id] || { idx, read: 1, quizCorrect: 0, quizAttempts: 0, exerciseDone: false };
  rec.lessons[id].quizAttempts = (rec.lessons[id].quizAttempts || 0) + 1;
  rec.quizTotal = (rec.quizTotal || 0) + 1;

  const a = String(answerLetter).trim().toUpperCase();
  const correct = quiz && a === (quiz.answer || "").toUpperCase();

  if (correct) {
    rec.lessons[id].quizCorrect = 1;
    rec.quizCorrect = (rec.quizCorrect || 0) + 1;
    addXp(uid, XP_QUIZ);
  } else {
    save(PROGRESS_FILE, progress);
  }

  const explanation = quiz ? (correct ? quiz.explain : quiz.retryExplain || "Check the lesson and try again.") : "";
  return { correct, xp: correct ? XP_QUIZ : 0, explanation, answer: quiz?.answer };
}

// Record a successful coding exercise → +XP
function markExerciseDone(uid, lang, level, idx, id) {
  const rec = langRec(uid, lang);
  rec.lessons[id] = rec.lessons[id] || { idx, read: 1, quizCorrect: 0, quizAttempts: 0, exerciseDone: false };
  if (!rec.lessons[id].exerciseDone) {
    rec.lessons[id].exerciseDone = true;
    rec.exercises = (rec.exercises || 0) + 1;
    addXp(uid, XP_EXERCISE);
  }
  save(PROGRESS_FILE, progress);
}

function countDone(uid, lang, level) {
  const rec = langRec(uid, lang);
  return Object.values(rec.lessons).filter((l) => l.read).length;
}

function masteryPct(uid, lang, level) {
  const lessons = LANGUAGES[lang]?.levels?.[level] || [];
  if (!lessons.length) return 0;
  const rec = langRec(uid, lang);
  const read = lessons.filter((l) => rec.lessons[l.id]?.read).length;
  return Math.round((read / lessons.length) * 100);
}

// ── State / flow ──────────────────────────────────────────────
function hasActiveFlow(chatId) {
  return !!(state.chats[chatId] && state.chats[chatId].step);
}

function startFlow(chatId, uid) {
  state.chats[chatId] = { uid, step: "lang" };
  save(STATE_FILE, state);
  return langMenu();
}

function langMenu() {
  const lines = CMD_LANGS.map((l, i) => `${i + 1}. ${LANGUAGES[l].name} — ${LANGUAGES[l].tagline}`);
  return `🎓 *ARIA Study* — pick a language:\n\n${lines.join("\n")}\n\nReply with a number (1-${CMD_LANGS.length}).`;
}

function levelMenu(chatId) {
  const st = state.chats[chatId];
  if (!st) return "Start with !study first.";
  const l = LANGUAGES[st.lang];
  return `🎓 *${l.name}* — choose your level:\n\n` +
    LEVELS.map((lv, i) => `${i + 1}. ${lv.emoji} ${lv.label}`).join("\n") +
    `\n\nReply with a number (1-${LEVELS.length}).`;
}

// Render the current lesson. If it has a quiz, after showing it we prompt
// for the quiz first before allowing next (assessment-before-progress).
function lessonView(chatId) {
  const st = state.chats[chatId];
  const { lesson, idx, lessons } = lessonAt(st.lang, st.level, st.lesson);
  const level = LEVELS.find((l) => l.id === st.level);
  const done = countDone(st.uid, st.lang, st.level);
  const mastery = masteryPct(st.uid, st.lang, st.level);
  const quiz = lesson.quiz;
  let out = `🎓 *${LANGUAGES[st.lang].name} — ${level.emoji} ${level.label}*\n📚 Lesson ${idx + 1}/${lessons.length}\n\n*${lesson.title}*\n${lesson.topic}\n\n_${lesson.learn}\n\nProgress: ${done}/${lessons.length} · Mastery ${mastery}%_\n\n`;
  if (quiz) {
    out += `\n📝 *Quick check* — ${quiz.question}\n\n${quiz.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join("\n")}\n\nReply with the letter (A-D) or *next* to move on.`;
  } else {
    out += `\n▸ next / prev / <number> / back / done`;
  }
  return out;
}

function quizView(chatId) {
  const st = state.chats[chatId];
  const { lesson } = lessonAt(st.lang, st.level, st.lesson);
  const q = lesson.quiz;
  if (!q) return null;
  return `📝 *Quick check*\n${q.question}\n\n${q.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join("\n")}\n\nReply with the letter (A-D).`;
}

// Handle a plain reply during an active flow. Returns { text } or null.
async function handleReply(chatId, uid, input) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return null;
  const n = parseInt(input, 10);

  if (st.step === "lang") {
    if (!Number.isFinite(n) || n < 1 || n > CMD_LANGS.length) return { text: `That's not a valid choice. Reply with a number 1-${CMD_LANGS.length}.` };
    st.lang = CMD_LANGS[n - 1]; st.step = "level";
    save(STATE_FILE, state);
    return { text: levelMenu(chatId) };
  }

  if (st.step === "level") {
    if (!Number.isFinite(n) || n < 1 || n > LEVELS.length) return { text: `That's not a valid choice. Reply with a number 1-${LEVELS.length}.` };
    st.level = LEVELS[n - 1].id; st.lesson = 0;
    markLessonRead(st.uid, st.lang, st.level, 0, lessonAt(st.lang, st.level, 0).id);
    st.step = "lesson";
    save(STATE_FILE, state);
    return { text: lessonView(chatId) };
  }

  if (st.step === "lesson") {
    const { lesson, idx, lessons } = lessonAt(st.lang, st.level, st.lesson || 0);
    const hasQuiz = !!lesson.quiz;
    // If this lesson has an unanswered quiz, answer letters route here first.
    if (hasQuiz && /^[a-d]$/i.test(input.trim())) {
      const r = quizAnswer(st.uid, st.lang, st.level, idx, lesson.id, input.trim());
      if (r.correct) {
        return { text: `✅ Correct! +${r.xp} XP\n\n${r.explanation || ""}\n\n▸ next / prev / <number> / back / done` };
      }
      return { text: `❌ Not quite. ${r.explanation || "Try again."}\n\nReply with the letter (A-D) or *next*.` };
    }

    if (/next/i.test(input)) {
      if (st.lesson < lessons.length - 1) st.lesson += 1; else return { text: "You're at the last lesson. Type *back* to change level or *done* to finish." };
      const { lesson: nl, id: nid } = lessonAt(st.lang, st.level, st.lesson);
      markLessonRead(st.uid, st.lang, st.level, st.lesson, nid);
      save(STATE_FILE, state);
      return { text: lessonView(chatId) };
    }
    if (/prev/i.test(input)) {
      st.lesson = Math.max(st.lesson - 1, 0);
      save(STATE_FILE, state);
      return { text: lessonView(chatId) };
    }
    if (Number.isFinite(n)) {
      if (n < 1 || n > lessons.length) return { text: `Only ${lessons.length} lessons. Reply with 1-${lessons.length}.` };
      st.lesson = n - 1;
      const { id: nid } = lessonAt(st.lang, st.level, st.lesson);
      markLessonRead(st.uid, st.lang, st.level, st.lesson, nid);
      save(STATE_FILE, state);
      return { text: lessonView(chatId) };
    }
    if (/back/i.test(input)) { st.step = "level"; delete st.lesson; save(STATE_FILE, state); return { text: levelMenu(chatId) }; }
    if (/lang|restart/i.test(input)) { st.step = "lang"; delete st.level; delete st.lesson; save(STATE_FILE, state); return { text: langMenu() }; }
    if (/done|exit/i.test(input)) {
      const u = userRec(st.uid);
      delete state.chats[chatId]; save(STATE_FILE, state);
      return { text: `Done! 🎉 Total XP: *${u.totalXp}* · Streak: ${u.streak || 0} day${u.streak === 1 ? "" : "s"}. Ping !study anytime.` };
    }
    return { text: "Reply: *next*, *prev*, a lesson number, *back*, *done*, or a quiz letter (A-D)." };
  }

  return null;
}

// ── Coding exercise (reuse codeRunner) ───────────────────────
// If a lesson has an exercise, user can send `!run` + code, or type the
// answer. We verify JS/Python output against expected. Returns { text }.
async function runExercise(chatId, uid, code) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return null;
  const { lesson, idx, id } = lessonAt(st.lang, st.level, st.lesson || 0);
  const ex = lesson.exercise;
  if (!ex) return { text: "This lesson doesn't have a coding exercise yet." };

  // Run in the sandbox (falls back to local unsafe if no Docker).
  const lang = ex.lang || (st.lang === "js" ? "js" : st.lang === "python" ? "py" : "js");
  try {
    const { runCode } = require("./codeSandbox");
    const result = await runCode(code, lang, { timeout: 5000 });
    const actual = String(result?.output ?? result?.result ?? "").trim();
    const expected = String(ex.expected ?? "").trim();
    const pass = result?.success === false ? false : (expected ? actual === expected : actual.length > 0);
    if (pass) {
      markExerciseDone(uid, st.lang, st.level, idx, id);
      return { text: `✅ Correct! Output:\n\`\`\`\n${actual.slice(0, 400)}\n\`\`\`\n+${XP_EXERCISE} XP` };
    }
    return { text: `❌ Not quite. Expected:\n\`\`\`\n${expected.slice(0, 400)}\n\`\`\`\nGot:\n\`\`\`\n${actual.slice(0, 400) || "(no output)"}\n\`\`\`\nTry again, or *next*.` };
  } catch (e) {
    return { text: `⚠️ Exercise runner error: ${e.message}` };
  }
}

// ── Data for dashboard ───────────────────────────────────────
function getUserStats(uid) {
  const u = userRec(uid);
  return { xp: u.totalXp || 0, streak: u.streak || 0 };
}

function getCurriculumOverview() {
  return CMD_LANGS.map((l) => {
    const lang = LANGUAGES[l];
    const total = Object.values(lang.levels).reduce((s, arr) => s + arr.length, 0);
    return { id: l, name: lang.name, tagline: lang.tagline, levels: Object.keys(lang.levels).length, totalLessons: total };
  });
}

function getLangLevels(langId) {
  const lang = LANGUAGES[langId];
  if (!lang) return null;
  return { name: lang.name, levels: LEVELS.map((l) => ({ id: l.id, label: l.label, emoji: l.emoji, count: (lang.levels[l.id] || []).length })) };
}

function getUserLangProgress(uid, lang) {
  const rec = langRec(uid, lang);
  return LEVELS.map((l) => ({
    id: l.id, label: l.label, emoji: l.emoji,
    mastery: masteryPct(uid, lang, l.id),
    done: Object.values(rec.lessons).filter((x) => {
      const li = LANGUAGES[lang]?.levels?.[l.id] || [];
      return li.some((lesson) => rec.lessons[lesson.id]?.read);
    }).length,
    total: (LANGUAGES[lang]?.levels?.[l.id] || []).length,
  }));
}

// ── Command handler ──────────────────────────────────────────
async function handleStudyCommand(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const uid = (ctx.senderJid || "").split("@")[0];
  const arg = (Array.isArray(args) ? args[0] : args || "").toLowerCase();
  const langMap = { html: "html", css: "css", js: "js", javascript: "js", react: "react", node: "node", nodejs: "node", python: "python", py: "python", cpp: "cpp", "c++": "cpp", git: "git" };
  if (langMap[arg]) {
    state.chats[ctx.chatId] = { uid, step: "level", lang: langMap[arg] };
    save(STATE_FILE, state);
    return reply(sock, msg, levelMenu(ctx.chatId));
  }
  return reply(sock, msg, startFlow(ctx.chatId, uid));
}

module.exports = { handleStudyCommand, startFlow, handleReply, runExercise, hasActiveFlow, langMenu, levelMenu, lessonView, markLessonRead, quizAnswer, markExerciseDone, countDone, masteryPct, getCurriculumOverview, getLangLevels, getUserLangProgress, getUserStats, CMD_LANGS, LEVELS, XP_LESSON, XP_QUIZ, XP_EXERCISE };
