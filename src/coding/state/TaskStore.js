// Persistent Store for Coding Tasks and Jules Sessions
const fs = require("fs");
const path = require("path");
const { TASK_STATES, validateTransition } = require("./TaskState");
const { log, error } = require("../../utils/logger");

const DATA_DIR = path.join(__dirname, "../../../data");
const STORE_FILE = path.join(DATA_DIR, "codingTasks.json");

function ensureDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function sanitizeData(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeData);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/token|secret|password|api_?key|auth|bearer|cookie/i.test(k) && typeof v === "string") {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object") {
      out[k] = sanitizeData(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class TaskStore {
  constructor(filePath = STORE_FILE) {
    this.filePath = filePath;
    this.tasks = new Map();
    this.load();
  }

  load() {
    ensureDirectory();
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const task of parsed) {
            if (task && task.id) {
              this.tasks.set(task.id, task);
            }
          }
        }
      }
    } catch (err) {
      error(`[TaskStore] Failed to load tasks from disk: ${err.message}`);
    }
  }

  save() {
    ensureDirectory();
    try {
      const data = Array.from(this.tasks.values());
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      error(`[TaskStore] Atomic save failed: ${err.message}`);
    }
  }

  createTask(payload) {
    const now = new Date().toISOString();
    const id = payload.id || `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const task = {
      id,
      userId: payload.userId || "anonymous",
      chatId: payload.chatId || null,
      request: payload.request || "",
      type: payload.type || "feature", // feature, bugfix, debug, refactor, test, research
      title: payload.title || payload.request?.slice(0, 80) || "Coding Task",
      repository: payload.repository || "local",
      branch: payload.branch || "main",
      baseCommit: payload.baseCommit || null,
      provider: payload.provider || "local",
      providerSessionId: payload.providerSessionId || null,
      providerActivityId: payload.providerActivityId || null,
      status: TASK_STATES.CREATED,
      phase: TASK_STATES.CREATED,
      requirements: payload.requirements || [],
      constraints: payload.constraints || [],
      acceptanceCriteria: payload.acceptanceCriteria || [],
      plan: [],
      checkpoints: [],
      filesChanged: [],
      tests: [],
      verification: [],
      errors: [],
      repairAttempts: 0,
      maxRepairAttempts: payload.maxRepairAttempts || 3,
      events: [
        {
          timestamp: now,
          state: TASK_STATES.CREATED,
          message: "Task created and persisted.",
        },
      ],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      evidence: null,
      blockedReason: null,
    };

    this.tasks.set(id, task);
    this.save();
    return task;
  }

  getTask(id) {
    return this.tasks.get(id) || null;
  }

  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  updateTask(id, patch) {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    const now = new Date().toISOString();

    if (patch.status && patch.status !== task.status) {
      validateTransition(task.status, patch.status);
      task.events.push({
        timestamp: now,
        state: patch.status,
        message: patch.statusMessage || `Transitioned to ${patch.status}`,
      });
      task.status = patch.status;
      task.phase = patch.phase || patch.status;
    }

    if (patch.plan) task.plan = patch.plan;
    if (patch.checkpoints) task.checkpoints = patch.checkpoints;
    if (patch.filesChanged) task.filesChanged = patch.filesChanged;
    if (patch.tests) task.tests = patch.tests;
    if (patch.verification) task.verification = patch.verification;
    if (patch.errors) task.errors = patch.errors;
    if (patch.evidence !== undefined) task.evidence = patch.evidence;
    if (patch.blockedReason !== undefined) task.blockedReason = patch.blockedReason;
    if (patch.providerSessionId) task.providerSessionId = patch.providerSessionId;
    if (patch.providerActivityId) task.providerActivityId = patch.providerActivityId;
    if (patch.baseCommit) task.baseCommit = patch.baseCommit;
    if (patch.repairAttempts !== undefined) task.repairAttempts = patch.repairAttempts;

    task.updatedAt = now;
    if ([TASK_STATES.COMPLETED, TASK_STATES.FAILED, TASK_STATES.CANCELLED].includes(task.status)) {
      task.completedAt = now;
    }

    this.save();
    return task;
  }

  listTasks(filter = {}) {
    let list = Array.from(this.tasks.values());
    if (filter.chatId) list = list.filter((t) => t.chatId === filter.chatId);
    if (filter.status) list = list.filter((t) => t.status === filter.status);
    if (filter.userId) list = list.filter((t) => t.userId === filter.userId);
    return list;
  }

  deleteTask(id) {
    const deleted = this.tasks.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  appendEvent(id, eventData) {
    const task = this.getTask(id);
    if (!task) return null;
    if (!Array.isArray(task.events)) task.events = [];
    const event = {
      timestamp: new Date().toISOString(),
      ...sanitizeData(eventData),
    };
    task.events.push(event);
    task.updatedAt = event.timestamp;
    this.save();
    return event;
  }

  addCheckpoint(id, name, data = {}) {
    const task = this.getTask(id);
    if (!task) return null;
    const checkpoint = {
      id: `cp_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      name,
      state: task.status,
      data: sanitizeData(data),
    };
    task.checkpoints.push(checkpoint);
    task.updatedAt = checkpoint.timestamp;
    this.save();
    return checkpoint;
  }
}

module.exports = TaskStore;
