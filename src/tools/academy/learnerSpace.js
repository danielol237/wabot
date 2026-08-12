// ── Learner Space Engine ────────────────────────────────────────
// Turns raw academy learner data into ARIA's personal, living understanding
// of each student — her "spot" for them. This is the brains behind the Learner
// Space panel: it interprets progress, finds strengths/weak spots, infers
// learning style, tracks engagement, and generates personalized next steps +
// encouragement. It's the layer that makes ARIA feel like a companion who
// knows the student, not a stat readout.

const lm = require("./learnerModel");
const fe = require("./forgettingEngine");
const ce = require("./curriculumEngine");

const STRENGTH = 75;      // confidence >= this = strong
const WEAK = 45;          // confidence <= this (with attempts) = weak

// Infer the learner's pace from attempts/timestamps. Fast = many attempts,
// steady, consistent; Slow = few attempts spread out.
function inferPace(profile, attempts) {
  if (!attempts.length) return { label: "New", detail: "Still getting to know their rhythm." };
  const first = attempts[0].ts, last = attempts[attempts.length - 1].ts;
  const spanDays = Math.max(1, (last - first) / 86400000);
  const perDay = attempts.length / spanDays;
  if (perDay >= 4) return { label: "Fast", detail: `${attempts.length} attempts in ${Math.round(spanDays)}d — rapid, high volume.` };
  if (perDay >= 1.5) return { label: "Steady", detail: `${attempts.length} attempts in ${Math.round(spanDays)}d — consistent.` };
  return { label: "Gentle", detail: `${attempts.length} attempts in ${Math.round(spanDays)}d — prefers smaller sessions.` };
}

// Best time-of-day from attempt timestamps.
function inferBestTime(attempts) {
  if (!attempts.length) return null;
  const hours = attempts.map((a) => new Date(a.ts).getHours());
  const buckets = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
  for (const h of hours) {
    if (h >= 5 && h < 12) buckets.Morning++;
    else if (h >= 12 && h < 17) buckets.Afternoon++;
    else if (h >= 17 && h < 21) buckets.Evening++;
    else buckets.Night++;
  }
  const best = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? { time: best[0], share: Math.round((best[1] / hours.length) * 100) } : null;
}

// Skill classification: strong / improving / needs-focus / new.
// skillProfile returns { weak, strong, misconceptions }; we also read the raw
// per-skill confidence map to build the improving category.
function skillBreakdown(uid) {
  const sp = lm.skillProfile(uid) || {};
  const raw = lm.learner(uid).skills || {};
  const strong = (sp.strong || []).map((s) => ({ skill: s.name, confidence: s.confidence }));
  const focus = (sp.weak || []).map((s) => ({ skill: s.name, confidence: s.confidence, attempts: s.total }));
  // improving = at least 2 attempts, not strong, not weak.
  const improving = Object.entries(raw)
    .filter(([, s]) => s && s.total >= 2 && s.confidence >= WEAK && s.confidence < STRENGTH)
    .map(([skill, s]) => ({ skill, confidence: s.confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  return { strong: strong.slice(0, 5), focus: focus.slice(0, 5), improving };
}

// ARIA's running observations in first-person chat voice.
function ariaInsights(uid) {
  const rec = lm.learner(uid);
  const attempts = rec.attempts || [];
  const skills = lm.skillProfile(uid) || {};
  const insights = [];

  if (!attempts.length) {
    insights.push({ tag: "hello", text: "This is your spot. Start your first lesson and I'll start learning how you think." });
    return insights;
  }

  const pace = inferPace(rec.profile, attempts);
  insights.push({ tag: "pace", text: `You move at a ${pace.label.toLowerCase()} pace — ${pace.detail}` });

  const bestTime = inferBestTime(attempts);
  if (bestTime) insights.push({ tag: "rhythm", text: `You're most active in the ${bestTime.time.toLowerCase()} (${bestTime.share}% of sessions). I'll keep that in mind.` });

  // Strengths / weak spots via the corrected skill breakdown.
  const breakdown = skillBreakdown(uid);
  const strongNames = breakdown.strong.map((s) => s.skill);
  if (strongNames.length) insights.push({ tag: "strength", text: `You're strong in: ${strongNames.slice(0, 3).join(", ")}.` });
  const weakNames = breakdown.focus.map((s) => s.skill);
  if (weakNames.length) insights.push({ tag: "focus", text: `${weakNames.slice(0, 3).join(", ")} seem to trip you up. Want me to drill those together?` });

  // Streak
  if (rec.streak >= 2) insights.push({ tag: "streak", text: `${rec.streak}-day streak — you're showing up. That counts.` });

  // Inactivity nudge
  if (rec.lastStudy) {
    const daysAgo = Math.floor((Date.now() - rec.lastStudy) / 86400000);
    if (daysAgo >= 3 && daysAgo <= 14) insights.push({ tag: "nudge", text: `It's been ${daysAgo} days — want to pick up where you left off? No pressure.` });
  }

  return insights;
}

// Personalized next-step recommendation based on mastery + recall.
function recommendNext(uid) {
  const rec = lm.learner(uid);
  const attempts = rec.attempts || [];
  if (!attempts.length) {
    return { text: "Start with any track in *!academy* — I'll adapt to you from your first attempt.", resume: null };
  }
  // Most recent track/level the learner was on.
  const last = attempts[attempts.length - 1];
  // Skill due for review (rusting) — most due first.
  let dueSkill = null;
  try { dueSkill = fe.nextRecallSkill(uid); } catch (_) {}
  if (dueSkill) {
    return { text: `**${dueSkill}** is starting to rust — a quick review will keep it solid. Reply *!recall* to re-drill it.`, resume: null };
  }
  return {
    text: `Continue *${last.track || "your path"}* at the *${last.level || "beginner"}* level — you were making progress there. Reply *!academy* to pick back up.`,
    resume: { track: last.track, level: last.level },
  };
}

// Engagement / motivation summary.
function engagement(uid) {
  const rec = lm.learner(uid);
  const attempts = rec.attempts || [];
  const recent = attempts.filter((a) => a.ts > Date.now() - 7 * 86400000).length;
  return {
    streak: rec.streak || 0,
    totalSessions: attempts.length,
    last7Days: recent,
    lastStudy: rec.lastStudy,
    bestTime: inferBestTime(attempts),
  };
}

// ── Main entry: build the full Learner Space for a uid ─────────
function buildLearnerSpace(uid) {
  const stats = lm.getStats(uid);
  const profile = lm.getProfile(uid);
  const attempts = lm.learner(uid).attempts || [];
  const skills = skillBreakdown(uid);
  const space = {
    uid,
    identity: {
      name: profile.name || null,
      nickname: profile.nickname || null,
      xp: stats.xp,
      streak: stats.streak,
      tier: stats.xp >= 1000 ? "pro" : stats.xp >= 300 ? "advanced" : stats.xp >= 50 ? "intermediate" : "beginner",
    },
    goals: profile.goals || [],
    style: profile.style || null,
    ariaNotes: (profile.ariaNotes || []).slice(-8).reverse(),
    pace: inferPace(profile, attempts),
    bestTime: inferBestTime(attempts),
    skills,
    insights: ariaInsights(uid),
    next: recommendNext(uid),
    engagement: engagement(uid),
    recency: attempts.length ? Math.max(0, Math.floor((Date.now() - (attempts[attempts.length - 1].ts || Date.now())) / 86400000)) : null,
  };
  return space;
}

module.exports = { buildLearnerSpace, inferPace, inferBestTime, skillBreakdown, ariaInsights, recommendNext, engagement };
