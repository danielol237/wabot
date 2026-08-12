// ── ARIA Academy — Learner Model ─────────────────────────────────
// The persisted state of what a learner knows. Deliberately SEPARATE from
// the curriculum so the AI/adaptive logic never lives inside content.
//
// Per learner we track:
//   • attempts   — every quiz/exercise attempt (for the adaptive tutor)
//   • mastery    — per track/level %, computed from assessments
//   • skills     — skill-level confidence map (weak → strong)
//   • misconceptions — recurring wrong answers mapped to concepts
//   • xp / streak — progression gamification
//   • lastActivity

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../../data/learnerModel.json");

// XP level tiers — single source of truth (shared with xpSystem.js).
// XP is GAMIFICATION; mastery (demonstrated competence) is separate.
const LEVELS = [
  { level: 1,  xp: 0,    title: "Rookie" },
  { level: 2,  xp: 120,  title: "Apprentice" },
  { level: 3,  xp: 300,  title: "Developer" },
  { level: 4,  xp: 540,  title: "Junior Engineer" },
  { level: 5,  xp: 900,  title: "Engineer" },
  { level: 6,  xp: 1400, title: "Senior Engineer" },
  { level: 7,  xp: 2100, title: "Staff Engineer" },
  { level: 8,  xp: 3000, title: "Principal Engineer" },
  { level: 9,  xp: 4200, title: "Distinguished Engineer" },
  { level: 10, xp: 6000, title: "Architect" },
];

// Resolve the level tier for a given XP total.
function tierFor(xp) {
  let current = LEVELS[0];
  for (const t of LEVELS) if (xp >= t.xp) current = t;
  return current;
}

let model = { learners: {} };

function load() {
  try { if (fs.existsSync(FILE)) model = JSON.parse(fs.readFileSync(FILE, "utf8")) || { learners: {} }; }
  catch (_) { model = { learners: {} }; }
}
function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(model)); } catch (_) {}
}
load();

function learner(uid) {
  if (!model.learners[uid]) {
    model.learners[uid] = {
      attempts: [],       // { ts, track, level, lessonId, sectionType, correct, skill }
      mastery: {},        // { [track]: { [level]: percent } }
      skills: {},         // { [skill]: { correct, total, confidence } }
      misconceptions: {}, // { [skill]: count }
      xp: 0,
      xpLog: [],          // { ts, amt, reason } — for per-activity XP breakdown
      streak: 0,
      lastStudy: null,
    };
  }
  return model.learners[uid];
}

// Record a single assessment attempt. `skill` is an optional concept tag
// (e.g. "async", "sql-joins") so the tutor can reason about strengths/weaknesses.
function recordAttempt(uid, { track, level, lessonId, sectionType, correct, skill }) {
  const l = learner(uid);
  l.attempts.push({ ts: Date.now(), track, level, lessonId, sectionType, correct, skill });
  if (l.attempts.length > 400) l.attempts = l.attempts.slice(-400); // bound memory

  if (skill) {
    const s = l.skills[skill] || { correct: 0, total: 0, confidence: 0 };
    s.total += 1;
    if (correct) s.correct += 1;
    s.confidence = Math.round((s.correct / s.total) * 100);
    l.skills[skill] = s;
    if (!correct) l.misconceptions[skill] = (l.misconceptions[skill] || 0) + 1;
  }
  save();
}

// Mark XP (optional `reason` records where it came from, feeding the XP
// breakdown view) and update streak.
function addXp(uid, amt, reason) {
  const l = learner(uid);
  const before = tierFor(l.xp || 0).level;
  l.xp = (l.xp || 0) + amt;
  const after = tierFor(l.xp).level;
  if (reason && amt) {
    l.xpLog = l.xpLog || [];
    l.xpLog.push({ ts: Date.now(), amt, reason });
    if (l.xpLog.length > 300) l.xpLog = l.xpLog.slice(-300); // bound memory
  }
  const today = new Date().toDateString();
  if (l.lastStudy === today) { /* same day */ }
  else if (l.lastStudy) {
    const diff = Math.floor((Date.now() - new Date(l.lastStudy + "T00:00:00").getTime()) / 86400000);
    l.streak = diff <= 1 ? (l.streak || 0) + 1 : 1;
  } else l.streak = 1;
  l.lastStudy = today;
  save();
  // Level-up celebration. Return null unless the learner crossed a tier.
  if (after > before) return { leveledUp: true, before, after, title: tierFor(l.xp).title };
  return null;
}

function setMastery(uid, track, level, percent) {
  const l = learner(uid);
  l.mastery[track] = l.mastery[track] || {};
  l.mastery[track][level] = percent;
  save();
}

function getMastery(uid, track, level) {
  return learner(uid).mastery?.[track]?.[level] || 0;
}

function getStats(uid) {
  const l = learner(uid);
  return { xp: l.xp || 0, streak: l.streak || 0, attempts: l.attempts.length, xpLog: l.xpLog || [] };
}

// All learners ranked by XP (for the leaderboard). Returns display-safe rows.
function getAllLearners() {
  return Object.entries(model.learners)
    .filter(([, l]) => (l.xp || 0) > 0)
    .map(([uid, l]) => ({
      uid,
      xp: l.xp || 0,
      streak: l.streak || 0,
      attempts: l.attempts.length,
      lastActivity: l.lastStudy || null,
    }))
    .sort((a, b) => b.xp - a.xp);
}

// ── Weak/strong skills for the adaptive tutor ───────────────────
// Weak = many attempts with low confidence. Strong = high confidence.
function skillProfile(uid) {
  const l = learner(uid);
  const skills = Object.entries(l.skills).map(([name, s]) => ({ name, ...s }));
  const weak = skills
    .filter((s) => s.total >= 2 && s.confidence < 60)
    .sort((a, b) => a.confidence - b.confidence);
  const strong = skills
    .filter((s) => s.total >= 2 && s.confidence >= 80)
    .sort((a, b) => b.confidence - a.confidence);
  const misconceptions = Object.entries(l.misconceptions).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { weak, strong, misconceptions };
}

// Confidence for a single skill (0-100) or undefined if never attempted.
function skillConfidence(uid, skill) {
  const s = learner(uid).skills[skill];
  return s ? s.confidence : undefined;
}

// Mastery must reflect DEMONSTRATED competence (assessments passed), not XP.
// Separate from the gamification XP counter. A learner's level is gated by
// mastery, never by XP farming.
function computeMastery(uid, track, level) {
  // Placeholder — the orchestrator sets mastery on completion. This helper
  // recomputes a % from passed assessments if we had per-lesson assessment
  // records keyed to the track/level. Kept minimal; real gating lives in
  // setMastery + the orchestrator's level-completion path.
  return getMastery(uid, track, level);
}

module.exports = { recordAttempt, addXp, setMastery, getMastery, getStats, getAllLearners, skillProfile, skillConfidence, computeMastery, learner, LEVELS, tierFor };
