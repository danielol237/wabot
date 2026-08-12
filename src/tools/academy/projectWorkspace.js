// ── ARIA Academy — Project / Capstone Workspace ──────────────────
// Tracks-level projects that produce demonstrated competence, not just XP.
// A project is NOT completed by typing "done" — the learner must SUBMIT
// their work, ARIA grades it against the acceptance criteria (rubric), and
// the resulting score is recorded as EVIDENCE. Mastery then derives from
// that evidence via the Evidence Engine — never from saying you finished.
//
// Flow: !project <track> <level>  →  view objective + criteria
//       !project submit <work>    →  ARIA grades against rubric → evidence
//
// Grading: AI semantic rubric evaluation when the provider is available,
// with a deterministic keyword-based fallback as a guardrail. Either way
// the result is a defensible 0-100 rubric score, not a free pass.

const fs = require("fs");
const path = require("path");
const { getAIResponse } = require("../ai");
const { addXp, setMastery } = require("./learnerModel");
const { recomputeMastery, recordEvidenceProject } = require("./evidenceEngine");
const { levelUpText } = require("./xpSystem");

const FILE = path.join(__dirname, "../../../data/academyProjects.json");
let state = { users: {} };

function load() {
  try { if (fs.existsSync(FILE)) state = JSON.parse(fs.readFileSync(FILE, "utf8")) || { users: {} }; }
  catch (_) { state = { users: {} }; }
}
function save() { try { fs.writeFileSync(FILE, JSON.stringify(state)); } catch (_) {} }
load();

// Project definitions per track+level. Each project:
//   { id, title, objective, criteria: [..], skill }
const PROJECTS = {
  backend: {
    intermediate: [
      {
        id: "backend-rest-api",
        title: "Build a production REST API",
        objective: "Build a REST API with authentication, a database, and tests.",
        criteria: [
          "Has register/login with hashed passwords (bcrypt/argon2)",
          "Uses a database (Postgres/SQLite) with proper schema",
          "Protects private routes with auth middleware",
          "Has at least 5 unit/integration tests that pass",
          "Returns proper status codes and JSON shapes",
        ],
        skill: "auth",
      },
    ],
    advanced: [
      {
        id: "backend-queue-worker",
        title: "Queue + worker pipeline",
        objective: "Build an async job pipeline with a queue, workers, and retries.",
        criteria: [
          "A producer enqueues jobs",
          "Workers process jobs with idempotency + exponential backoff",
          "Failures are retried and dead-lettered",
          "Observable via logs/metrics",
        ],
        skill: "concurrency",
      },
    ],
  },
  sysdesign: {
    pro: [
      {
        id: "sysdesign-whatsapp",
        title: "Design a WhatsApp-scale messaging system",
        objective: "Architect a real-time messaging platform for 100M users.",
        criteria: [
          "Draw the system: client → gateway → LB → message service",
          "Explain data stores: Redis (presence), Kafka (messages), Postgres (durable), S3 (media)",
          "Address consistency vs availability tradeoffs",
          "Explain how you scale reads, writes, and fan-out",
        ],
        skill: "concurrency",
      },
    ],
  },
  security: {
    advanced: [
      {
        id: "security-audit",
        title: "Audit a vulnerable app",
        objective: "Find and fix vulnerabilities in a deliberately broken app.",
        criteria: [
          "Identifies XSS and fixes it",
          "Identifies SQL injection and uses parameterized queries",
          "Fixes CSRF on state-changing routes",
          "Adds rate limiting to an exposed endpoint",
        ],
        skill: "security",
      },
    ],
  },
  aieng: {
    pro: [
      {
        id: "aieng-agent",
        title: "Build a production AI agent",
        objective: "Build an agent with tools, memory, RAG, and evaluation.",
        criteria: [
          "Agent can call at least 2 tools",
          "Has long-term memory across sessions",
          "Grounds answers with RAG over a knowledge base",
          "Has an eval set + hallucination check",
        ],
        skill: "ai",
      },
    ],
  },
};

// ── Rubric grading ────────────────────────────────────────────
const RUBRIC_PROMPT = `You are a strict senior engineer grading a student's project submission against a rubric. Return ONLY JSON:
{
  "score": 0-100,
  "criteria_scores": [ { "criterion": "...", "met": true|false, "note": "one-line justification" } ],
  "verdict": "pass" | "needs-work",
  "feedback": "2-3 sentences, honest and specific."
}
Grade on demonstrated evidence, not claims. If the submission is vague or just says 'done', give a low score.`;

// Deterministic fallback: match submission text against criteria keywords.
function keywordGrade(submission, criteria) {
  const a = String(submission || "").toLowerCase();
  const hits = criteria.filter((c) => c.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length > 3 && a.includes(w)));
  const ratio = hits.length / criteria.length;
  return Math.round(ratio * 100);
}

