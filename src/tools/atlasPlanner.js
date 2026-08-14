// ARIA Atlas v2 planner.
// The first planner is deterministic and inspectable. It creates a stable
// roadmap that can be reviewed, edited later, and applied with an explicit
// owner request. No model output is allowed to silently mutate a workspace.

const { findWorkspace, addPlanDraft, applyPlan, getBrief } = require("./atlasStore");

function clean(value, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function risk(title, likelihood, impact, mitigation) {
  return { title, likelihood, impact, mitigation };
}

function task(key, title, description, priority = "normal", dependsOn = []) {
  return { key, title, description, priority, dependsOn };
}

function buildPlan(goal, workspace) {
  const normalized = clean(goal || workspace?.contract?.outcome || workspace?.title, 1000);
  const lower = normalized.toLowerCase();
  const isLaunch = /\b(?:launch|deploy|release|ship|publish|production|store|monetiz)\b/.test(lower);
  const isCode = /\b(?:bot|app|api|website|site|code|software|dashboard|build|feature|repo|github)\b/.test(lower);
  const isContent = /\b(?:content|video|anime|course|brand|campaign|marketing|article)\b/.test(lower);
  const plan = {
    goal: normalized,
    assumptions: [
      "The owner will review the roadmap before applying it.",
      "External commits remain approval-gated even after the roadmap is applied.",
    ],
    milestones: [],
    risks: [],
  };

  plan.milestones.push({
    key: "discover",
    title: "Understand the outcome",
    description: "Turn the goal into a measurable outcome, constraints, and evidence checklist.",
    tasks: [
      task("clarify", "Define success criteria", "Write the measurable result that makes this project complete.", "high"),
      task("constraints", "Capture constraints and non-goals", "Record time, budget, platform, safety, and scope boundaries.", "normal", ["clarify"]),
      task("baseline", "Inspect the current baseline", "Collect the existing state, relevant files, decisions, and known blockers.", "normal", ["clarify"]),
    ],
  });

  plan.milestones.push({
    key: "design",
    title: isCode ? "Design the solution" : "Shape the execution plan",
    description: isCode ? "Choose the smallest architecture that can satisfy the success criteria." : "Choose the sequence, assets, and operating rhythm needed to reach the outcome.",
    dependsOn: ["discover"],
    tasks: [
      task("options", "Compare the viable approaches", "Record at least two approaches and the trade-offs that matter.", "high", ["baseline"]),
      task("decision", "Record the chosen direction", "Capture the decision, rationale, alternatives, and reversal conditions.", "high", ["options"]),
      task("slice", "Define the first shippable slice", "Choose the smallest valuable version that can be verified end to end.", "high", ["decision"]),
    ],
  });

  plan.milestones.push({
    key: "execute",
    title: isContent ? "Produce the first useful version" : "Build the first useful slice",
    description: "Execute the approved preparation work and attach evidence to the project.",
    dependsOn: ["design"],
    tasks: [
      task("prepare", "Prepare the first slice", "Complete the lowest-risk implementation or research work for the selected slice.", "high", ["slice"]),
      task("integrate", "Integrate the result into the project", "Update the project artifact, mission, or workflow without losing traceability.", "normal", ["prepare"]),
      task("checkpoint", "Checkpoint the evidence", "Attach outputs, links, test results, and unresolved questions.", "normal", ["integrate"]),
    ],
  });

  plan.milestones.push({
    key: "verify",
    title: isLaunch ? "Verify and release safely" : "Verify and learn",
    description: "Test the result, resolve risks, and decide the next iteration from evidence.",
    dependsOn: ["execute"],
    tasks: [
      task("verify", "Verify against the success criteria", "Run the relevant tests, checks, or review against the contract.", "high", ["checkpoint"]),
      task("risks", "Resolve the highest project risk", "Address the most important open risk or record an explicit accepted-risk decision.", "high", ["verify"]),
      task("review", isLaunch ? "Review release readiness" : "Review the next iteration", "Summarize what worked, what did not, and the next evidence-backed move.", "normal", ["risks"]),
    ],
  });

  plan.risks.push(risk("Unclear success criteria create rework", 4, 4, "Define measurable acceptance criteria before implementation starts."));
  if (isCode) plan.risks.push(risk("Integration or dependency failure delays the first slice", 3, 4, "Keep the first slice small and run import/build checks before adding more surface area."));
  if (isLaunch) plan.risks.push(risk("A release changes public behavior without a rollback path", 3, 5, "Require verification, an explicit approval, and a rollback or recovery note before release."));
  if (isContent) plan.risks.push(risk("Output is produced without evidence of audience or quality fit", 3, 3, "Capture the source brief, review criteria, and measured feedback in the evidence vault."));
  return plan;
}

function draftPlan(ownerId, goal = "") {
  const workspace = findWorkspace(ownerId, goal);
  if (!workspace) return null;
  const commandOnly = /^(?:plan this project|plan this|plan it|make a plan|break this down|break the project down|plan the project|make a roadmap|build a roadmap|show the roadmap|show the plan|view the dependencies|show the risks)\b/i.test(clean(goal));
  const plan = buildPlan(commandOnly ? workspace.contract.outcome : (goal || workspace.contract.outcome), workspace);
  return { workspace, draft: addPlanDraft(ownerId, workspace.id, plan) };
}

function applyDraft(ownerId, query = "") {
  const workspace = findWorkspace(ownerId, query);
  if (!workspace || !workspace.planning?.draft) return null;
  return { workspace, applied: applyPlan(ownerId, workspace.id, workspace.planning.draft.id) };
}

function formatDraft(workspace, draft) {
  const lines = [`🧠 *Atlas roadmap draft: ${workspace.title}*`, `Goal: ${draft.goal}`, "", "*Milestones*"];
  for (const [index, milestone] of draft.milestones.entries()) {
    lines.push(`${index + 1}. *${milestone.title}*`);
    for (const item of milestone.tasks) lines.push(`   • ${item.title}${item.dependsOn.length ? ` ← ${item.dependsOn.join(", ")}` : ""}`);
  }
  lines.push("", "*Top risks*");
  for (const item of draft.risks.slice(0, 4)) lines.push(`• ${item.title} (${item.likelihood}×${item.impact}) — ${item.mitigation}`);
  lines.push("", "This is a reviewable draft. Say *apply the plan* when you want Atlas to add the roadmap to the workspace.");
  return lines.join("\n");
}

function formatRoadmap(brief) {
  if (!brief) return "I don’t have an active Atlas workspace yet.";
  const { workspace } = brief;
  const milestones = workspace.milestones || [];
  const risks = workspace.risks || [];
  if (!milestones.length) return `*${workspace.title}* has no applied roadmap yet. Say “plan this project” and I’ll draft one for review.`;
  return `🗺️ *Roadmap: ${workspace.title}*\n\n${milestones.map((milestone, index) => `${index + 1}. *${milestone.title}* — ${milestone.status} · ${milestone.taskIds.length} task(s)`).join("\n")}\n\n⚠️ Open risks: ${risks.filter((risk) => risk.status === "open").length}`;
}

async function handlePlanner(ownerId, text) {
  const input = clean(text);
  const lower = input.toLowerCase();
  if (/\b(?:apply|approve|use)\s+(?:the\s+)?(?:atlas\s+)?plan\b/.test(lower)) {
    const result = applyDraft(ownerId, input);
    if (!result) return { kind: "text", text: "There is no Atlas roadmap draft waiting to be applied. Say “plan this project” first." };
    return { kind: "text", text: `✅ Applied the Atlas roadmap for *${result.workspace.title}*. I added ${result.applied.taskCount} task(s) and ${result.applied.riskCount} risk record(s).` };
  }
  if (/\b(?:show|give me|view)\s+(?:the\s+)?(?:atlas\s+)?(?:roadmap|plan|dependencies|risks)\b/.test(lower)) {
    const workspace = findWorkspace(ownerId, input);
    return { kind: "text", text: formatRoadmap(workspace ? getBrief(ownerId, workspace.id) : null) };
  }
  const result = draftPlan(ownerId, input);
  if (!result) return { kind: "text", text: "I don’t have an active Atlas workspace yet. Say “this is a project: <name and outcome>” first." };
  return { kind: "plan_draft", workspace: result.workspace, draft: result.draft, text: formatDraft(result.workspace, result.draft) };
}

module.exports = { buildPlan, draftPlan, applyDraft, formatDraft, formatRoadmap, handlePlanner };
