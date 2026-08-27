const test = require("node:test");
const assert = require("node:assert/strict");
const { runOperation, isRetryableError } = require("../src/utils/operationGuard");

test("operation guard retries a transient failure and returns the recovered result", async () => {
  let calls = 0;
  const result = await runOperation("test:recovery", async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error("temporary network failure");
      error.code = "ECONNRESET";
      throw error;
    }
    return "ok";
  }, { attempts: 2, timeoutMs: 1000 });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("operation guard times out bounded work", async () => {
  await assert.rejects(
    runOperation("test:timeout", () => new Promise(() => {}), { attempts: 1, timeoutMs: 20 }),
    /timed out/i,
  );
});

test("operation guard classifies provider throttling and network errors as retryable", () => {
  assert.equal(isRetryableError({ response: { status: 429 } }), true);
  assert.equal(isRetryableError({ code: "ETIMEDOUT", message: "timeout" }), true);
  assert.equal(isRetryableError({ response: { status: 400 }, message: "bad request" }), false);
});
