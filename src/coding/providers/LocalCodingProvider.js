// Local Agentic Software Engineering Provider with Real Code Modification and Critic/Repair Integration
const CodingProvider = require("./CodingProvider");
const ContextBuilder = require("../discovery/ContextBuilder");
const RequirementAnalyzer = require("../planning/RequirementAnalyzer");
const ArchitectureAnalyzer = require("../planning/ArchitectureAnalyzer");
const PlanGenerator = require("../planning/PlanGenerator");
const PlanValidator = require("../planning/PlanValidator");
const ToolExecutor = require("../execution/ToolExecutor");
const VerificationEngine = require("../verification/VerificationEngine");
const Critic = require("../review/Critic");
const RepairEngine = require("../recovery/RepairEngine");
const { generateCodingText } = require("../../tools/codingProvider");
const { log, warn, error } = require("../../utils/logger");

class LocalCodingProvider extends CodingProvider {
  constructor(workspacePath = process.cwd()) {
    super("local", "ARIA Autonomous Engineering Agent", [
      "repository_discovery",
      "planning",
      "file_editing",
      "command_execution",
      "testing",
      "verification",
      "self_repair",
    ]);
    this.workspacePath = workspacePath;
    this.toolExecutor = new ToolExecutor(workspacePath);
    this.verificationEngine = new VerificationEngine(workspacePath);
    this.critic = new Critic();
    this.repairEngine = new RepairEngine(workspacePath, 3, this.verificationEngine);
  }

  isAvailable() {
    return true;
  }

  async executeTask(taskPayload, progressCallback) {
    const notify = (step, detail = {}) => {
      log(`[LocalCodingProvider] ${step}`);
      if (progressCallback) progressCallback({ step, ...detail });
    };

    notify("discovery_started");
    const ctxBuilder = new ContextBuilder(this.workspacePath);
    const context = ctxBuilder.buildContext(taskPayload.request);

    notify("planning_started");
    const reqAnalyzer = new RequirementAnalyzer();
    const reqAnalysis = reqAnalyzer.analyze(taskPayload.request, context.discovery);

    const archAnalyzer = new ArchitectureAnalyzer();
    const archAnalysis = archAnalyzer.analyze(reqAnalysis, context);

    const planGen = new PlanGenerator();
    const rawPlan = planGen.generatePlan(reqAnalysis, archAnalysis);

    const validator = new PlanValidator();
    const planResult = validator.validate(rawPlan, context);

    if (!planResult.valid) {
      notify("plan_blocked", { planResult });
      return {
        success: false,
        status: "BLOCKED",
        blockedReason: planResult.reason,
        evidence: planResult,
      };
    }

    notify("plan_validated", { plan: planResult.plan });
    notify("execution_started");

    // Record base commit and initial state
    const headCommit = await this.toolExecutor.executeTool("run_command", { command: "git rev-parse HEAD" });

    // REAL CODE EDITING LOOP: Perform file modifications on target files if necessary
    for (const fileRelPath of archAnalysis.targetFiles) {
      if (this.toolExecutor.fileManager.fileExists(fileRelPath)) {
        try {
          const currentContent = this.toolExecutor.fileManager.readFile(fileRelPath);
          const prompt = `Request: ${taskPayload.request}\nFile: ${fileRelPath}\n\nCurrent Content:\n${currentContent}\n\nProduce the complete updated file content to satisfy the request. Return only the raw code.`;
          const response = await generateCodingText(prompt, { maxTokens: 4000, temperature: 0.1 });
          if (response && typeof response === "string" && response.length > 5) {
            const cleanedCode = response.replace(/^```[\w-]*\s*/i, "").replace(/\s*```$/i, "").trim();
            this.toolExecutor.fileManager.writeFile(fileRelPath, cleanedCode);
            notify("file_edited", { path: fileRelPath });
          }
        } catch (err) {
          warn(`[LocalCodingProvider] Prompt-assisted edit skipped for ${fileRelPath}: ${err.message}`);
        }
      }
    }

    notify("testing_started");
    // Perform multi-layer verification
    let initialVerification = await this.verificationEngine.verify({
      testScript: archAnalysis.testScript,
      buildScript: archAnalysis.buildScript,
    });

    notify("reviewing_started");
    // Run adversarial review & self-repair loop
    const repairResult = await this.repairEngine.runRepairLoop(
      taskPayload,
      initialVerification,
      async ({ attempt }) => {
        notify("repairing_attempt", { attempt });
      },
      {
        testScript: archAnalysis.testScript,
        buildScript: archAnalysis.buildScript,
      }
    );

    notify("verification_completed", { repairResult });

    if (!repairResult.success) {
      return {
        success: false,
        status: "FAILED",
        blockedReason: "Adversarial critic review or test verification failed after repair attempts.",
        evidence: repairResult,
      };
    }

    return {
      success: true,
      status: "COMPLETED",
      filesChanged: archAnalysis.targetFiles,
      verification: [
        `Base commit: ${headCommit.stdout?.trim() || "unknown"}`,
        `Tests: ${repairResult.verification.testResult ? (repairResult.verification.testResult.success ? "PASSED" : "FAILED") : "N/A"}`,
        `Critic review: PASSED`,
      ],
      evidence: repairResult,
    };
  }
}

module.exports = LocalCodingProvider;
