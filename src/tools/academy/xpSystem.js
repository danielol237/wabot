// ── ARIA Academy — XP Polish & Leaderboard ──────────────────────
// XP is the GAMIFICATION layer (mastery = demonstrated competence, XP =
// progression fun). This module adds:
//   • Level tiers + titles + progress-to-next-level (for !level / !xp)
//   • Per-activity XP breakdown (where your points came from)
//   • Global leaderboard (!leaderboard / !lb) ranked by XP

const { getStats, getAllLearners, learner } = require("./learnerModel");

// Level tiers: cumulative XP to reach each rank. Derived from the curve
// level(xp) = floor(sqrt(xp/120)) + 1, but expressed as named tiers so the
// progress bar reads nicely.
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

// Deterministic avatar emoji per rank (stable, no collision issues).
const RANK_EMOJI = ["🥚", "🌱", "⚙️", "🧩", "🛠️", "🚀", "🏗️", "👑", "💎", "🌟"];

// Resolve the level tier for a given XP total.
function tierFor(xp) {
  let current = LEVELS[0];
  for (const t of LEVELS) if (xp >= t.xp) current = t;
  return current;
}

function nextTierFor(xp) {
  return LEVELS.find((t) => t.xp > xp) || null;
}

// Progress (0-100) within the current tier.
function progressToNext(xp) {
  const cur = tierFor(xp);
  const next = nextTierFor(xp);
  if (!next) return { pct: 100, into: xp - cur.xp, total: 1 };
  const into = xp - cur.xp;
  const span = next.xp - cur.xp;
  return { pct: Math.min(100, Math.round((into / span) * 100)), into, total: span };
}

// Per-activity XP breakdown from the xpLog.
function xpBreakdown(uid) {
  const log = getStats(uid).xpLog || [];
  const map = {};
  for (const e of log) map[e.reason || "other"] = (map[e.reason || "other"] || 0) + e.amt;
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

// Personal XP / level view.
function xpView(uid) {
  const { xp, streak, attempts } = getStats(uid);
  const tier = tierFor(xp);
  const next = nextTierFor(xp);
  const prog = progressToNext(xp);
  const emoji = RANK_EMOJI[tier.level - 1] || "🌟";
  const bar = "▰".repeat(Math.round(prog.pct / 10)) + "▱".repeat(10 - Math.round(prog.pct / 10));
  const breakdown = xpBreakdown(uid);
  const lines = [];
  lines.push(`${emoji} *Level ${tier.level} — ${tier.title}*`);
  lines.push(`\n*XP:* ${xp} · *Streak:* ${streak}d · *Attempts:* ${attempts}`);
  if (next) {
    lines.push(`\n*Next:* ${next.title} (${next.xp - xp} XP away)`);
    lines.push(`${bar} ${prog.pct}% to next level`);
  } else {
    lines.push(`\n${bar} Max level reached. Legend. 🏆`);
  }
  if (breakdown.length) {
    lines.push(`\n*Where your XP came from:*`);
    for (const [reason, amt] of breakdown.slice(0, 8)) lines.push(`• ${reason}: +${amt}`);
  }
  lines.push(`\n_Mastery (real competence) is separate from XP._`);
  return lines.join("\n");
}

// Global leaderboard. `scope` = "global" (all) or a uid list for a chat.
function leaderboardView(scopeUids, selfUid) {
  const rows = getAllLearners();
  const visible = scopeUids && scopeUids.length
    ? rows.filter((r) => scopeUids.includes(r.uid))
    : rows;
  const top = visible.slice(0, 10);
  const lines = ["🏆 *Academy Leaderboard*"];
  if (!top.length) {
    lines.push("\nNo ranked learners yet. Do some work and grab the top spot. 😏");
    return lines.join("\n");
  }
  top.forEach((r, i) => {
    const tier = tierFor(r.xp);
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    const name = r.uid === selfUid ? "*you*" : r.uid.split("@")[0];
    lines.push(`${medal} ${name} — Lv${tier.level} ${tier.title} · ${r.xp} XP ${r.streak > 0 ? `· ${r.streak}d 🔥` : ""}`);
  });
  // Your rank if outside top 10
  const myIndex = visible.findIndex((r) => r.uid === selfUid);
  if (myIndex >= 10) {
    const r = visible[myIndex];
    lines.push(`\n... *you* are #${myIndex + 1} (${r.xp} XP)`);
  }
  lines.push(`\n_Earn XP from lessons, challenges, incidents, duels, reviews & the company._`);
  return lines.join("\n");
}

module.exports = { LEVELS, tierFor, xpView, leaderboardView, xpBreakdown };
