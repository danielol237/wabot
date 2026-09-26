/**
 * src/agent/MissionAgent.js
 *
 * Top-Level Goal-Driven Autonomous Mission Agent for ARIA.
 * Implements observe / reason / act loop:
 * Goal Understanding -> Context Discovery -> Capability Selection -> Dynamic Plan ->
 * Policy Validation -> Execution -> Observation -> Evaluation -> Repair/Retry -> Verification -> Artifact Delivery.
 *
 * Delegates execution strictly to registered Capabilities & underlying core engines.
 */

const { defaultRegistry } = require("./CapabilityRegistry");
const SecurityAssessmentCapability = require("./SecurityAssessmentCapability");
const TaskManager = require("../coding/TaskManager");
const CodingEngine = require("../coding/CodingEngine");
const EventBus = require("../utils/eventBus");
const fs = require("fs");
const path = require("path");

class MissionAgent {
  constructor(options = {}) {
    this.registry = options.registry || defaultRegistry;
    this.securityAssessment = new SecurityAssessmentCapability();
    this.setupCapabilities();
  }

  setupCapabilities() {
    // 1. Register Web Security Assessment Capability
    if (!this.registry.get("web.security.assess")) {
      this.registry.register({
        name: "web.security.assess",
        description: "Perform bounded security assessment (HTTPS, TLS, headers, CORS, public surface) of authorized web app",
        inputs: { targetUrl: "string", policy: "string" },
        outputs: { findings: "array", report: "string" },
        risk: "READ",
        authorization: "POLICY_CHECK",
        executionEnvironment: "IN_PROCESS",
        implementation: async (inputs, context) => {
          return await this.securityAssessment.runAssessment(inputs, context);
        }
      });
    }

    // 2. Register Document Generation / Artifact Creation
    if (!this.registry.get("document.create")) {
      this.registry.register({
        name: "document.create",
        description: "Create text/markdown report artifact",
        inputs: { filename: "string", content: "string" },
        outputs: { filePath: "string", artifactId: "string" },
        risk: "LOW_RISK_WRITE",
        implementation: async (inputs, context) => {
          const artifactsDir = path.resolve(process.cwd(), "data/artifacts");
          if (!fs.existsSync(artifactsDir)) {
            fs.mkdirSync(artifactsDir, { recursive: true });
          }
          const fname = inputs.filename || `report_${Date.now()}.txt`;
          const filePath = path.join(artifactsDir, fname);
          fs.writeFileSync(filePath, inputs.content || "", "utf8");
          return { success: true, filePath, filename: fname };
        }
      });
    }

    // 3. Register Coding / App Building Capability (Delegating to TaskManager / CodingEngine)
    if (!this.registry.get("coding.build_app")) {
      this.registry.register({
        name: "coding.build_app",
        description: "Build, update or repair web application or project code using Coding Engine",
        inputs: { requirement: "string" },
        outputs: { taskId: "string", status: "string" },
        risk: "AUTHORIZED_WRITE",
        implementation: async (inputs, context) => {
          const taskManager = new TaskManager();
          const task = await taskManager.createTask({
            prompt: inputs.requirement,
            userId: context.userId || "system"
          });
          const engine = new CodingEngine({ taskManager });
          const completedTask = await engine.executeTask(task.id);
          return { success: completedTask.status === "COMPLETED", taskId: task.id, status: completedTask.status, task: completedTask };
        }
      });
    }

    // 4. Register Terminal Execution Capability
    if (!this.registry.get("terminal.execute")) {
      const { executeTerminal } = require("./TerminalCapability");
      this.registry.register({
        name: "terminal.execute",
        description: "Execute terminal shell command within authorized policy boundary",
        inputs: { command: "string", cwd: "string" },
        outputs: { stdout: "string", stderr: "string", exitCode: "number" },
        risk: "AUTHORIZED_WRITE",
        authorization: "POLICY_CHECK",
        executionEnvironment: "SANDBOX",
        implementation: async (inputs, context) => {
          return await executeTerminal(inputs, context);
        }
      });
    }

    // 5. Register Composio Capabilities (with User Identity Isolation)
    if (!this.registry.get("composio.execute")) {
      this.registry.register({
        name: "composio.execute",
        description: "Execute action via Composio connected app on behalf of authenticated ARIA user",
        inputs: { action: "string", params: "object" },
        outputs: { result: "object" },
        risk: "AUTHORIZED_WRITE",
        authorization: "REQUIRED",
        implementation: async (inputs, context) => {
          const userId = context.userId || "anonymous_user";
          const { executeComposioAction } = require("../tools/semanticCapabilities");
          return await executeComposioAction(inputs.action, inputs.params, { userId });
        }
      });
    }
  }

