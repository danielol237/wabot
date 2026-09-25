// Main Coding Engine Entry Point & Subsystem Facade
const TaskStore = require("./state/TaskStore");
const TaskManager = require("./TaskManager");
const { log, error } = require("../utils/logger");

class CodingEngine {
  constructor(options = {}) {
    this.store = options.store || new TaskStore(options.taskStoreFile);
    this.taskManager = new TaskManager({
      store: this.store,
      maxConcurrentTasks: options.maxConcurrentTasks || Number(process.env.ARIA_MAX_CODING_TASKS || 1),
      taskTimeoutMs: options.taskTimeoutMs || Number(process.env.ARIA_CODING_TASK_TIMEOUT_MS || 15 * 60 * 1000),
    });
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    await this.taskManager.recoverPendingTasks();
    this.initialized = true;
    log("[CodingEngine] Coding Engine initialized successfully.");
  }

  setPipelineExecutor(executorFn) {
    this.taskManager.setExecutor(executorFn);
  }

  submitRequest(userRequest, options = {}) {
    const payload = {
      userId: options.userId || "anonymous",
      chatId: options.chatId || null,
      request: userRequest,
      type: options.type || "feature",
      repository: options.repository || "local",
      branch: options.branch || "main",
      requirements: options.requirements || [],
      constraints: options.constraints || [],
      acceptanceCriteria: options.acceptanceCriteria || [],
      provider: options.provider || "auto",
    };

    const task = this.taskManager.submitTask(payload);
    log(`[CodingEngine] Submitted coding task ${task.id} for request: "${userRequest.slice(0, 50)}..."`);
    return task;
  }

  getTask(taskId) {
    return this.taskManager.getTask(taskId);
  }

  cancelTask(taskId, reason) {
    return this.taskManager.cancelTask(taskId, reason);
  }

  getTasksForChat(chatId) {
    return this.store.getAllTasks().filter((t) => t.chatId === chatId);
  }
}

module.exports = CodingEngine;
