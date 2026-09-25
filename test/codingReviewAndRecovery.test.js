const assert = require("assert");
const { test } = require("node:test");

const Critic = require("../src/coding/review/Critic");
const RepairEngine = require("../src/coding/recovery/RepairEngine");

test("Critic identifies defects when tests fail or no files are changed", () => {
  const critic = new Critic();

  const passedReview = critic.review({}, { diff: { hasChanges: true, changedFiles: ["a.js"] }, testResult: { success: true } });
  assert.strictEqual(passedReview.approved, true);

  const failedReview = critic.review({}, { diff: { hasChanges: false, changedFiles: [] }, testResult: { success: false, exitCode: 1 } });
  assert.strictEqual(failedReview.approved, false);
  assert.ok(failedReview.findings.length >= 1);
});

test("RepairEngine bounds self-repair attempts to maxAttempts limit", async () => {
  const mockVerifier = {
    verify: async () => ({ diff: { hasChanges: false, changedFiles: [] }, testResult: { success: false } }),
  };

  const repairEngine = new RepairEngine(process.cwd(), 2, mockVerifier);
  let repairCalls = 0;

  const res = await repairEngine.runRepairLoop(
    { id: "task_test" },
    { diff: { hasChanges: false, changedFiles: [] }, testResult: { success: false } },
    async () => {
      repairCalls++;
    }
  );

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.attempts, 2);
  assert.strictEqual(repairCalls, 2);
});
