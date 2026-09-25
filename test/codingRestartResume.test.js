const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const CodingEngine = require("../src/coding/CodingEngine");
const TaskStore = require("../src/coding/state/TaskStore");
const { TASK_STATES } = require("../src/coding/state/TaskState");

test("Restart-Resume: persisted task reloads and resumes execution after ARIA restart", async () => {
  const storeFile = path.join(__dirname, "../temp/restart_test_store.json");
  if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);

  // 1. Initial engine run - task gets submitted and stepped through valid transitions
  const store1 = new TaskStore(storeFile);
  const task = store1.createTask({
    id: "task_restart_100",
    request: "Fix authentication bug",
    userId: "test_user",
  });

  store1.updateTask(task.id, { status: TASK_STATES.CLASSIFIED });
  store1.updateTask(task.id, { status: TASK_STATES.DISCOVERING });
  store1.updateTask(task.id, { status: TASK_STATES.PLANNING });
  store1.updateTask(task.id, { status: TASK_STATES.PLAN_VALIDATED });
  store1.updateTask(task.id, { status: TASK_STATES.EXECUTING });

  // 2. Simulate ARIA restart with new Engine/Store instance
  const engine2 = new CodingEngine({ taskStoreFile: storeFile });
  await engine2.initialize();

  const recoveredTask = engine2.getTask("task_restart_100");
  assert.ok(recoveredTask);
  assert.strictEqual(recoveredTask.status, TASK_STATES.PAUSED);

  if (fs.existsSync(storeFile)) fs.unlinkSync(storeFile);
});
