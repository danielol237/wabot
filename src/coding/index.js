// Single Coding Subsystem Singleton Service
const CodingEngine = require("./CodingEngine");
const TaskRouter = require("./TaskRouter");
const ResultFormatter = require("./reporting/ResultFormatter");
const { log, error } = require("../utils/logger");

class CodingSubsystem {
  constructor() {
    this.engine = new CodingEngine();
    this.router = new TaskRouter();
    this.formatter = new ResultFormatter();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    await this.engine.initialize();

    // Register pipeline execution function in engine
    this.engine.setPipelineExecutor(async (task, emitProgress) => {
      const provider = this.router.selectProvider(task.request, {
        preferredProvider: task.provider === "auto" ? null : task.provider,
      });

      log(`[CodingSubsystem] Executing task ${task.id} with provider ${provider.id}`);
      return await provider.executeTask(task, emitProgress);
    });

    this.initialized = true;
  }

  isCodingRequest(text) {
    return this.router.isCodingRequest(text);
  }

  async handleCodingRequest(userRequest, options = {}) {
    await this.initialize();
    const task = this.engine.submitRequest(userRequest, options);
    return {
      taskId: task.id,
      status: task.status,
      message: `⚡ *ARIA Coding Task Started*\n\nTask ID: \`${task.id}\`\nRequest: "${userRequest}"\nStatus: ${task.status}\n\nARIA is processing this software engineering task in the background.`,
    };
  }

  getTaskResult(taskId) {
    const task = this.engine.getTask(taskId);
    if (!task) return null;

    if (task.status === "COMPLETED") {
      return this.formatter.formatCompleted(task);
    } else if (task.status === "BLOCKED") {
      return this.formatter.formatBlocked(task);
    } else if (task.status === "FAILED") {
      return this.formatter.formatFailed(task);
    }

    return `⚡ *ARIA Coding Task Progress*\n\nTask ID: \`${task.id}\`\nStatus: ${task.status}\nPhase: ${task.phase}`;
  }
}

module.exports = new CodingSubsystem();
