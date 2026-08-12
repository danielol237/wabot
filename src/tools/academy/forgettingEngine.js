// ── ARIA Academy — Forgetting / Recall Engine ───────────────────
// Spaced-repetition scheduling over the learner's real attempts. If you
// learned something and haven't touched it, it decays and becomes "due for
// recall" before you actually forget it. This keeps mastery honest — knowing
// something once isn't the same as still knowing it.
//
// Model (Ebbinghaus-flavored):
//   • Each skill has a memory strength based on how many times you got it
//     right and how confident you are.
//   • Strength decays over time (forgetting curve).
//   • A skill is "due for recall" when its decayed strength falls below a
//     threshold — at that point the tutor should re-drill it.
//
// Decay parameters:
//   STRONG decay slower (retained), WEAK decay faster (more fragile).

const { learner } = require("./learnerModel");

// Half-life in days per confidence band. Higher confidence = longer memory.
function halfLifeDays(confidence) {
  if (confidence >= 90) return 21;   // solid, ~3 weeks
  if (confidence >= 70) return 10;   // decent, ~10 days
  if (confidence >= 50) return 4;    // shaky, ~4 days
  return 2;                          // weak, forgets in ~2 days
}

// Exponential forgetting: strength * 0.5 ^ (days / halfLife)
function decayedStrength(skill, now = Date.now()) {
  const days = (now - skill.lastAt) / 86400000;
  return skill.confidence * Math.pow(0.5, days / halfLifeDays(skill.confidence));
}

// Per-skill summary from the learner's attempt history.
function skillMemory(uid) {
  const l = learner(uid);
  const map = {};
  for (const a of l.attempts) {
    if (!a.skill) continue;
    const key = a.skill;
    if (!map[key]) map[key] = { skill: key, correct: 0, total: 0, lastAt: 0, lastResult: null };
    map[key].total += 1;
    if (a.correct) map[key].correct += 1;
    if (a.ts > map[key].lastAt) { map[key].lastAt = a.ts; map[key].lastResult = a.correct; }
  }
  for (const key of Object.keys(map)) {
    map[key].confidence = Math.round((map[key].correct / map[key].total) * 100);
    map[key].strength = decayedStrength(map[key]);
    // "Due" = a skill that was GENUINELY known (conf >= RECALL_MIN_CONF) but
    // has since decayed below the recall threshold. A never-mastered skill
    // (low confidence) is WEAK, not RUSTY — that's the weak-skill branch's job.
    map[key].due = map[key].confidence >= RECALL_MIN_CONF && map[key].strength < RECALL_THRESHOLD;
    map[key].daysSince = Math.floor((Date.now() - map[key].lastAt) / 86400000);
  }
  return Object.values(map);
}

// Skills due for recall, sorted by urgency (weakest decayed strength first).
function dueForRecall(uid, limit = 5) {
  return skillMemory(uid)
    .filter((s) => s.due)
    .sort((a, b) => a.strength - b.strength)
    .slice(0, limit);
}

// Healthy skills (not due) — for the roadmap / confidence view.
function healthySkills(uid) {
  return skillMemory(uid)
    .filter((s) => !s.due)
    .sort((a, b) => b.strength - a.strength);
}

// A skill only "rusts" if it was once genuinely known. Weak skills (below
// this) are never-mastered, not decaying — handled by the weak-skill branch.
const RECALL_MIN_CONF = 60;
const RECALL_THRESHOLD = 40;
module.exports.RECALL_MIN_CONF = RECALL_MIN_CONF;
module.exports.RECALL_THRESHOLD = RECALL_THRESHOLD;

// Overall recall health: % of known skills currently above the recall threshold.
function recallHealth(uid) {
  const mem = skillMemory(uid);
  if (!mem.length) return { health: 100, due: 0, total: 0 };
  const due = mem.filter((s) => s.due).length;
  return { health: Math.round(((mem.length - due) / mem.length) * 100), due, total: mem.length };
}

// Format the recall report for chat.
function recallReport(uid) {
  const h = recallHealth(uid);
  const due = dueForRecall(uid, 5);
  const healthy = healthySkills(uid).slice(0, 5);
  const lines = [];
  lines.push(`🧠 *Recall Engine*`);
  lines.push(`\n*Recall health:* ${h.health}% (${h.due}/${h.total} skills due)`);
  if (due.length) {
    lines.push(`\n*Due for review (rusty):*`);
    for (const s of due) {
      const strength = Math.max(0, Math.round(s.strength));
      lines.push(`• ${s.skill} — ${strength}/100 strength · last seen ${s.daysSince}d ago · confidence ${s.confidence}%`);
    }
    lines.push(`\nRe-drill these with !academy or tell me the topic and I'll quiz you.`);
  } else if (h.total) {
    lines.push(`\nNothing rusting yet. Keep the streak alive. 🔥`);
  } else {
    lines.push(`\nNo skills recorded yet. Start with !academy to build your knowledge graph.`);
  }
  if (healthy.length) {
    lines.push(`\n*Solid (not due):*`);
    for (const s of healthy.slice(0, 3)) lines.push(`• ${s.skill} — ${Math.round(s.strength)}/100 strength`);
  }
  return lines.join("\n");
}

// Which single skill is MOST due — the adaptive tutor can auto-drill it.
function nextRecallSkill(uid) {
  const due = dueForRecall(uid, 1);
  return due.length ? due[0].skill : null;
}

module.exports = { skillMemory, dueForRecall, healthySkills, recallHealth, recallReport, nextRecallSkill, halfLifeDays };
