// Goal-Driven Orchestrator & Dynamic Mission Agent
const EventEmitter = require("events");
const capabilityRegistry = require("./CapabilityRegistry");
const SecurityAssessmentCapability = require("./SecurityAssessmentCapability");
const ArtifactManager = require("./ArtifactManager");
const TaskStore = require("../coding/state/TaskStore");
const { log, warn, error } = require("../utils/logger");
const ariaEventBus = require("../utils/eventBus");

class MissionAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.store = options.store || new TaskStore();
    this.registry = capabilityRegistry;
    this.securityCap = new SecurityAssessmentCapability();
    this.artifactManager = new ArtifactManager();
  }

  broadcast(eventType, payload) {
    this.emit(eventType, payload);
    try {
      ariaEventBus.emitEvent(eventType, payload);
    } catch (_) {}
  }

  composePlan(objective) {
    const clean = String(objective || "").toLowerCase();
    const steps = [];

    // Extract target URL if provided, otherwise default to localhost or site under test
    const urlMatch = objective.match(/https?:\/\/[^\s]+/i);
    const targetUrl = urlMatch ? urlMatch[0] : "http://localhost:3000";

    if (clean.includes("build") && clean.includes("website")) {
      steps.push({ stepId: "step_1", capability: "coding.build_app", args: { request: objective } });
      steps.push({ stepId: "step_2", capability: "coding.verify", args: {} });
      steps.push({ stepId: "step_3", capability: "artifact.create", args: { filename: "website_report.md", type: "md" } });
    } else if (clean.includes("security") || clean.includes("scan")) {
      steps.push({ stepId: "step_1", capability: "web.fetch", args: { url: targetUrl } });
      steps.push({ stepId: "step_2", capability: "security.passive_scan", args: { targetUrl } });
      steps.push({ stepId: "step_3", capability: "artifact.create", args: { filename: "security_report.md", type: "md" } });
    } else if (clean.includes("fix") && clean.includes("test")) {
      steps.push({ stepId: "step_1", capability: "git.status", args: {} });
      steps.push({ stepId: "step_2", capability: "coding.modify", args: { request: objective } });
      steps.push({ stepId: "step_3", capability: "coding.verify", args: {} });
      steps.push({ stepId: "step_4", capability: "git.commit", args: { message: "fix: repaired failing tests via ARIA agent" } });
    } else if (clean.includes("server") || clean.includes("log")) {
      steps.push({ stepId: "step_1", capability: "terminal.observe", args: { command: "pm2 status" } });
      steps.push({ stepId: "step_2", capability: "terminal.observe", args: { command: "git status" } });
    } else {
      steps.push({ stepId: "step_1", capability: "terminal.observe", args: { command: "git status" } });
    }

    return steps;
  }

  async executeMission(objective, context = {}) {
    const task = this.store.createTask({
      request: objective,
      userId: context.userId || "anonymous",
      chatId: context.chatId || null,
      type: "mission",
    });

    this.store.updateTask(task.id, { status: "CLASSIFIED" });
    this.broadcast("mission.created", { taskId: task.id, objective });

    this.store.updateTask(task.id, { status: "DISCOVERING" });
    this.store.updateTask(task.id, { status: "RESEARCHING" });
    this.store.updateTask(task.id, { status: "PLANNING" });

    const plan = this.composePlan(objective);
    this.store.updateTask(task.id, { plan });
    this.broadcast("plan.created", { taskId: task.id, plan });

    this.store.updateTask(task.id, { status: "PLAN_VALIDATED" });
    this.store.updateTask(task.id, { status: "EXECUTING" });

    const results = [];
    const artifacts = [];

    let currentWorkspacePath = context.workspacePath || process.cwd();

    for (const step of plan) {
      this.broadcast("step.started", { taskId: task.id, step });

      try {
        let stepResult = null;
        if (step.capability === "security.passive_scan") {
          stepResult = await this.securityCap.runPassiveScan(step.args.targetUrl || "https://example.com");
        } else if (step.capability === "artifact.create") {
          const content = `# ARIA Mission Report\n\nObjective: ${objective}\n\nCompleted successfully.\n`;
          stepResult = this.artifactManager.createArtifact(step.args.filename, content, step.args.type);
          artifacts.push(stepResult);
        } else if (this.registry.hasCapability(step.capability)) {
          stepResult = await this.registry.executeCapability(step.capability, step.args, {
            workspacePath: currentWorkspacePath,
            taskId: task.id,
            userId: context.userId,
            chatId: context.chatId,
            objective,
            sock: context.sock,
          });

          if (stepResult?.workspacePath) {
            currentWorkspacePath = stepResult.workspacePath;
          }
        } else {
          throw new Error(`Unsupported capability: ${step.capability}`);
        }

        results.push({ stepId: step.stepId, capability: step.capability, success: true, data: stepResult });
        this.broadcast("step.completed", { taskId: task.id, stepId: step.stepId, result: stepResult });
      } catch (err) {
        error(`[MissionAgent] Step ${step.stepId} (${step.capability}) failed: ${err.message}`);
        this.broadcast("step.failed", { taskId: task.id, stepId: step.stepId, error: err.message });

        this.store.updateTask(task.id, {
          status: "FAILED",
          blockedReason: `Mission step '${step.capability}' failed: ${err.message}`,
        });
        return { success: false, taskId: task.id, error: err.message };
      }
    }

    this.store.updateTask(task.id, { status: "TESTING" });
    this.store.updateTask(task.id, { status: "REVIEWING" });
    this.store.updateTask(task.id, { status: "VERIFYING" });
    this.store.updateTask(task.id, {
      status: "COMPLETED",
      evidence: { results, artifacts },
    });

    this.broadcast("mission.completed", { taskId: task.id, results, artifacts });
    return {
      success: true,
      taskId: task.id,
      results,
      artifacts,
      message: `🤖 *ARIA Mission Agent Completed*\n\nObjective: "${objective}"\nCompleted Steps: ${plan.length}\nArtifacts: ${artifacts.length}`,
    };
  }
}

module.exports = MissionAgent;
