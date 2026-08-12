// ── ARIA Academy — Orchestrator ──────────────────────────────────
// Ties together Curriculum Engine, Assessment Engine, Learner Model, and
// Adaptive Tutor into the chat + command flow.
//
// Flow: !academy → pick track → pick level → lesson (rendered section by
// section) → assessment → next. The adaptive tutor can inject a drill.

const fs = require("fs");
const path = require("path");
const { lessonAt, allTrackOverviews, levelLessons, CURRICULUM_VERSION, LEVEL_DEFS } = require("./curriculumEngine");
const { gradeQuiz, gradeChallenge, XP_QUIZ, XP_CHALLENGE } = require("./assessmentEngine");
const { addXp, setMastery, getMastery, getStats } = require("./learnerModel");
const { recommend } = require("./adaptiveTutor");
const { startProject, projectView, hasActiveProject, handleProjectReply } = require("./projectWorkspace");

const STATE_FILE = path.join(__dirname, "../../../data/academyState.json");

let state = { chats: {} };
function load() {
  try { if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || { chats: {} }; }
  catch (_) { state = { chats: {} }; }
}
function save() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) {} }
load();

// ── Flow helpers ──────────────────────────────────────────────
function hasActiveFlow(chatId) {
  return !!(state.chats[chatId] && state.chats[chatId].step);
}

function startFlow(chatId, uid) {
  state.chats[chatId] = { uid, step: "track" };
  save();
  return trackMenu();
}

function trackMenu() {
  const overviews = allTrackOverviews();
  const lines = overviews.map((t, i) => `${i + 1}. ${t.emoji} ${t.name} — ${t.tagline} (${t.totalLessons} lessons)`);
  return `🎓 *ARIA Academy*\nPick a track:\n\n${lines.join("\n")}\n\nReply with a number (1-${overviews.length}).`;
}

function levelMenu(chatId) {
  const st = state.chats[chatId];
  const overview = allTrackOverviews().find((t) => t.id === st.track);
  const levels = Object.keys(LEVEL_DEFS);
  return `🎓 *${overview.name}*\nChoose your level:\n\n${levels.map((lv, i) => `${i + 1}. ${LEVEL_DEFS[lv]} ${lv}`).join("\n")}\n\nReply with a number (1-${levels.length}).`;
}

// Render a lesson section by section. Returns { text, awaiting } where
// awaiting indicates the next expected input (e.g. "quiz" or "challenge").
function renderLesson(chatId, sectionIdx) {
  const st = state.chats[chatId];
  const { lesson, idx, lessons } = lessonAt(st.track, st.level, st.lessonIdx);
  const sections = lesson.sections || [];
  const si = Math.min(sectionIdx, sections.length - 1);
  const section = sections[si];

  let text = `🎓 *${allTrackOverviews().find((t) => t.id === st.track).name} — ${LEVEL_DEFS[st.level]} ${st.level}*\n`;
  text += `📚 Lesson ${idx + 1}/${lessons.length} · section ${si + 1}/${sections.length}\n\n`;
  text += `*${lesson.title}*\n`;

  switch (section.type) {
    case "explanation":
      text += `${section.content}\n\n▸ reply *next* to continue`;
      return { text, awaiting: "nav", sectionIdx: si, totalSections: sections.length };
    case "example":
      text += `${section.content || ""}\n\n\`\`\`\n${section.code || ""}\n\`\`\`\n\n▸ reply *next*`;
      return { text, awaiting: "nav", sectionIdx: si, totalSections: sections.length };
    case "quiz": {
      const opts = section.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join("\n");
      text += `\n📝 *${section.title || "Quick check"}*\n${section.question}\n\n${opts}\n\nReply with the letter (A-${String.fromCharCode(64 + section.options.length)}).`;
      return { text, awaiting: "quiz", sectionIdx: si, totalSections: sections.length };
    }
    case "coding_challenge":
      text += `\n🧪 *${section.title || "Coding challenge"}*\n${section.prompt}\n\nWrite your code and send it with:\n!run <your code>`;
      return { text, awaiting: "challenge", sectionIdx: si, totalSections: sections.length };
    case "project":
      text += `\n🏗️ *${section.title || "Project"}*\n${section.content || section.prompt}\n\nBuild this and send it, or *next* to skip.`;
      return { text, awaiting: "nav", sectionIdx: si, totalSections: sections.length };
    default:
      text += `${section.content || section.title || ""}\n\n▸ reply *next*`;
      return { text, awaiting: "nav", sectionIdx: si, totalSections: sections.length };
  }
}

