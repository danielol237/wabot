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

// Mark XP and update streak.
function addXp(uid, amt) {
  const l = learner(uid);
  l.xp = (l.xp || 0) + amt;
  const today = new Date().toDateString();
  if (l.lastStudy === today) { /* same day */ }
  else if (l.lastStudy) {
    const diff = Math.floor((Date.now() - new Date(l.lastStudy + "T00:00:00").getTime()) / 86400000);
    l.streak = diff <= 1 ? (l.streak || 0) + 1 : 1;
  } else l.streak = 1;
  l.lastStudy = today;
  save();
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
  return { xp: l.xp || 0, streak: l.streak || 0, attempts: l.attempts.length };
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

module.exports = { recordAttempt, addXp, setMastery, getMastery, getStats, skillProfile, learner };
