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
      evidence: [],       // { ts, track, level, type, correct, score, skill, detail }
      mastery: {},        // { [track]: { [level]: percent } }  ← computed, not hand-set
      skills: {},         // { [skill]: { correct, total, confidence } }
      misconceptions: {}, // { [skill]: count }
      xp: 0,
      xpLog: [],          // { ts, amt, reason } — for per-activity XP breakdown
      streak: 0,
      lastStudy: null,
      profile: {},        // personalization: { name, nickname, goals[], style, bestTime, arriaNotes[] }
    };
  }
  return model.learners[uid];
}

// ── Learner Space personalization ─────────────────────────────
// Each learner's "spot": ARIA's structured understanding of who they are,
// how they learn, and her running observations. This is the data behind the
// Learner Space panel and ARIA's personalised encouragement.
function getProfile(uid) {
  return learner(uid).profile || {};
}

function updateProfile(uid, patch) {
  const l = learner(uid);
  l.profile = { ...(l.profile || {}), ...(patch || {}) };
  save();
  return l.profile;
}

// Append an ARIA observation (kept to the last N for a manageable record).
function addAriaNote(uid, text, tag = "insight") {
  const l = learner(uid);
  l.profile = l.profile || {};
  l.profile.ariaNotes = l.profile.ariaNotes || [];
  l.profile.ariaNotes.push({ ts: Date.now(), tag, text });
  if (l.profile.ariaNotes.length > 30) l.profile.ariaNotes = l.profile.ariaNotes.slice(-30);
  save();
}

// Record a single assessment attempt. `skill` is an optional concept tag
// (e.g. "async", "sql-joins") so the tutor can reason about strengths/weaknesses.
function recordAttempt(uid, { track, level, lessonId, sectionType, correct, skill }) {
  const l = learner(uid);
  const wasFirst = l.attempts.length === 0;
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
  // ── Auto-generate ARIA's notes as the learner grows ─────────
  // Lightweight, data-driven observations captured at meaningful moments so the
  // Learner Space "notes" feel like ARIA has been paying attention.
  l.profile = l.profile || {};
  l.profile.ariaNotes = l.profile.ariaNotes || [];
  if (wasFirst) {
    l.profile.ariaNotes.push({ ts: Date.now(), tag: "first", text: `${track || ""} ${level || ""} — the first step. I'm watching their path now.` });
  }
  if (skill && l.skills[skill]) {
    const conf = l.skills[skill].confidence;
    if (conf >= 80 && l.skills[skill].total >= 2) {
      l.profile.ariaNotes.push({ ts: Date.now(), tag: "strength", text: `${skill} clicked — they're confident in it (${conf}%).` });
    } else if (conf <= 40 && l.skills[skill].total >= 2) {
      l.profile.ariaNotes.push({ ts: Date.now(), tag: "focus", text: `${skill} is a consistent struggle (${conf}%). Worth drilling together.` });
    }
  }
  if (l.profile.ariaNotes.length > 40) l.profile.ariaNotes = l.profile.ariaNotes.slice(-40);
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

// Record a piece of assessment evidence (quiz/challenge/project/recall).
// `type` ∈ "quiz" | "challenge" | "project" | "recall". `correct` is a bool
// (or null for scored-only evidence); `score` is 0-100 when available.
// This is the raw input the Evidence Engine uses to compute defensible mastery.
function recordEvidence(uid, { track, level, type, correct, score, skill, detail }) {
  const l = learner(uid);
  l.evidence = l.evidence || [];
  l.evidence.push({ ts: Date.now(), track, level, type, correct, score, skill, detail });
  if (l.evidence.length > 600) l.evidence = l.evidence.slice(-600);
  save();
}

// setMastery is now only a low-level setter used by the Evidence Engine after
// computing mastery from evidence. Direct callers must go through the engine
// so mastery is always defensible.
function setMastery(uid, track, level, percent) {
  const l = learner(uid);
  l.mastery[track] = l.mastery[track] || {};
  l.mastery[track][level] = Math.max(0, Math.min(100, Math.round(percent)));
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

// Evidence for a given track+level, most recent first.
function evidenceFor(uid, track, level) {
  return (learner(uid).evidence || [])
    .filter((e) => e.track === track && (!level || e.level === level))
    .slice()
    .reverse();
}

// Mastery must reflect DEMONSTRATED competence (assessments passed), not XP.
// The Evidence Engine computes this; this thin helper just returns the last
// computed value. It does NOT grant mastery — reaching the end of a lesson is
// never evidence on its own.
function computeMastery(uid, track, level) {
  return getMastery(uid, track, level);
}

module.exports = { recordAttempt, recordEvidence, addXp, setMastery, getMastery, evidenceFor, getStats, getAllLearners, skillProfile, skillConfidence, computeMastery, learner, getProfile, updateProfile, addAriaNote, LEVELS, tierFor };
