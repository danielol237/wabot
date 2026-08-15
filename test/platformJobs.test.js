const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-platform-jobs-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
const jobs = require("../src/core/jobs");

test("platform jobs: enqueue is idempotent and due jobs can be claimed/completed", async () => {
  const first = jobs.enqueue({ tenantId: "ten_test", type: "test.success", runAt: new Date(Date.now() - 1000).toISOString(), idempotencyKey: "job-1" });
  const duplicate = jobs.enqueue({ tenantId: "ten_test", type: "test.success", runAt: new Date(Date.now() - 1000).toISOString(), idempotencyKey: "job-1" });
  assert.equal(first.id, duplicate.id);
  assert.equal(duplicate.duplicate, true);
  const claimed = jobs.claim({ workerId: "test-worker" });
  assert.equal(claimed.id, first.id);
  const result = await jobs.runOnce({ handlers: { "test.success": async (job) => ({ jobId: job.id, ok: true }) }, workerId: "test-worker-2", now: Date.now() + 1000 });
  // The first job is already leased, so runOnce should not process it again.
  assert.equal(result.processed, false);
  const completed = jobs.complete(first.id, { workerId: "test-worker", result: { ok: true } });
  assert.equal(completed.status, "completed");
});

test("platform jobs: failed work retries until max attempts then becomes failed", () => {
  const job = jobs.enqueue({ tenantId: "ten_test", type: "test.fail", runAt: new Date(Date.now() - 1000).toISOString(), maxAttempts: 1 });
  const claimed = jobs.claim({ workerId: "failure-worker" });
  assert.equal(claimed.id, job.id);
  const failed = jobs.fail(job.id, { workerId: "failure-worker", error: "expected failure" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastError, "expected failure");
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("platform jobs: background follow-up handler records approval without sending", async () => {
  const taskPoller = require("../src/tools/taskPoller");
  const job = jobs.enqueue({ tenantId: "ten_test", type: "business.followup.due", payload: { followupId: "fup_test" }, runAt: new Date(Date.now() - 1000).toISOString() });
  const result = await taskPoller.runPlatformJobs();
  assert.equal(result.processed, true);
  assert.equal(result.job.id, job.id);
  assert.equal(result.job.status, "completed");
  assert.equal(result.job.result.outboundSent, false);
  assert.equal(result.job.result.approvalRequired, true);
});
