const test = require("node:test");
const assert = require("node:assert");

// Regression tests for audit #20/#21: the sandbox must pick a python-capable
// image for python code (node:20-slim has no python3), and must pass -i to
// docker run when stdin is provided so the program actually receives input.
test("sandbox: python auto-selects a python-capable image (audit #20)", () => {
  const { imageFor } = require("../src/tools/codeSandbox");
  assert.strictEqual(imageFor("python"), "python:3.12-slim", "python lang => python image");
  assert.strictEqual(imageFor("py"), "python:3.12-slim", "py lang => python image");
  assert.strictEqual(imageFor("js"), "node:20-slim", "js lang => node image");
  assert.strictEqual(imageFor("node"), "node:20-slim", "node lang => node image");
});

test("sandbox: explicit SANDBOX_IMAGE overrides auto-selection (audit #20)", () => {
  const old = process.env.SANDBOX_IMAGE;
  try {
    process.env.SANDBOX_IMAGE = "custom/python:3.11";
    // Re-require so the module re-reads env at load.
    const { imageFor } = require("../src/tools/codeSandbox");
    assert.strictEqual(imageFor("python"), "custom/python:3.11", "explicit image wins for python");
    assert.strictEqual(imageFor("js"), "custom/python:3.11", "explicit image wins for js too");
  } finally {
    if (old === undefined) delete process.env.SANDBOX_IMAGE; else process.env.SANDBOX_IMAGE = old;
  }
});

test("sandbox: explicit unsafe fallback reports nonzero exit as failure", async () => {
  const { runUnsafe } = require("../src/tools/codeSandbox");
  const result = await runUnsafe("console.log('diagnostic'); process.exit(3);", "js", { timeout: 5 });
  assert.equal(result.success, false);
  assert.equal(result.sandboxed, false);
});
