// ── ARIA Academy — Curriculum Engine ─────────────────────────────
// Owns the curriculum: tracks, levels, and lessons. Lessons are COMPOSABLE
// lists of typed sections (not a rigid pipeline), so a beginner lesson and a
// pro capstone can look completely different.
//
// Lesson schema:
//   {
//     id, title, objectives: [..], prerequisites: [..],
//     estimatedMinutes, masteryThreshold,
//     sections: [ { type, ... } ],
//     assessment: { masteryThreshold, quiz? }
//   }
//
// Section types:
//   explanation, example, interactive, quiz, coding_challenge,
//   debugging, project, architecture, review
//
// The engine normalizes legacy lesson data ({ topic, learn, theory, example,
// quiz, exercise }) into the sections format so old content still works.

const { TRACKS, LEVEL_DEFS } = require("../../data/academyTracks");
const { LANGUAGES: LEGACY } = require("../../data/studyCurriculum");
const { ACADEMY } = require("../../data/academyCurriculum");

const CURRICULUM_VERSION = 3;

// ── Track registry: merge legacy 8 + new academy tracks ─────────
function allTracks() {
  const tracks = TRACKS.map((t) => ({ ...t }));
  // ensure legacy tracks (html/css/js/react/node/python/cpp/git) are present
  const existing = new Set(tracks.map((t) => t.id));
  for (const id of ["html", "css", "js", "react", "node", "python", "cpp", "git"]) {
    if (!existing.has(id)) {
      const lang = LEGACY[id];
      if (lang) tracks.push({ id, name: lang.name, tagline: lang.tagline, levels: Object.keys(LEVEL_DEFS), emoji: "📘" });
    }
  }
  return tracks;
}

// ── Normalize a legacy lesson into the sections format ─────────
function normalizeLegacyLesson(lesson) {
  if (lesson.sections) return lesson; // already new-format
  const sections = [];
  if (lesson.theory) sections.push({ type: "explanation", title: "The idea", content: lesson.theory });
  else if (lesson.topic) sections.push({ type: "explanation", title: "The idea", content: lesson.topic });
  if (lesson.example) sections.push({ type: "example", title: "Example", code: lesson.example });
  if (lesson.quiz) {
    sections.push({
      type: "quiz",
      title: "Quick check",
      question: lesson.quiz.question,
      options: lesson.quiz.options,
      answer: lesson.quiz.answer,
      explanation: lesson.quiz.explain,
      retryExplanation: lesson.quiz.retryExplain,
    });
  }
  if (lesson.exercise) {
    sections.push({
      type: "coding_challenge",
      title: "Practice",
      prompt: lesson.exercise.prompt,
      lang: lesson.exercise.lang,
      expected: lesson.exercise.expected,
    });
  }
  if (!sections.length) sections.push({ type: "explanation", title: "Overview", content: lesson.learn || lesson.topic || "" });
  return { ...lesson, sections };
}

// ── Get a track's lessons (all levels) ──────────────────────────
function trackLessons(trackId) {
  let levels = {};
  if (ACADEMY[trackId]) {
    levels = ACADEMY[trackId].levels;
  } else if (LEGACY[trackId]) {
    levels = LEGACY[trackId].levels;
  }
  return levels;
}

// ── Resolve a lesson by track/level/index or id ─────────────────
function lessonAt(trackId, level, idxOrId) {
  const levels = trackLessons(trackId);
  const list = levels[level] || [];
  if (typeof idxOrId === "string") {
    const i = list.findIndex((l) => l.id === idxOrId);
    return i >= 0 ? { lesson: normalizeLegacyLesson(list[i]), idx: i, lessons: list } : null;
  }
  const i = Math.max(0, Math.min(parseInt(idxOrId, 10) || 0, list.length - 1));
  return { lesson: normalizeLegacyLesson(list[i]), idx: i, lessons: list };
}

// ── Track overview ──────────────────────────────────────────────
function trackOverview(trackId) {
  const tracks = allTracks();
  const t = tracks.find((x) => x.id === trackId);
  if (!t) return null;
  const levels = trackLessons(trackId);
  const total = Object.values(levels).reduce((s, arr) => s + arr.length, 0);
  return { id: t.id, name: t.name, tagline: t.tagline, emoji: t.emoji, levels: Object.keys(levels).length, totalLessons: total };
}

function allTrackOverviews() {
  return allTracks().map((t) => trackOverview(t.id)).filter(Boolean);
}

function levelLessons(trackId, level) {
  const levels = trackLessons(trackId);
  return (levels[level] || []).map(normalizeLegacyLesson);
}

module.exports = { allTracks, trackLessons, lessonAt, trackOverview, allTrackOverviews, levelLessons, CURRICULUM_VERSION, LEVEL_DEFS };