// Advance to the next section or lesson.
function nextSection(chatId) {
  const st = state.chats[chatId];
  const { lesson, lessons } = lessonAt(st.track, st.level, st.lessonIdx);
  const sections = lesson.sections || [];
  const si = (st.sectionIdx || 0);
  if (si < sections.length - 1) {
    st.sectionIdx = si + 1;
    save();
    return renderLesson(chatId, st.sectionIdx);
  }
  // Section done → next lesson or track complete.
  if (st.lessonIdx < lessons.length - 1) {
    st.lessonIdx += 1;
    st.sectionIdx = 0;
    save();
    return renderLesson(chatId, 0);
  }
  // Track level complete.
  const level = LEVEL_DEFS[st.level];
  const mastery = 100; // reached the end
  setMastery(st.uid, st.track, st.level, mastery);
  delete state.chats[chatId];
  save();
  const rec = recommend(st.uid, { currentTrack: st.track, currentLevel: st.level });
  return { text: `🎉 You finished *${allTrackOverviews().find((t) => t.id === st.track).name} — ${level} ${st.level}*! Mastery 100%.\n\n${rec.reason}\n\nRun !academy to pick your next path.`, completed: true, mastery: 100 };
}

// Main reply handler. Returns { text } or null if not this user's flow.
async function handleReply(chatId, uid, input) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return null;
  const n = parseInt(input, 10);

  if (st.step === "track") {
    const overviews = allTrackOverviews();
    if (!Number.isFinite(n) || n < 1 || n > overviews.length) return { text: `Reply with a number 1-${overviews.length}.` };
    st.track = overviews[n - 1].id; st.step = "level"; save();
    return { text: levelMenu(chatId) };
  }

  if (st.step === "level") {
    const levels = Object.keys(LEVEL_DEFS);
    if (!Number.isFinite(n) || n < 1 || n > levels.length) return { text: `Reply with a number 1-${levels.length}.` };
    st.level = levels[n - 1]; st.lessonIdx = 0; st.sectionIdx = 0; st.step = "lesson";
    addXp(st.uid, 25); // starting a lesson
    save();
    return renderLesson(chatId, 0);
  }

  if (st.step === "lesson") {
    // If a project is active in this chat, route replies to it first.
    const pReply = handleProjectReply(chatId, st.uid, input);
    if (pReply) return pReply;
    const { lesson } = lessonAt(st.track, st.level, st.lessonIdx);
    const sections = lesson.sections || [];
    const section = sections[st.sectionIdx || 0];

    // Quiz answer
    if (section?.type === "quiz" && /^[a-d]$/i.test(input.trim())) {
      const g = gradeQuiz(st.uid, {
        track: st.track, level: st.level, lessonId: lesson.id, skill: lesson.skill,
      }, section, input.trim());
      if (g.correct) addXp(st.uid, g.xp);
      const exp = g.correct ? `✅ Correct! +${g.xp} XP` : `❌ ${g.explanation || "Try again."}`;
      return { text: `${exp}\n\n▸ reply *next* to continue` };
    }

    if (/next|continue/i.test(input)) return nextSection(chatId);
    if (/prev/i.test(input)) { st.sectionIdx = Math.max((st.sectionIdx || 0) - 1, 0); save(); return renderLesson(chatId, st.sectionIdx); }
    if (/back/i.test(input)) { st.step = "level"; delete st.lessonIdx; save(); return { text: levelMenu(chatId) }; }
    if (/track|restart/i.test(input)) { st.step = "track"; delete st.level; delete st.lessonIdx; save(); return { text: trackMenu() }; }
    if (/done|exit/i.test(input)) {
      const stats = getStats(st.uid);
      delete state.chats[chatId]; save();
      return { text: `Done! 🎉 XP: *${stats.xp}* · streak ${stats.streak} day${stats.streak === 1 ? "" : "s"}. Ping !academy anytime.` };
    }
    // numeric = jump to lesson
    const { lessons } = lessonAt(st.track, st.level, 0);
    if (Number.isFinite(n) && n >= 1 && n <= lessons.length) {
      st.lessonIdx = n - 1; st.sectionIdx = 0; save(); return renderLesson(chatId, 0);
    }
    return { text: "Reply: *next*, *prev*, a lesson number, *back*, *done*, or a quiz letter." };
  }

  return null;
}

