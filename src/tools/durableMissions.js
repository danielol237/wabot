// ── ARIA Durable Mission Engine ──────────────────────────────────
// The foundation of ARIA Aegis: durable execution for long-running
// objectives. Unlike the old persistentJobs (timers that die on restart),
// this checkpoints every step to disk so a mission SURVIVES process crashes,
// redeploys, and Render reboots — then resumes exactly where it left off.
//
// This is the bedrock the World Model and Mission Orchestrator sit on.
//
// Mission lifecycle:
//   pending → running → waiting_approval → running → completed | failed | cancelled
//
// Each mission is a sequence of steps. Each step is idempotent and
// checkpointed. On restart, any mission left in "running" is resumed from
// its last completed checkpoint. Steps can declare `approval` to pause for
// a human gate before executing.

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getAIResponse } = require("./ai");
const { searchWeb } = require("./webSearch");
const { scrapeUrl } = require("./scraper");
const { log, error, warn } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "missions.json");

// ── Persistence ──────────────────────────────────────────────
let missions = {};
try {
  if (fs.existsSync(FILE)) missions = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  error("Missions file corrupt, starting fresh:", err.message);
  missions = {};
}

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(missions, null, 2)); } catch (err) { error("Failed to save missions:", err.message); }
}

let sockRef = null;
function setSock(s) { sockRef = s; }

