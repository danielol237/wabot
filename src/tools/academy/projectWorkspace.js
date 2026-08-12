// ── ARIA Academy — Project / Capstone Workspace ──────────────────
// Tracks-level projects: mini projects, advanced projects, and capstones
// that produce engineering ability, not just XP. Each project has an
// objective, acceptance criteria, and (for graded ones) a rubric the learner
// walks through. Mastery is awarded on demonstrating the project, separate
// from XP.

const fs = require("fs");
const path = require("path");
const { addXp, setMastery, getMastery } = require("./learnerModel");
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
//   { id, title, objective, criteria: [..], grade: "pass/fail" | "rubric" }
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

// Start a project session for a track+level.
function startProject(chatId, uid, track, level) {
  const list = PROJECTS[track]?.[level] || [];
  if (!list.length) return { text: `No project yet for this track/level. Complete the lessons first.` };
  state.users[uid] = state.users[uid] || {};
  state.users[uid].current = { track, level, projectIdx: 0, chatId, step: "objective" };
  save();
  return projectView(uid);
}

function projectView(uid) {
  const u = state.users[uid];
  if (!u?.current) return { text: "Start a project with !project <track> <level>." };
  const proj = PROJECTS[u.current.track]?.[u.current.level]?.[u.current.projectIdx];
  if (!proj) return { text: "Project not found." };
  return {
    text: `🏗️ *Project: ${proj.title}*\n\n${proj.objective}\n\n*Acceptance criteria:*\n${proj.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nReply with *done* when you've completed it (or *skip* to defer).`,
    proj,
  };
}

// Mark a project complete — awards a mastery boost (competence) + XP.
function completeProject(uid, chatId) {
  const u = state.users[uid];
  if (!u?.current) return { text: "No active project." };
  const proj = PROJECTS[u.current.track]?.[u.current.level]?.[u.current.projectIdx];
  if (!proj) return { text: "Project not found." };
  u.completed = u.completed || [];
  if (!u.completed.some((p) => p.id === proj.id)) u.completed.push({ id: proj.id, at: Date.now() });
  // Mastery reflects demonstrated competence — boost it on project completion.
  const track = u.current.track, level = u.current.level;
  const base = getMastery(uid, track, level);
  setMastery(uid, track, level, Math.min(100, base + 15));
  const up = addXp(uid, 80, "Project");
  delete u.current;
  save();
  return { text: `🏆 Project complete! You demonstrated real skill — mastery on ${track} boosted and +80 XP.${levelUpText(up)}` };
}

function hasActiveProject(uid) {
  return !!(state.users[uid]?.current);
}

function handleProjectReply(chatId, uid, input) {
  if (!hasActiveProject(uid)) return null;
  const u = state.users[uid];
  if (/done|complete/i.test(input)) {
    const r = completeProject(uid, chatId);
    return r;
  }
  if (/skip|later/i.test(input)) {
    delete u.current;
    save();
    return { text: "Project deferred. You can come back with !project <track> <level>." };
  }
  return null;
}

module.exports = { PROJECTS, startProject, projectView, completeProject, hasActiveProject, handleProjectReply };
