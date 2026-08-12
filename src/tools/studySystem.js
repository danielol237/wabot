// ── ARIA Study System ─────────────────────────────────────────────
// An interactive, stateful study feature. User runs !study, picks a language,
// picks a difficulty (Beginner → Pro), and ARIA walks them through a real
// curriculum of lessons.
//
// Flow (per chat): !study → pick language → pick level → lesson view.
// State is held in-memory per chat and persisted to disk so it survives
// restarts. Progress (completed lessons) is tracked per user.
//
// Design: BROAD, not half-assed. Every language has 4 levels
// (beginner → intermediate → advanced → pro), each with a full list of
// lessons (title + topic + what you'll learn). Content lives in
// src/data/studyCurriculum.js.

const fs = require("fs");
const path = require("path");
const { CURRICULUM, LANGUAGES } = require("../data/studyCurriculum");

const STATE_FILE = path.join(__dirname, "../../data/studyState.json");
const PROGRESS_FILE = path.join(__dirname, "../../data/studyProgress.json");

let state = { chats: {} };        // { [chatId]: { uid, step, lang, level } }
let progress = { users: {} };     // { [userId]: { [lang]: { [level]: [lessonIdx...] } } }

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

// ── Public API ────────────────────────────────────────────────
const CMD_LANGS = ["html", "css", "js", "react", "node", "python", "cpp", "git"];
const LEVELS = [
  { id: "beginner", label: "Beginner", emoji: "🌱" },
  { id: "intermediate", label: "Intermediate", emoji: "🌿" },
  { id: "advanced", label: "Advanced", emoji: "🔥" },
  { id: "pro", label: "Pro", emoji: "👑" },
];

function langLabel(id) {
  const l = LANGUAGES[id] || LANGUAGES[CMD_LANGS.find((k) => k === id)];
  return l ? l.name : id;
}

// Does this chat have an active study flow?
function hasActiveFlow(chatId) {
  return !!(state.chats[chatId] && state.chats[chatId].step);
}

// Begin a study session: show language menu.
function startFlow(chatId, uid) {
  state.chats[chatId] = { uid, step: "lang" };
  save(STATE_FILE, state);
  return langMenu();
}

function langMenu() {
  const lines = CMD_LANGS.map((l, i) => `${i + 1}. ${LANGUAGES[l].name} — ${LANGUAGES[l].tagline}`);
  return `🎓 *ARIA Study* — pick a language to learn:\n\n${lines.join("\n")}\n\nReply with a number (1-${CMD_LANGS.length}).`;
}

function levelMenu(chatId) {
  const st = state.chats[chatId];
  if (!st) return "Start with !study first.";
  const lang = st.lang;
  const l = LANGUAGES[lang];
  return `🎓 *${l.name}* — choose your level:\n\n` +
    LEVELS.map((lv, i) => `${i + 1}. ${lv.emoji} ${lv.label}`).join("\n") +
    `\n\nReply with a number (1-${LEVELS.length}).`;
}

// Handle a plain-number (or word) reply during an active flow.
function handleReply(chatId, uid, input) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return null; // not this user's flow
  const n = parseInt(input, 10);

  if (st.step === "lang") {
    if (!Number.isFinite(n) || n < 1 || n > CMD_LANGS.length) {
      return `That's not a valid choice. Reply with a number 1-${CMD_LANGS.length}.`;
    }
    st.lang = CMD_LANGS[n - 1];
    st.step = "level";
    save(STATE_FILE, state);
    return levelMenu(chatId);
  }

  if (st.step === "level") {
    if (!Number.isFinite(n) || n < 1 || n > LEVELS.length) {
      return `That's not a valid choice. Reply with a number 1-${LEVELS.length}.`;
    }
    st.level = LEVELS[n - 1].id;
    st.lesson = 0;
    st.step = "lesson";
    save(STATE_FILE, state);
    return lessonView(chatId);
  }

  if (st.step === "lesson") {
    // Navigate: next, prev, or pick a lesson number.
    const lang = LANGUAGES[st.lang];
    const lessons = lang.levels[st.level] || [];
    if (!lessons.length) return "No lessons here yet.";
    if (/next/i.test(input)) st.lesson = Math.min(st.lesson + 1, lessons.length - 1);
    else if (/prev/i.test(input)) st.lesson = Math.max(st.lesson - 1, 0);
    else if (Number.isFinite(n)) {
      if (n < 1 || n > lessons.length) return `Only ${lessons.length} lessons. Reply with 1-${lessons.length}.`;
      st.lesson = n - 1;
    } else if (/back/i.test(input)) {
      st.step = "level"; delete st.lesson;
      save(STATE_FILE, state);
      return levelMenu(chatId);
    } else if (/lang|restart/i.test(input)) {
      st.step = "lang"; delete st.level; delete st.lesson;
      save(STATE_FILE, state);
      return langMenu();
    } else if (/done|exit/i.test(input)) {
      delete state.chats[chatId];
      save(STATE_FILE, state);
      return "Done! 🎉 Ping me with !study anytime to pick back up.";
    } else return "Reply: *next*, *prev*, a lesson number, *back*, or *done*.";
    save(STATE_FILE, state);
    return lessonView(chatId);
  }

  return null;
}

function lessonView(chatId) {
  const st = state.chats[chatId];
  const lang = LANGUAGES[st.lang];
  const lessons = lang.levels[st.level] || [];
  if (!lessons.length) return `No lessons for ${st.level} yet — I'm building more.`;
  const idx = Math.max(0, Math.min(st.lesson || 0, lessons.length - 1));
  const lesson = lessons[idx];
  const level = LEVELS.find((l) => l.id === st.level);
  const done = countDone(st.uid, st.lang, st.level);
  return `🎓 *${lang.name} — ${level.emoji} ${level.label}*\n📚 Lesson ${idx + 1}/${lessons.length}\n\n*${lesson.title}*\n${lesson.topic}\n\n_${lesson.learn}\n\nProgress: ${done}/${lessons.length} complete_\n\n▸ next / prev / <number> / back / done`;
}

// ── Progress tracking ─────────────────────────────────────────
function markDone(uid, lang, level, lessonIdx) {
  progress.users[uid] = progress.users[uid] || {};
  progress.users[uid][lang] = progress.users[uid][lang] || {};
  const arr = progress.users[uid][lang][level] || [];
  if (!arr.includes(lessonIdx)) arr.push(lessonIdx);
  progress.users[uid][lang][level] = arr;
  save(PROGRESS_FILE, progress);
}

function countDone(uid, lang, level) {
  return (progress.users[uid]?.[lang]?.[level] || []).length;
}

function getLangLevels(langId) {
  const lang = LANGUAGES[langId];
  if (!lang) return null;
  return { name: lang.name, levels: LEVELS.map((l) => ({
    id: l.id, label: l.label, emoji: l.emoji,
    count: (lang.levels[l.id] || []).length,
  })) };
}

function getCurriculumOverview() {
  return CMD_LANGS.map((l) => {
    const lang = LANGUAGES[l];
    const total = Object.values(lang.levels).reduce((s, arr) => s + arr.length, 0);
    return { id: l, name: lang.name, tagline: lang.tagline, levels: Object.keys(lang.levels).length, totalLessons: total };
  });
}

// Expose the handler entrypoint used by the command router.
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

module.exports = { handleStudyCommand, startFlow, handleReply, hasActiveFlow, langMenu, levelMenu, lessonView, markDone, countDone, getLangLevels, getCurriculumOverview, CMD_LANGS, LEVELS };