// ── Mission model ─────────────────────────────────────────────
function createMission(chatId, creator, objective, opts = {}) {
  const id = uuidv4().slice(0, 8);
  missions[id] = {
    id,
    chatId,
    creator,
    objective,
    status: "pending",            // pending → running → waiting_approval → completed/failed/cancelled
    steps: [],                    // [{ type, arg, status, result, checkpointAt, approval? }]
    currentStepIndex: -1,
    progress: "Queued",
    result: null,
    error: null,
    approvalRequest: null,        // { prompt, resolve: 'approve'|'reject', expiresAt }
    metadata: opts.metadata || {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resumed: false,
  };
  save();
  return id;
}

// ── Step execution (idempotent, checkpointed) ────────────────
async function runStep(mission, step, index) {
  // Already completed this checkpoint? Skip (crash-resume safety).
  if (step.status === "completed") return step.result;

  step.status = "running";
  step.startedAt = Date.now();
  save();

  let result = "";
  try {
    const upper = (step.type || "").toUpperCase();

    if (upper === "SEARCH") {
      const res = await searchWeb(step.arg);
      result = typeof res === "string" ? res : JSON.stringify(res);
    } else if (upper === "SCRAPE") {
      const res = await scrapeUrl(step.arg);
      result = typeof res === "string" ? res : JSON.stringify(res);
    } else if (upper === "NOTE") {
      // A NOTE step doesn't run anything — it's just a checkpoint the planner
      // wants persisted (analysis, decisions, synthesized context).
      result = step.arg || "";
    } else {
      // Unknown / LLM step — ask the model to do it
      result = await getAIResponse(
        `You are executing step ${index + 1} of a mission. Objective: "${mission.objective}".\nStep: ${step.type} ${step.arg}\n\nDo ONLY this step, return a concise result.`,
        "ARIA_MISSION",
        []
      );
    }

    step.result = result;
    step.status = "completed";
    step.checkpointAt = Date.now();
    mission.currentStepIndex = index;
    mission.progress = `Step ${index + 1}/${mission.steps.length} done: ${step.type}`;
    mission.updatedAt = Date.now();
    save();
    return result;
  } catch (err) {
    // Retry logic: mark as failed, count attempts
    step.attempts = (step.attempts || 0) + 1;
    step.lastError = err.message;
    if (step.attempts < 3) {
      step.status = "retry";
      mission.progress = `Step ${index + 1} retry ${step.attempts}/3: ${err.message}`;
      mission.updatedAt = Date.now();
      save();
      throw new Error("RETRY:" + err.message);
    }
    step.status = "failed";
    mission.error = `Step ${index + 1} (${step.type}) failed: ${err.message}`;
    mission.status = "failed";
    mission.progress = "Failed";
    mission.updatedAt = Date.now();
    save();
    notify(mission, "❌ *Mission Failed*\n" + mission.objective.slice(0, 60) + "...\n\n" + mission.error);
    throw err;
  }
}

// ── Main execution loop ───────────────────────────────────────
async function executeMission(id, force = false) {
  const mission = missions[id];
  if (!mission) return;

  // Guard against double execution
  if (mission.status === "running" && !force) return;

  mission.status = "running";
  mission.updatedAt = Date.now();
  save();

  try {
    // Plan the mission into steps (unless already planned from a prior run)
    if (mission.steps.length === 0) {
      mission.progress = "Planning...";
      save();
      const plan = await getAIResponse(
        `Break this mission into a numbered plan of concrete steps (max 8). Each step on its own line, format: <TYPE>: <arg>\nTypes: SEARCH, SCRAPE, NOTE, ANALYSIS, ACTION\nMission: "${mission.objective}"`,
        "ARIA_MISSION_PLANNER",
        [],
        null,
        "You are a mission planner. Output ONLY numbered steps in TYPE: arg format, one per line."
      );

      const steps = plan.split("\n")
        .map(l => l.trim().replace(/^\d+[.)]\s*/, ""))
        .filter(l => /^(SEARCH|SCRAPE|NOTE|ANALYSIS|ACTION)\s*:/i.test(l))
        .slice(0, 8)
        .map(l => {
          const [type, ...rest] = l.split(":");
          return { type: type.trim().toUpperCase(), arg: rest.join(":").trim(), status: "pending", attempts: 0 };
        });

      if (steps.length === 0) steps.push({ type: "ACTION", arg: mission.objective, status: "pending", attempts: 0 });
      mission.steps = steps;
      mission.progress = "Planned " + steps.length + " steps";
      save();
    }

    // Resume from last completed checkpoint
    let startIndex = 0;
    for (let i = 0; i < mission.steps.length; i++) {
      if (mission.steps[i].status === "completed") startIndex = i + 1;
    }

    let context = "";
    for (const s of mission.steps) {
      if (s.status === "completed" && s.result) context += `\n[${s.type}: ${s.arg}]\n${s.result.slice(0, 800)}\n`;
    }

    for (let i = startIndex; i < mission.steps.length; i++) {
      if (mission.status !== "running") return; // cancelled/paused
      const step = mission.steps[i];

      // Approval gate — pause and wait for human decision
      if (step.approval) {
        mission.status = "waiting_approval";
        mission.approvalRequest = { prompt: step.approval, stepIndex: i, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
        mission.progress = "Waiting approval: " + step.approval;
        save();
        notify(mission, "🛑 *Approval needed*\n" + mission.objective.slice(0, 60) + "...\n\n" + step.approval + "\n\nReply *!mission approve " + id + "* or *!mission reject " + id + "*");
        return; // stop until approved
      }

      // Retry loop with backoff
      let attempts = 0;
      while (attempts < 3) {
        try {
          const result = await runStep(mission, step, i);
          if (result) context += `\n[${step.type}: ${step.arg}]\n${result.slice(0, 800)}\n`;
          break;
        } catch (err) {
          if (String(err.message).startsWith("RETRY:")) {
            attempts++;
            if (attempts >= 3) { mission.steps[i].status = "failed"; mission.status = "failed"; save(); return; }
            await new Promise(r => setTimeout(r, 2000 * attempts));
          } else {
            return; // already marked failed
          }
        }
      }
    }

    // Synthesize final result
    if (mission.status === "running") {
      mission.progress = "Synthesizing result...";
      save();
      const finalResult = await getAIResponse(
        `Mission: ${mission.objective}\n\nWork performed:\n${context.slice(0, 5000)}\n\nProvide a complete, well-organized final result for the user.`,
        "ARIA_MISSION_SYNTHESIS",
        []
      );

      mission.status = "completed";
      mission.result = finalResult;
      mission.progress = "Completed";
      mission.updatedAt = Date.now();
      save();
      notify(mission, "✅ *Mission Complete: " + mission.objective.slice(0, 50) + "...*\n\n" + finalResult.slice(0, 1500) + "\n\n_Full: !mission view " + mission.id + "_");
    }
  } catch (err) {
    if (mission.status !== "failed") {
      mission.status = "failed";
      mission.error = err.message;
      mission.progress = "Failed";
      mission.updatedAt = Date.now();
      save();
      notify(mission, "❌ *Mission Failed*\n" + err.message);
    }
  }
}

// ── Approval handling ─────────────────────────────────────────
function decideApproval(id, decision) {
  const mission = missions[id];
  if (!mission || mission.status !== "waiting_approval") return { ok: false, msg: "Mission not awaiting approval." };
  if (!mission.approvalRequest) return { ok: false, msg: "No pending approval." };

  const stepIndex = mission.approvalRequest.stepIndex;
  if (decision === "approve") {
    mission.steps[stepIndex].approval = null; // approved, proceed
    mission.approvalRequest = null;
    mission.status = "running";
    mission.progress = "Approved — continuing";
    save();
    executeMission(id, true);
    return { ok: true, msg: "Approved — mission continuing." };
  } else {
    mission.steps[stepIndex].status = "skipped";
    mission.approvalRequest = null;
    mission.status = "running";
    mission.progress = "Step rejected — skipping";
    save();
    executeMission(id, true);
    return { ok: true, msg: "Rejected — step skipped." };
  }
}

// ── Crash recovery ────────────────────────────────────────────
// Called on startup: any mission stuck in "running" or "waiting_approval"
// that was mid-execution gets resumed (or, for approval, re-notified).
function recoverMissions() {
  let resumed = 0;
  for (const mission of Object.values(missions)) {
    if (mission.status === "running") {
      // It died mid-flight — resume from checkpoint
      mission.resumed = true;
      mission.status = "running";
      mission.progress = "Resuming after restart...";
      save();
      executeMission(mission.id, true);
      resumed++;
    } else if (mission.status === "waiting_approval" && mission.approvalRequest) {
      // Re-notify pending approval
      notify(mission, "🔔 *Still waiting on your approval*\n" + mission.approvalRequest.prompt + "\n\n*!mission approve " + mission.id + "* or *!mission reject " + mission.id + "*");
    }
  }
  if (resumed > 0) log(`🔁 Resumed ${resumed} mission(s) after restart.`);
  return resumed;
}

function notify(mission, text) {
  if (!sockRef) return;
  sockRef.sendMessage(mission.chatId, { text }).catch(() => {});
}

// ── Queries / commands ────────────────────────────────────────
function getMission(id) { return missions[id] || null; }
function getMissions(chatId) { return Object.values(missions).filter(m => m.chatId === chatId); }
function cancelMission(id) {
  const m = missions[id];
  if (!m) return false;
  m.status = "cancelled";
  m.progress = "Cancelled";
  m.updatedAt = Date.now();
  save();
  return true;
}

function formatMissionList(list) {
  if (list.length === 0) return "No missions. Create one with *!mission <objective>*";
  return list.map(m => {
    const icon = m.status === "completed" ? "✅" : m.status === "failed" ? "❌" : m.status === "cancelled" ? "⛔" : m.status === "waiting_approval" ? "🛑" : "🔄";
    return `${icon} *${m.id}* — ${m.objective.slice(0, 50)}\n   ${m.status} | ${m.progress}`;
  }).join("\n\n");
}

module.exports = {
  createMission, executeMission, decideApproval, recoverMissions,
  getMission, getMissions, cancelMission, formatMissionList, setSock,
};
