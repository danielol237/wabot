// ── ARIA Academy — Evidence Engine ──────────────────────────────
// The defensible-mastery backbone. Mastery is NEVER granted for "reaching
// the end of a lesson" — it is COMPUTED from recorded assessment evidence
// (quizzes, coding challenges, projects, recall tests). ARIA can always
// answer "why do you believe I know X?" with concrete evidence.
//
//    Evidence (recorded)  →  Skill Evidence  →  Mastery Model  →  Tutor
//    quiz pass/fail            per track+level
//    challenge pass/fail       per skill
//    project rubric score
//    recall strength
//
// Weights: harder, richer evidence counts more than easy evidence.
//   quiz        weight 1.0   (recognition)
//   challenge   weight 1.6   (production)
//   project     weight 2.6   (demonstrated build)
//   recall      weight 1.3   (retention over time)

const { learner, evidenceFor, setMastery, recordEvidence } = require("./learnerModel");

const WEIGHTS = { quiz: 1.0, challenge: 1.6, project: 2.6, recall: 1.3 };

// A level's mastery should reflect BOTH quality (how well you did) and
// breadth (did you actually work across assessments). Requiring some breadth
// stops one lucky quiz from reading as mastery.
const REQUIRED_EVIDENCE = 6; // a solid level ≈ several quizzes + challenges + a project

// Compute mastery for a track+level from recorded evidence ONLY.
//   weightedAvg = Σ(score * weight) / Σ(weight)   — per-item, quality
//   coverage    = min(1, items / REQUIRED_EVIDENCE) — breadth
//   percent     = weightedAvg * coverage
// Returns { percent, breakdown } where breakdown explains each source.
function computeEvidenceMastery(uid, track, level) {
  const ev = evidenceFor(uid, track, level);
  if (!ev.length) return { percent: 0, breakdown: [], sources: {} };

  const acc = { quiz: { ok: 0, total: 0, scoreSum: 0 }, challenge: { ok: 0, total: 0, scoreSum: 0 }, project: { ok: 0, total: 0, scoreSum: 0 }, recall: { ok: 0, total: 0, scoreSum: 0 } };
  let num = 0, den = 0;

  for (const e of ev) {
    const t = acc[e.type];
    if (!t) continue;
    t.total += 1;
    if (e.score != null) t.scoreSum += e.score;
    else if (e.correct != null) t.scoreSum += e.correct ? 100 : 0;
    if (e.correct) t.ok += 1;
    // Per-item weighted sum (this is the quality signal).
    const w = WEIGHTS[e.type] || 1;
    const score = e.score != null ? e.score : e.correct ? 100 : 0;
    num += score * w;
    den += w;
  }

  const weightedAvg = den ? num / den : 0;
  const coverage = Math.min(1, ev.length / REQUIRED_EVIDENCE);
  const percent = Math.round(weightedAvg * coverage);

  const breakdown = [];
  for (const type of ["quiz", "challenge", "project", "recall"]) {
    const t = acc[type];
    if (!t.total) continue;
    const componentScore = t.total ? t.scoreSum / t.total : 0;
    breakdown.push({ type, ok: t.ok, total: t.total, score: Math.round(componentScore), weight: WEIGHTS[type] });
  }
  return { percent, breakdown, sources: acc, coverage: Math.round(coverage * 100) };
}

// Record a graded project as evidence (score 0-100, type "project").
function recordEvidenceProject(uid, { track, level, score, skill, detail }) {
  recordEvidence(uid, { track, level, type: "project", correct: score >= 75, score, skill, detail });
}

// Recompute AND persist mastery for a track+level from evidence.
function recomputeMastery(uid, track, level) {
  const { percent } = computeEvidenceMastery(uid, track, level);
  setMastery(uid, track, level, percent);
  return percent;
}

// A learner "passed" a level only when their evidence-derived mastery meets
// the threshold (same one the adaptive tutor uses).
function isEvidenceMastered(uid, track, level, threshold = 80) {
  const { percent } = computeEvidenceMastery(uid, track, level);
  return percent >= threshold;
}

// ── Evidence report — "why does ARIA believe you know X?" ──────
function evidenceReport(uid, track, level) {
  const { percent, breakdown } = computeEvidenceMastery(uid, track, level);
  const ev = evidenceFor(uid, track, level).slice(0, 20);
  const lines = [];
  lines.push(`🧠 *Evidence-backed mastery — ${track} ${level}*`);
  lines.push(`\n*Mastery:* ${percent}% ${percent >= 80 ? "✅" : percent >= 50 ? "🟡" : "🔴"}`);
  if (!breakdown.length) {
    lines.push(`\n_No assessment evidence yet. Passing quizzes, challenges, projects and recall tests builds this._`);
    return lines.join("\n");
  }
  lines.push(`\n*By source:*`);
  for (const b of breakdown) {
    lines.push(`• ${b.type}: ${b.ok}/${b.total} passed · avg ${b.score}/100 · weight ${b.weight}`);
  }
  if (ev.length) {
    lines.push(`\n*Recent evidence:*`);
    for (const e of ev.slice(0, 8)) {
      const when = new Date(e.ts).toLocaleDateString();
      const res = e.score != null ? `${e.score}/100` : e.correct ? "pass" : "fail";
      lines.push(`• [${when}] ${e.type}: ${res}${e.skill ? ` (${e.skill})` : ""}${e.detail ? ` — ${e.detail}` : ""}`);
    }
  }
  lines.push(`\n_Reaching the end of a lesson is NOT mastery. This is computed from demonstrated assessments only._`);
  return lines.join("\n");
}

// Per-skill mastery from evidence (for DNA / skill graph).
function skillEvidence(uid, skill) {
  const ev = (learner(uid).evidence || []).filter((e) => e.skill === skill);
  if (!ev.length) return null;
  let num = 0, den = 0;
  for (const e of ev) {
    const w = WEIGHTS[e.type] || 1;
    const score = e.score != null ? e.score : e.correct ? 100 : 0;
    num += score * w;
    den += w;
  }
  return { skill, mastery: Math.round(num / den), evidence: ev.length };
}

module.exports = { computeEvidenceMastery, recomputeMastery, isEvidenceMastered, evidenceReport, skillEvidence, recordEvidenceProject, WEIGHTS };
