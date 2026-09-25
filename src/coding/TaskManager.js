// Asynchronous Task Manager with Real State Progress Updates
const EventEmitter = require("events");
const TaskStore = require("./state/TaskStore");
const { TASK_STATES, TERMINAL_STATES } = require("./state/TaskState");
const { log, warn, error } = require("../utils/logger");

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

  submitTask(payload) {
    const task = this.store.createTask(payload);
    this.queue.push(task.id);
    this.emit("task.created", task);
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

    this.emit("task.cancelled", { id, reason });
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
      if (step === "discovery_started") this.store.updateTask(task.id, { status: TASK_STATES.DISCOVERING });
      else if (step === "planning_started") this.store.updateTask(task.id, { status: TASK_STATES.PLANNING });
      else if (step === "plan_validated") this.store.updateTask(task.id, { status: TASK_STATES.PLAN_VALIDATED });
      else if (step === "execution_started") this.store.updateTask(task.id, { status: TASK_STATES.EXECUTING });
      else if (step === "testing_started") this.store.updateTask(task.id, { status: TASK_STATES.TESTING });
      else if (step === "reviewing_started") this.store.updateTask(task.id, { status: TASK_STATES.REVIEWING });
      else if (step === "repairing_attempt") this.store.updateTask(task.id, { status: TASK_STATES.REPAIRING });
      else if (step === "verification_completed") this.store.updateTask(task.id, { status: TASK_STATES.VERIFYING });

      this.emit("task.progress", { taskId: task.id, ...event });
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
      this.emit("task.started", task);
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
        this.emit("task.failed", { taskId: task.id, result });
      } else {
        this.store.updateTask(task.id, {
          status: TASK_STATES.COMPLETED,
          evidence: result?.evidence || null,
          filesChanged: result?.filesChanged || task.filesChanged,
          verification: result?.verification || task.verification,
        });
        this.emit("task.completed", { taskId: task.id, result });
      }
    } catch (err) {
      const isCancel = err.message === "TASK_CANCELLED";
      const finalState = isCancel ? TASK_STATES.CANCELLED : TASK_STATES.FAILED;

      this.store.updateTask(task.id, {
        status: finalState,
        blockedReason: err.message,
        errors: [...(task.errors || []), err.message],
      });

      this.emit(isCancel ? "task.cancelled" : "task.failed", {
        taskId: task.id,
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
