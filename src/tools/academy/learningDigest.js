// ── Learning Digest ────────────────────────────────────────────
// Builds a concise weekly learning summary for a learner from the academy
// learner model: XP gained, attempts, mastery across tracks, and what's
// decaying (due for review). Used by !digest.

const { getStats, learner, getAllLearners, evidenceFor, getMastery } = require("./learnerModel");
const { LEVELS, tierFor } = require("./xpSystem");
const { lessonAt, allTrackOverviews } = require("./curriculumEngine");
const { dueForRecall } = require("./forgettingEngine");

function buildDigest(uid, { days = 7 } = {}) {
  const stats = getStats(uid);
  const profile = learner(uid);
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  // Recent attempts within the window.
  const recent = (profile.attempts || []).filter((a) => a && a.ts && a.ts >= cutoff);
  const totalRecent = recent.length;
  const correctRecent = recent.filter((a) => a.correct).length;

  // XP: current vs 7 days ago (approx — track the daily log if present).
  const xpNow = stats.xp || 0;
  const recentXp = (profile.xpLog || []).filter((x) => x && x.ts >= cutoff).reduce((s, x) => s + (x.amount || 0), 0);

  // Per-track mastery snapshot (best of mastered levels).
  const tracks = allTrackOverviews() || [];
  const masteryRows = [];
  for (const t of tracks.slice(0, 8)) {
    let best = 0;
    for (const lvl of Object.keys(LEVELS || {})) {
      const m = getMastery(uid, t.id, lvl) || 0;
      if (m > best) best = m;
    }
    if (best > 0) masteryRows.push({ track: t.name, emoji: t.emoji, mastery: best });
  }
  masteryRows.sort((a, b) => b.mastery - a.mastery);

  // Skills due for review (rusting). dueForRecall returns { skill, strength, daysSince, confidence }.
  const decaying = [];
  try {
    const due = dueForRecall(uid, 10) || [];
    for (const d of due) {
      if (d && d.confidence < 80) {
        decaying.push({ skill: d.skill, dueInDays: d.daysSince || 0, confidence: d.confidence || 0 });
      }
    }
  } catch (_) {}
  decaying.sort((a, b) => b.dueInDays - a.dueInDays);
  decaying.splice(0, 5);

  const acc = totalRecent ? Math.round((correctRecent / totalRecent) * 100) : null;
  const next = tierFor(xpNow); // next tier threshold above current XP, or null at cap

  return {
    uid,
    days,
    xpNow,
    recentXp,
    totalRecent,
    correctRecent,
    accuracy: acc,
    nextTier: next ? next.name : null,
    toNextTier: next ? Math.max(0, next.xp - xpNow) : 0,
    masteryRows,
    decaying,
  };
}

function digestView(d, selfUid) {
  const head = d.uid === selfUid ? "📚 *Your weekly learning digest*" : `📚 *Learning digest*`;
  const rows = [
    head,
    "",
    `▸ XP: *${d.xpNow}*${d.nextTier ? ` — ${d.toNextTier} XP to *${d.nextTier}*` : " — max tier"}`,
    `▸ This week: +${d.recentXp} XP · ${d.totalRecent} attempt${d.totalRecent === 1 ? "" : "s"} (${d.accuracy == null ? "—" : d.accuracy + "% accurate"})`,
  ];

  if (d.masteryRows.length) {
    rows.push("", `▸ *Top mastery*`);
    for (const m of d.masteryRows.slice(0, 4)) rows.push(`   ${m.emoji} ${m.track} — ${m.mastery}%`);
  }

  if (d.decaying.length) {
    rows.push("", `▸ *Due for review* (decaying)`);
    for (const s of d.decaying) rows.push(`   ⏳ ${s.skill} — due in ${s.dueInDays}d (${s.confidence}%)`);
    rows.push("", `Use *!recall* to review what's due.`);
  } else {
    rows.push("", `▸ Nothing decaying. Nice. 🎯`);
  }

  if (d.totalRecent === 0) {
    rows.push("", `_No activity this week — start with *!academy*._`);
  }
  return rows.join("\n");
}

module.exports = { buildDigest, digestView };