// Grade a project submission against its rubric.
async function gradeProject(submission, proj) {
  const criteria = proj.criteria || [];
  // AI semantic path
  try {
    const res = await getAIResponse(
      `Project: ${proj.title}\nObjective: ${proj.objective}\nAcceptance criteria:\n${criteria.map((c) => "- " + c).join("\n")}\n\nStudent submission:\n"${String(submission).slice(0, 4000)}"`,
      "Project Grader", [], RUBRIC_PROMPT
    );
    const cleaned = res.trim().replace(/```json|```/gi, "").trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : cleaned);
    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    return {
      score,
      verdict: score >= 75 ? "pass" : "needs-work",
      criteriaScores: Array.isArray(parsed.criteria_scores) ? parsed.criteria_scores : [],
      feedback: parsed.feedback || "",
      ai: true,
    };
  } catch (e) {
    // Deterministic guardrail fallback.
    const score = keywordGrade(submission, criteria);
    return {
      score,
      verdict: score >= 75 ? "pass" : "needs-work",
      criteriaScores: criteria.map((c) => ({ criterion: c, met: undefined })),
      feedback: `Graded by automated criteria check (AI grader offline): ${score}/100. Submit more detail for a semantic review.`,
      ai: false,
    };
  }
}

// ── Flow ─────────────────────────────────────────────────────
function startProject(chatId, uid, track, level) {
  const list = PROJECTS[track]?.[level] || [];
  if (!list.length) return { text: `No project yet for this track/level. Complete the lessons first.` };
  state.users[uid] = state.users[uid] || {};
  state.users[uid].current = { track, level, projectIdx: 0, chatId, step: "objective" };
  state.users[uid].submissions = state.users[uid].submissions || [];
  save();
  return projectView(uid);
}

function projectView(uid) {
  const u = state.users[uid];
  if (!u?.current) return { text: "Start a project with !project <track> <level>." };
  const proj = PROJECTS[u.current.track]?.[u.current.level]?.[u.current.projectIdx];
  if (!proj) return { text: "Project not found." };
  return {
    text: `🏗️ *Project: ${proj.title}*\n\n${proj.objective}\n\n*Acceptance criteria:*\n${proj.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nSubmit your work to be graded against these:\n\`!project submit <describe what you built / paste code or architecture>\`\n\n_You can also reply directly with your work._`,
    proj,
  };
}

// Submit project work → graded against rubric → recorded as evidence.
async function submitProject(uid, chatId, work) {
  const u = state.users[uid];
  if (!u?.current) return { text: "No active project. Start one with !project <track> <level>." };
  const proj = PROJECTS[u.current.track]?.[u.current.level]?.[u.current.projectIdx];
  if (!proj) return { text: "Project not found." };
  if (!work || !String(work).trim()) return { text: "Submit your actual work — describe or paste what you built." };

  const g = await gradeProject(work, proj);
  const track = u.current.track, level = u.current.level;

  // Record the graded project as evidence; mastery derives from the score.
  const ev = recordEvidenceProject(uid, { track, level, score: g.score, skill: proj.skill, detail: proj.title });
  const mastery = recomputeMastery(uid, track, level);

  // XP proportional to demonstrated quality (no full reward for a bad pass).
  const xp = g.score >= 75 ? 80 : g.score >= 50 ? 40 : 15;
  const up = addXp(uid, xp, "Project");

  // Submission history (audit trail).
  u.submissions.push({ id: proj.id, at: Date.now(), score: g.score, verdict: g.verdict, work: String(work).slice(0, 500) });
  u.completed = u.completed || [];
  if (!u.completed.some((p) => p.id === proj.id)) u.completed.push({ id: proj.id, score: g.score, at: Date.now() });
  delete u.current;
  save();

  const critLines = (g.criteriaScores || []).map((c) => `• ${c.criterion} ${c.met === true ? "✅" : c.met === false ? "❌" : ""} ${c.note ? "— " + c.note : ""}`).join("\n");
  const status = g.verdict === "pass" ? "✅ Pass" : "🟡 Needs work — resubmit after improving.";
  return {
    text: `🏗️ *Project graded — ${proj.title}*\n\n*Score:* ${g.score}/100 (${status})\n\n${critLines}\n\n*Feedback:* ${g.feedback}\n\nMastery for ${track}/${level} is now *${mastery}%* (evidence-derived). +${xp} XP${levelUpText(up)}\n\n${g.verdict === "pass" ? "Demonstrated competence — locked in." : "Take the feedback, improve, and resubmit with !project <track> <level>."}`,
    score: g.score,
    verdict: g.verdict,
    mastery,
  };
}

function hasActiveProject(uid) {
  return !!(state.users[uid]?.current);
}

// Handle replies: a direct message during an active project is a submission.
async function handleProjectReply(chatId, uid, input) {
  if (!hasActiveProject(uid)) return null;
  if (/skip|later/i.test(input)) {
    delete state.users[uid].current;
    save();
    return { text: "Project deferred. You can come back with !project <track> <level>." };
  }
  // Any other meaningful reply = the learner's submission of their work.
  return submitProject(uid, chatId, input);
}

// Submission history view.
function submissionHistory(uid) {
  const u = state.users[uid];
  const subs = u?.submissions || [];
  if (!subs.length) return { text: "No project submissions yet." };
  return { text: "📜 *Project history*\n" + subs.slice(-10).map((s) => `• ${s.id} — ${s.score}/100 (${s.verdict}) ${new Date(s.at).toLocaleDateString()}`).join("\n") };
}

module.exports = { PROJECTS, startProject, projectView, submitProject, hasActiveProject, handleProjectReply, submissionHistory };
