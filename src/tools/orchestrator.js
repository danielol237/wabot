// ── ARIA Mission Orchestrator ──────────────────────────────────
// The strategic planning layer of ARIA Aegis. Turns an objective into a
// structured plan, assigns work to specialist agent roles, verifies results,
// and manages handoffs — all running on top of the durable mission engine.
//
// Agent roles (temporary, within a mission):
//   planner    → decomposes the objective into a plan
//   researcher → gathers info
//   builder    → produces artifacts/code/writing
//   verifier   → checks the result against success criteria
//   risk       → flags problems / needs approval
//   reflector  → evaluates the finished mission
//
// Unlike persistentJobs' flat step list, this gives ARIA a real "org chart"
// for each mission, with role-based context and handoffs.

const { createMission, executeMission, getMission, setSock, formatMissionList } = require("./durableMissions");
const { getAIResponse } = require("./ai");
const { getWorldContext } = require("../utils/worldModel");
const { getRelevantContext } = require("../utils/semanticMemory");
const { searchWeb } = require("./webSearch");
const { scrapeUrl } = require("./scraper");
const { log, error, warn } = require("../utils/logger");

const ROLE_DEFS = {
  planner:    "You decompose a complex objective into a concrete, ordered plan. Output clear steps.",
  researcher: "You gather and evaluate information. Use SEARCH and SCRAPE. Return only relevant findings.",
  builder:    "You produce the actual output — code, writing, artifacts. Make it complete and polished.",
  verifier:   "You test/check a result against the success criteria. Report pass/fail and gaps.",
  risk:       "You identify risks, blockers, and decisions that need human approval.",
  reflector:  "You evaluate the completed mission: what worked, what didn't, what to remember.",
};

// ── Role dispatch ─────────────────────────────────────────────
async function runRole(role, mission, context, input) {
  const def = ROLE_DEFS[role] || ROLE_DEFS.builder;
  const worldContext = getWorldContext(mission.creator);
  const memContext = getRelevantContext(mission.creator, mission.objective);

  return getAIResponse(
    `You are the ${role.toUpperCase()} agent on this mission.\n\nMission: "${mission.objective}"\n\n${worldContext}\n${memContext}\n\nYour role: ${def}\n\nContext so far:\n${context.slice(-6000)}\n\nYour task input:\n${input}\n\nReturn your work as the ${role}. Be concrete and complete.`,
    "ARIA_ORCHESTRATOR",
    [],
    null,
    "You are a mission role agent. Do ONLY your role's work and return a concrete result."
  );
}

