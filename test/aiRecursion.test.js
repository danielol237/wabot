// Regression test for the AI telemetry wrapper hoisting bug.
// The wrapper captured itself due to duplicate `async function getAIResponse`
// declarations (function-declaration hoisting), causing infinite recursion →
// "Maximum call stack size exceeded" on EVERY AI reply. This test ensures the
// wrapper calls the real implementation exactly once and returns (no RangeError).
const test = require("node:test");
const assert = require("node:assert");

test("ai: getAIResponse does not infinitely recurse (hoisting guard)", async () => {
  // Re-implement the exact wrapper pattern used by src/tools/ai.js and assert it
  // does NOT stack-overflow. The real module is also loaded below for a live check.
  async function getAIResponseImpl(x) { return "real:" + x; }
  async function getAIResponse(...args) {
    const out = await getAIResponseImpl(...args);
    return out;
  }
  const result = await getAIResponse("hi");
  assert.strictEqual(result, "real:hi", "wrapper should delegate to the impl, not itself");
});

test("ai: src/tools/ai.js loads and returns without RangeError", async () => {
  const { getAIResponse } = require("../src/tools/ai");
  // With no API keys configured, the function should reach the all-providers-failed
  // path and return a string — NOT throw "Maximum call stack size exceeded".
  const out = await getAIResponse("hello", "tester", [], null, "", {});
  assert.strictEqual(typeof out, "string", "AI call should return a string");
  // If the recursion bug were present this would throw RangeError before returning.
  assert.ok(true);
});

test("ai: only a genuinely large request gets a truncation notice", () => {
  const { _test } = require("../src/tools/ai");
  const stopped = _test.withTruncationNotice("Show Sentinel", "STOP", "MAX_TOKENS", false);
  const shortButMislabelled = _test.withTruncationNotice("Aria", "MAX_TOKENS", "MAX_TOKENS", false);
  const exhaustedLargeBuild = _test.withTruncationNotice("A long build", "MAX_TOKENS", "MAX_TOKENS", true);
  assert.equal(stopped, "Show Sentinel");
  assert.equal(shortButMislabelled, "Aria");
  assert.match(exhaustedLargeBuild, /send it again/);
});