  /**
   * Execute an autonomous mission for a user objective.
   */
  async executeMission(objective, context = {}) {
    const missionId = `mission_${Date.now().toString(36)}`;
    const userId = context.userId || "anonymous";

    // Broadcast mission start
    EventBus.emit("mission:created", { missionId, userId, objective, status: "STARTED" });

    try {
      // 1. Goal Understanding & Dynamic Plan Generation
      const plan = this.generatePlan(objective, context);
      EventBus.emit("mission:plan_created", { missionId, plan });

      const results = [];
      const artifacts = [];

      // 2. Step-by-Step Execution Loop
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        EventBus.emit("mission:step_started", { missionId, stepId: step.id, capability: step.capability });

        let stepResult;
        try {
          stepResult = await this.registry.execute(step.capability, step.inputs, context);
          EventBus.emit("mission:step_completed", { missionId, stepId: step.id, result: stepResult });
        } catch (err) {
          EventBus.emit("mission:step_failed", { missionId, stepId: step.id, error: err.message });
          // Bounded self-recovery/adaptation check
          if (step.fallbackCapability) {
            stepResult = await this.registry.execute(step.fallbackCapability, step.inputs, context);
          } else {
            throw err;
          }
        }

        results.push({ step, result: stepResult });

        // Collect generated artifacts
        if (stepResult && stepResult.filePath) {
          artifacts.push(stepResult.filePath);
        }

        // Pass outputs from previous step into inputs of subsequent step if dependent
        if (i < plan.steps.length - 1 && stepResult.report && plan.steps[i + 1].capability === "document.create") {
          plan.steps[i + 1].inputs.content = stepResult.report;
        }
      }

      // 3. Mission Completion & Artifact Synthesis
      const finalResult = {
        missionId,
        success: true,
        objective,
        stepsExecuted: plan.steps.length,
        artifacts,
        summary: `Mission successfully completed ${plan.steps.length} steps.`
      };

      EventBus.emit("mission:completed", { missionId, result: finalResult });
      return finalResult;
    } catch (error) {
      const failureResult = {
        missionId,
        success: false,
        objective,
        error: error.message
      };
      EventBus.emit("mission:failed", { missionId, error: error.message });
      return failureResult;
    }
  }

  /**
   * Extract target URL or domain safely from objective text.
   */
  extractTargetUrl(text) {
    const rawMatch = text.match(/\b(?:https?:\/\/)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+(?::\d+)?(?:\/[^\s]*)?)\b/i);
    if (rawMatch && rawMatch[0]) {
      const candidate = rawMatch[0];
      return candidate.startsWith("http") ? candidate : `https://${candidate}`;
    }
    return "https://example.com";
  }

  /**
   * Dynamic capability planner that generates execution steps based on goal analysis.
   */
  generatePlan(objective, context = {}) {
    const text = String(objective || "").toLowerCase();
    const steps = [];

    // Objective Pattern 1: Security Assessment & Report
    if (text.includes("pentest") || text.includes("security") || text.includes("audit")) {
      const targetUrl = this.extractTargetUrl(objective);

      steps.push({
        id: "step_1_security_assess",
        description: "Perform bounded security assessment",
        capability: "web.security.assess",
        inputs: { targetUrl, policy: "PASSIVE" }
      });

      steps.push({
        id: "step_2_create_report",
        description: "Generate security report file artifact",
        capability: "document.create",
        inputs: { filename: `security_report_${Date.now()}.txt`, content: "" }
      });
    }
    // Objective Pattern 2: Software Engineering / Web App Building
    else if (text.includes("build") || text.includes("create")) {
      steps.push({
        id: "step_1_build_app",
        description: "Build application using Coding Engine",
        capability: "coding.build_app",
        inputs: { requirement: objective }
      });
    }
    // Default fallback single capability
    else {
      steps.push({
        id: "step_1_default",
        description: "Execute general capability task",
        capability: "document.create",
        inputs: { filename: `task_result_${Date.now()}.txt`, content: objective }
      });
    }

    return { objective, steps };
  }
}

module.exports = MissionAgent;
