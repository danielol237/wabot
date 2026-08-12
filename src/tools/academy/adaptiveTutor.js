// ── ARIA Academy — Adaptive Tutor ────────────────────────────────
// Decides the NEXT activity for a learner. Uses the Skill Graph for
// prerequisite diagnosis instead of just "you're weak at X → drill X."
//
// Strategy:
//   1. Weak skill with a missing prerequisite → recommend drilling the ROOT
//      prerequisite (diagnosed via the skill graph), not the surface skill.
//   2. Weak skill with no deeper prerequisite → drill that skill directly.
//   3. No weak skills → continue current path, or start.
//   4. A level is masterable (path complete) → recommend the next level.

const { skillProfile, skillConfidence, getMastery } = require("./learnerModel");
const { diagnose, hasSkill } = require("./skillGraph");

// Mastery threshold required to consider a level "passed" — driven by
// demonstrated competence, never by XP.
const MASTERY_THRESHOLD = 80;

// Suggest an action given a learner and current context.
// Returns a recommendation object the study UI can render.
function recommend(uid, { currentTrack, currentLevel, currentSkill } = {}) {
  const { weak, strong, misconceptions } = skillProfile(uid);

  // 1. Prerequisite diagnosis on the most relevant weak skill.
  //    Prefer the skill tied to the learner's current context, else the weakest.
  let targetSkill = weak[0]?.name;
  if (currentSkill && skillConfidence(uid, currentSkill) !== undefined && skillConfidence(uid, currentSkill) < 60) {
    targetSkill = currentSkill;
  }

  if (targetSkill && hasSkill(targetSkill)) {
    const d = diagnose(uid, targetSkill);
    const root = d.root;
    // If the root is a real prerequisite (different from the weak skill) and
    // under-confident, that's what to drill.
    if (root && root.skill !== targetSkill && (root.confidence ?? 0) < 60) {
      return {
        type: "prerequisite",
        reason: `You're struggling with *${targetSkill}*, but your real gap is *${root.skill}* (${root.confidence ?? "unassessed"}% confidence). Let's lock that in first.`,
        skill: root.skill,
        drillTarget: targetSkill,
        chain: d.chain.map((c) => c.skill),
      };
    }
    if (weak.includes(targetSkill) || (root && root.skill === targetSkill)) {
      return {
        type: "drill",
        reason: `Let's drill *${targetSkill}* — you're at ${root.confidence ?? 0}% confidence.`,
        skill: targetSkill,
      };
    }
  }

  // 2. No strong prerequisite signal → drill the weakest weak skill directly.
  if (weak.length) {
    const w = weak[0];
    return { type: "drill", reason: `Let's strengthen *${w.name}* (${w.confidence}%).`, skill: w.name };
  }

  // 3. Otherwise continue progression, or advance a mastered level.
  if (currentTrack && currentLevel) {
    return {
      type: "continue",
      track: currentTrack,
      level: currentLevel,
      reason: "You're doing well — keep building momentum on your current track.",
    };
  }

  // 4. New learner.
  return { type: "start", reason: "New here? Let's pick a track and get you going." };
}

// Is a level passed based on mastery (competence), not XP?
function isLevelPassed(uid, track, level) {
  return getMastery(uid, track, level) >= MASTERY_THRESHOLD;
}

module.exports = { recommend, isLevelPassed, MASTERY_THRESHOLD };
