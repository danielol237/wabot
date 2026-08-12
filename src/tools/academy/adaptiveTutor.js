// ── ARIA Academy — Adaptive Tutor ────────────────────────────────
// Decides the NEXT activity for a learner based on their Learner Model.
// Kept fully separate from the curriculum so the AI logic can evolve without
// touching content.
//
// Strategy:
//   1. If the learner has weak skills with misconceptions → recommend a
//      drill/review lesson targeting that skill.
//   2. Otherwise continue the current track/level progression.
//   3. If a track level is mastered (>= threshold) → recommend advancing.

const { skillProfile } = require("./learnerModel");

// Suggest an action given a learner's id and current context.
// Returns a recommendation object the study UI can render.
function recommend(uid, { currentTrack, currentLevel } = {}) {
  const { weak, misconceptions } = skillProfile(uid);

  // 1. Weakness drill takes priority.
  if (weak.length >= 2 && misconceptions.length) {
    const top = weak[0];
    return {
      type: "drill",
      reason: `You've missed questions on "${top.name}" ${top.confidence}% of the time. Let's drill it.`,
      skill: top.name,
    };
  }

  // 2. Otherwise keep progressing the current path.
  if (currentTrack && currentLevel) {
    return {
      type: "continue",
      track: currentTrack,
      level: currentLevel,
      reason: "Keep building momentum — continue your current track.",
    };
  }

  // 3. No data yet.
  return { type: "start", reason: "New here? Let's pick a track and get you going." };
}

module.exports = { recommend };