// Handle a coding challenge submission via !run.
async function handleRun(chatId, uid, code) {
  const st = state.chats[chatId];
  if (!st || st.uid !== uid) return { text: "Start a session with !academy first." };
  const { lesson } = lessonAt(st.track, st.level, st.lessonIdx);
  const section = (lesson.sections || [])[st.sectionIdx || 0];
  if (section?.type !== "coding_challenge") return { text: "This lesson section isn't a coding challenge. Use *next*." };
  const g = await gradeChallenge(st.uid, {
    track: st.track, level: st.level, lessonId: lesson.id, skill: lesson.skill,
  }, code, section);
  if (g.correct) addXp(st.uid, g.xp);
  return {
    text: `${g.correct ? `✅ Correct! +${g.xp} XP` : "❌ Not quite."}\n\n${g.correct ? "" : `Expected:\n\`\`\`\n${g.expected}\n\`\`\`\nGot:\n\`\`\`\n${g.output || "(no output)"}\n\`\`\`\n`}▸ reply *next*`,
  };
}

// Command entrypoints.
async function handleAcademyCommand(sock, msg, args, ctx) {
  const { reply } = require("../../utils/baileysHelpers");
  const uid = (ctx.senderJid || "").split("@")[0];
  const arg = (Array.isArray(args) ? args[0] : args || "").toLowerCase();
  const overviews = allTrackOverviews();
  const match = overviews.find((t) => t.id === arg || t.name.toLowerCase() === arg);
  if (match) {
    state.chats[ctx.chatId] = { uid, step: "level", track: match.id };
    save();
    return reply(sock, msg, levelMenu(ctx.chatId));
  }
  if (arg === "me" || arg === "stats") {
    const s = getStats(uid);
    const r = recommend(uid);
    return reply(sock, msg, `📊 *Your academy stats*\nXP: *${s.xp}* · streak ${s.streak} · ${s.attempts} attempts\n\n🎯 ${r.reason}`);
  }
  return reply(sock, msg, startFlow(ctx.chatId, uid));
}

async function handleAcademyRun(sock, msg, args, ctx) {
  const { reply } = require("../../utils/baileysHelpers");
  if (!hasActiveFlow(ctx.chatId)) return reply(sock, msg, "Start with !academy first, then use !run <code> on a challenge.");
  const uid = (ctx.senderJid || "").split("@")[0];
  const code = (Array.isArray(args) ? args.join(" ") : args || "").trim();
  if (!code) return reply(sock, msg, "Usage: !run <code>");
  const result = await handleRun(ctx.chatId, uid, code);
  return reply(sock, msg, result.text);
}

// Start a project: !project <track> <level>
async function handleProjectCommand(sock, msg, args, ctx) {
  const { reply } = require("../../utils/baileysHelpers");
  const uid = (ctx.senderJid || "").split("@")[0];
  const parts = (Array.isArray(args) ? args : String(args || "").split(/\s+/)).map((x) => x.toLowerCase());
  const track = parts[0];
  const level = parts[1];
  const overviews = allTrackOverviews();
  const match = overviews.find((t) => t.id === track || t.name.toLowerCase() === track);
  if (!match || !level) return reply(sock, msg, "Usage: !project <track> <level>\nExample: !project backend intermediate");
  const r = startProject(ctx.chatId, uid, match.id, level);
  return reply(sock, msg, r.text);
}

module.exports = { hasActiveFlow, startFlow, handleReply, handleRun, handleAcademyCommand, handleAcademyRun, handleProjectCommand, trackMenu, levelMenu };