// ── Orchestrate a full mission ────────────────────────────────
// Phase 1: plan. Phase 2: research (if needed). Phase 3: build. Phase 4: verify.
// Phase 5: reflect. Each phase runs through runRole and collects context.
async function orchestrate(chatId, creator, objective) {
  const missionId = createMission(chatId, creator, objective, { metadata: { orchestrator: true } });
  const mission = getMission(missionId);
  mission.status = "running";
  mission.progress = "Planning mission...";
  log(`🎯 Orchestrating mission ${missionId}: ${objective}`);

  // Give the mission a lightweight step list so status shows progress
  mission.steps = [
    { type: "PLANNER", arg: "Decompose objective", status: "running", attempts: 0 },
    { type: "RESEARCHER", arg: "Gather information", status: "pending", attempts: 0 },
    { type: "BUILDER", arg: "Produce output", status: "pending", attempts: 0 },
    { type: "VERIFIER", arg: "Check result", status: "pending", attempts: 0 },
    { type: "REFLECTOR", arg: "Evaluate mission", status: "pending", attempts: 0 },
  ];
  saveMission(mission);
  notify(mission, "🎯 *Mission started:* " + objective.slice(0, 80) + "\nID: `" + missionId + "`");
  try { require("../utils/eventLog").track("mission", "Started mission: " + objective.slice(0, 80), { id: missionId }); } catch (_) {}

  try {
    // 1. PLAN
    mission.currentStepIndex = 0;
    saveMission(mission);
    const plan = await runRole("planner", mission, "", objective);
    mission.steps[0].status = "completed";
    mission.steps[0].result = plan;
    mission.progress = "Plan ready — researching...";
    saveMission(mission);

    let context = `\n[PLAN]\n${plan}\n`;

    // 2. RESEARCH (optional — skip for simple objectives)
    const needsResearch = /research|find|compare|investigate|data|market|latest|trend|analyze|options|alternatives/i.test(objective);
    if (needsResearch) {
      mission.currentStepIndex = 1;
      mission.steps[1].status = "running";
      saveMission(mission);
      const research = await runRole("researcher", mission, context, "Research the key questions from the plan.");
      mission.steps[1].status = "completed";
      mission.steps[1].result = research;
      mission.progress = "Research done — building...";
      context += `\n[RESEARCH]\n${research}\n`;
      saveMission(mission);
    } else {
      mission.steps[1].status = "skipped";
      saveMission(mission);
    }

    // 3. BUILD
    mission.currentStepIndex = 2;
    mission.steps[2].status = "running";
    mission.progress = "Building output...";
    saveMission(mission);

    // If the objective is a code/build task, use the app builder so real files are
    // written, verified, zipped and uploaded — not just an AI-written plan.
    const isBuildTask = /(build|create|make|write|develop|app|website|calculator|todo|game|script|bot|api|dashboard|landing|project)/i.test(objective);
    let built = "";
    let buildLink = "";
    if (isBuildTask) {
      try {
        notify(mission, "👨‍💻 *Builder:* Writing real files, verifying, and packaging the project...");
        const { buildProject, continueProject } = require("./appBuilder");
        let buildResult = await buildProject(objective, "ARIA", mission.chatId, async (msg) => notify(mission, msg));
        // If the build paused (more files than one batch), auto-continue until done.
        let guard = 0;
        while (buildResult && buildResult.paused && guard < 6) {
          notify(mission, "⏩ Continuing the build...");
          buildResult = await continueProject(mission.chatId, "ARIA", async (msg) => notify(mission, msg));
          guard++;
        }
        if (buildResult && buildResult.success && buildResult.downloadUrl) {
          built = "Built and packaged the project. Download: " + buildResult.downloadUrl;
          buildLink = buildResult.downloadUrl;
          mission.steps[2].result = { built: true, downloadUrl: buildResult.downloadUrl, detail: buildResult.message || "" };
          mission.buildLink = buildResult.downloadUrl;
        } else {
          built = "[BUILDER] " + (buildResult?.error || "Build did not complete (may need !continue).");
        }
      } catch (err) {
        error("Mission build failed:", err.message);
        built = "[BUILDER] " + err.message;
      }
    } else {
      built = await runRole("builder", mission, context, "Produce the final deliverable based on the plan and research.");
    }
    mission.steps[2].status = "completed";
    mission.steps[2].result = built;
    mission.progress = "Built — verifying...";
    context += `\n[BUILT]\n${built}\n`;
    saveMission(mission);

    // 4. VERIFY
    mission.currentStepIndex = 3;
    mission.steps[3].status = "running";
    mission.progress = "Verifying result...";
    saveMission(mission);
    const verification = await runRole("verifier", mission, context, "Verify the deliverable meets the objective. Report pass/fail and any gaps.");
    mission.steps[3].status = "completed";
    mission.steps[3].result = verification;
    mission.progress = "Verified — reflecting...";
    context += `\n[VERIFICATION]\n${verification}\n`;
    saveMission(mission);

    // 5. REFLECT + synthesize final
    mission.currentStepIndex = 4;
    mission.steps[4].status = "running";
    mission.progress = "Finalizing...";
    saveMission(mission);
    const finalResult = await runRole("reflector", mission, context, "Synthesize the final answer to the user: the plan, the deliverable, the verification, and any risks/next steps. Make it complete and useful.");
    mission.steps[4].status = "completed";
    mission.steps[4].result = finalResult;
    mission.result = finalResult;
    mission.status = "completed";
    mission.progress = "Completed";
    saveMission(mission);

    const downloadNote = buildLink ? `\n\n📦 *Download the finished project:* ${buildLink}` : "";
    notify(mission, "✅ *Mission Complete* " + missionId + "\n\n" + finalResult.slice(0, 1400) + downloadNote + "\n\n_Details: !mission status " + missionId + "_");
    try { require("../utils/eventLog").track("mission", "Completed mission: " + objective.slice(0, 80), { id: missionId }); } catch (_) {}
    return missionId;
  } catch (err) {
    mission.status = "failed";
    mission.error = err.message;
    mission.progress = "Failed";
    saveMission(mission);
    notify(mission, "❌ *Mission Failed* " + missionId + "\n" + err.message);
    try { require("../utils/eventLog").track("error", "Mission failed: " + err.message.slice(0, 80), { id: missionId }); } catch (_) {}
    return missionId;
  }
}

// ── Bridge to the durable engine's storage ────────────────────
// Previously the orchestrator read/wrote missions.json directly, which fought
// durableMissions' own writes (split-brain: whichever wrote last won, losing
// updates). Now the orchestrator goes through the durable engine's per-mission
// atomic save + write lock, so there's a single source of truth.
function saveMission(mission) {
  const durable = require("./durableMissions");
  try {
    const live = durable.getMission(mission.id);
    if (!live) return;
    // Copy the orchestrator's in-progress fields onto the live record, then let
    // the engine persist it atomically under its per-mission write lock.
    live.progress = mission.progress;
    live.steps = mission.steps;
    live.currentStepIndex = mission.currentStepIndex;
    live.result = mission.result;
    live.status = mission.status;
    live.error = mission.error;
    live.metadata = mission.metadata;
    // durableMissions.saveMission isn't exported; route via the module's save()
    // which serialises all records atomically.
    durable.save();
  } catch (err) {
    error("Failed to save orchestrated mission:", err.message);
  }
}

function notify(mission, text) {
  const holder = require("./missionSock");
  if (holder.getSock()) holder.getSock().sendMessage(mission.chatId, { text }).catch(() => {});
}

module.exports = { orchestrate, runRole, ROLE_DEFS };
