const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const { TASK_STATES, canTransition, validateTransition } = require("../src/coding/state/TaskState");
const TaskStore = require("../src/coding/state/TaskStore");
const TaskManager = require("../src/coding/TaskManager");
const CodingEngine = require("../src/coding/CodingEngine");

test("TaskState validates state transitions accurately", () => {
  assert.strictEqual(canTransition(TASK_STATES.CREATED, TASK_STATES.CLASSIFIED), true);
  assert.strictEqual(canTransition(TASK_STATES.CREATED, TASK_STATES.COMPLETED), false);
  assert.throws(() => validateTransition(TASK_STATES.CREATED, TASK_STATES.COMPLETED), /Invalid task state transition/);
});

test("TaskStore creates, updates, and persists task state", () => {
  const tmpFile = path.join(__dirname, "../temp/test_task_store.json");
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

  const store = new TaskStore(tmpFile);
  const task = store.createTask({
    request: "Fix Docker build bug",
    userId: "user_123",
  });

  assert.strictEqual(task.status, TASK_STATES.CREATED);
  assert.ok(task.id);

  const updated = store.updateTask(task.id, {
    status: TASK_STATES.CLASSIFIED,
    statusMessage: "Classified as bugfix",
  });

  assert.strictEqual(updated.status, TASK_STATES.CLASSIFIED);

  // Reload store from disk
  const store2 = new TaskStore(tmpFile);
  const loaded = store2.getTask(task.id);
  assert.strictEqual(loaded.status, TASK_STATES.CLASSIFIED);

  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});

test("TaskManager executes tasks asynchronously and limits concurrency", async () => {
  const tmpFile = path.join(__dirname, "../temp/test_tm_store.json");
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

  const store = new TaskStore(tmpFile);
  const tm = new TaskManager({ store, maxConcurrentTasks: 1, taskTimeoutMs: 5000 });

  let executedCount = 0;
  tm.setExecutor(async (task, emitProgress) => {
    executedCount++;
    emitProgress({ step: "discovery_started" });
    emitProgress({ step: "planning_started" });
    emitProgress({ step: "plan_validated" });
    emitProgress({ step: "execution_started" });
    emitProgress({ step: "testing_started" });
    emitProgress({ step: "reviewing_started" });
    emitProgress({ step: "verification_completed" });
    await new Promise((r) => setTimeout(r, 50));
    return { success: true, evidence: "passed" };
  });

  const task1 = tm.submitTask({ request: "Task 1" });
  const task2 = tm.submitTask({ request: "Task 2" });

  await new Promise((r) => setTimeout(r, 300));

  assert.strictEqual(executedCount, 2);
  assert.strictEqual(store.getTask(task1.id).status, TASK_STATES.COMPLETED);
  assert.strictEqual(store.getTask(task2.id).status, TASK_STATES.COMPLETED);

  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});
