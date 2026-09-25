// Asynchronous Task Manager with Real State Progress Updates & EventBus Emission
const EventEmitter = require("events");
const TaskStore = require("./state/TaskStore");
const { TASK_STATES, TERMINAL_STATES } = require("./state/TaskState");
const { log, warn, error } = require("../utils/logger");
const ariaEventBus = require("../utils/eventBus");
const executionLogger = require("./logging/ExecutionLogger");

class TaskManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.store = options.store || new TaskStore();
    this.maxConcurrentTasks = options.maxConcurrentTasks || Number(process.env.ARIA_MAX_CODING_TASKS || 1);
    this.taskTimeoutMs = options.taskTimeoutMs || Number(process.env.ARIA_CODING_TASK_TIMEOUT_MS || 15 * 60 * 1000);
    this.runningTasks = new Map();
    this.queue = [];
    this.executor = options.executor || null;
  }

  setExecutor(executor) {
    this.executor = executor;
  }

  async recoverPendingTasks() {
    log("[TaskManager] Checking for orphaned / interrupted tasks on startup...");
    const allTasks = this.store.getAllTasks();
    const pending = allTasks.filter(
      (t) => !TERMINAL_STATES.has(t.status) && t.status !== TASK_STATES.CREATED
    );

    for (const task of pending) {
      log(`[TaskManager] Recovering interrupted task ${task.id} (status: ${task.status})`);
      if ([TASK_STATES.EXECUTING, TASK_STATES.TESTING, TASK_STATES.REPAIRING, TASK_STATES.VERIFYING].includes(task.status)) {
        this.store.updateTask(task.id, {
          status: TASK_STATES.PAUSED,
          statusMessage: "Task paused due to ARIA restart; ready to resume.",
        });
      }
    }
  }

  broadcast(eventType, payload) {
    this.emit(eventType, payload);
    try {
      ariaEventBus.emitEvent(eventType, payload);
    } catch (_) {}
    executionLogger.logEvent({
      taskId: payload?.taskId || payload?.id,
      stage: payload?.status || payload?.step || eventType,
      message: payload?.request || payload?.message || `Event: ${eventType}`,
    });
  }

  submitTask(payload) {
    const task = this.store.createTask(payload);
    this.queue.push(task.id);
    this.broadcast("task.created", task);
    this.processQueue();
    return task;
  }

  getTask(id) {
    return this.store.getTask(id);
  }

  cancelTask(id, reason = "Cancelled by user") {
    const task = this.store.getTask(id);
    if (!task) return false;

    if (TERMINAL_STATES.has(task.status)) {
      return false;
    }

    const idx = this.queue.indexOf(id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }

    if (this.runningTasks.has(id)) {
      const running = this.runningTasks.get(id);
      if (running.cancelFn) {
        try { running.cancelFn(); } catch (_) {}
      }
      clearTimeout(running.timeoutTimer);
      this.runningTasks.delete(id);
    }

    this.store.updateTask(id, {
      status: TASK_STATES.CANCELLED,
      statusMessage: reason,
      blockedReason: reason,
    });

    this.broadcast("task.cancelled", { taskId: id, id, reason });
    this.processQueue();
    return true;
  }

  async processQueue() {
    while (this.runningTasks.size < this.maxConcurrentTasks && this.queue.length > 0) {
      const taskId = this.queue.shift();
      const task = this.store.getTask(taskId);
      if (!task || TERMINAL_STATES.has(task.status)) continue;
      void this.executeTask(task);
    }
  }

  async executeTask(task) {
    if (!this.executor) {
      error("[TaskManager] No executor registered for task execution.");
      this.store.updateTask(task.id, {
        status: TASK_STATES.FAILED,
        statusMessage: "No execution engine registered.",
      });
      this.processQueue();
      return;
    }

    if (task.status === TASK_STATES.CREATED) {
      this.store.updateTask(task.id, { status: TASK_STATES.CLASSIFIED });
      this.broadcast("task.classified", { taskId: task.id, status: TASK_STATES.CLASSIFIED });
    }

    let cancelCallback = null;
    const cancelPromise = new Promise((_, reject) => {
      cancelCallback = () => reject(new Error("TASK_CANCELLED"));
    });

    let timeoutTimer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new Error(`TASK_TIMEOUT: Task execution exceeded limit of ${this.taskTimeoutMs / 1000}s`));
      }, this.taskTimeoutMs);
    });

    const progressEmitter = (event) => {
      const step = event.step;
      let newStatus = null;
      if (step === "discovery_started") newStatus = TASK_STATES.DISCOVERING;
      else if (step === "planning_started") newStatus = TASK_STATES.PLANNING;
      else if (step === "plan_validated") newStatus = TASK_STATES.PLAN_VALIDATED;
      else if (step === "execution_started") newStatus = TASK_STATES.EXECUTING;
      else if (step === "testing_started") newStatus = TASK_STATES.TESTING;
      else if (step === "reviewing_started") newStatus = TASK_STATES.REVIEWING;
      else if (step === "repairing_attempt") newStatus = TASK_STATES.REPAIRING;
      else if (step === "verification_completed") newStatus = TASK_STATES.VERIFYING;

      if (newStatus) {
        this.store.updateTask(task.id, { status: newStatus, currentStep: step });
      }

      this.store.appendEvent(task.id, { step, ...event });
      this.broadcast("task.progress", { taskId: task.id, currentStep: step, status: newStatus || task.status, ...event });
    };

    const taskExecutionPromise = (async () => {
      return await this.executor(task, progressEmitter);
    })();

    this.runningTasks.set(task.id, {
      promise: taskExecutionPromise,
      cancelFn: cancelCallback,
      timeoutTimer,
      startedAt: Date.now(),
    });

    try {
      this.broadcast("task.started", task);
      const result = await Promise.race([
        taskExecutionPromise,
        cancelPromise,
        timeoutPromise,
      ]);

      if (result && (result.status === TASK_STATES.BLOCKED || result.success === false)) {
        const finalStatus = result.status === TASK_STATES.BLOCKED ? TASK_STATES.BLOCKED : TASK_STATES.FAILED;
        this.store.updateTask(task.id, {
          status: finalStatus,
          blockedReason: result.blockedReason || "Execution or verification failed.",
          evidence: result.evidence || null,
        });
        this.broadcast("task.failed", { taskId: task.id, status: finalStatus, result });
      } else {
        this.store.updateTask(task.id, {
          status: TASK_STATES.COMPLETED,
          evidence: result?.evidence || null,
          filesChanged: result?.filesChanged || task.filesChanged,
          verification: result?.verification || task.verification,
        });
        this.broadcast("task.completed", { taskId: task.id, status: TASK_STATES.COMPLETED, result });
      }
    } catch (err) {
      const isCancel = err.message === "TASK_CANCELLED";
      const finalState = isCancel ? TASK_STATES.CANCELLED : TASK_STATES.FAILED;

      this.store.updateTask(task.id, {
        status: finalState,
        blockedReason: err.message,
        errors: [...(task.errors || []), err.message],
      });

      this.broadcast(isCancel ? "task.cancelled" : "task.failed", {
        taskId: task.id,
        status: finalState,
        error: err.message,
      });
    } finally {
      clearTimeout(timeoutTimer);
      this.runningTasks.delete(task.id);
      this.processQueue();
    }
  }
}

module.exports = TaskManager;
