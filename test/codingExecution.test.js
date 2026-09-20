const test = require("node:test");
const assert = require("node:assert/strict");

const actionTask = require("../src/tools/actionTask");
const capabilities = require("../src/utils/capabilityCatalog");

test("coding action tasks complete dependent steps and expose truthful summaries", async () => {
  const task = actionTask.createTask({
    type: "test.build",
    goal: "verify task execution",
    steps: [
      { id: "plan", label: "Plan" },
      { id: "verify", label: "Verify", dependsOn: ["plan"] },
    ],
  });
  const plan = await actionTask.runStep(task, "plan", async () => ({ files: 2 }), { verify: (value) => value.files === 2 });
  const verify = await actionTask.runStep(task, "verify", async () => ({ checks: 3 }), { verify: (value) => value.checks === 3 });
  actionTask.finish(task);
  const summary = actionTask.summary(task);
  assert.equal(plan.state, actionTask.STATES.COMPLETED);
  assert.equal(verify.state, actionTask.STATES.COMPLETED);
  assert.equal(summary.state, actionTask.STATES.COMPLETED);
  assert.deepEqual(summary.steps.map((step) => step.state), ["COMPLETED", "COMPLETED"]);
});

test("coding action tasks skip dependent steps after a failed prerequisite", async () => {
  const task = actionTask.createTask({
    type: "test.failure",
    goal: "verify dependency failure",
    steps: [
      { id: "generate", label: "Generate" },
      { id: "deploy", label: "Deploy", dependsOn: ["generate"] },
    ],
  });
  const failed = await actionTask.runStep(task, "generate", async () => { throw new Error("generator unavailable"); });
  const skipped = actionTask.getTask(task.id).steps.find((step) => step.id === "deploy");
  actionTask.finish(task);
  assert.equal(failed.state, actionTask.STATES.FAILED);
  assert.equal(skipped.state, actionTask.STATES.SKIPPED);
  assert.equal(actionTask.summary(task).state, actionTask.STATES.FAILED);
});

test("capability inspection reports actual runtime tools and connector configuration", () => {
  const report = capabilities.inspectEnvironment();
  assert.equal(typeof report.checkedAt, "string");
  assert.equal(typeof report.tools.git.available, "boolean");
  assert.equal(typeof report.tools.chromium.available, "boolean");
  assert.equal(Array.isArray(report.connectors), true);
  assert.ok(report.connectors.some((connector) => connector.name === "GITHUB_TOKEN"));
  assert.equal(typeof report.storage.filesystem, "boolean");
});
