const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const profile = require("../src/tools/capabilityProfile");

test("capability comparison questions are detected", () => {
  assert.equal(profile.isCapabilityQuestion("What can you do that Axon can't?"), true);
  assert.equal(profile.isCapabilityQuestion("tell me a joke"), false);
});

test("capability report highlights verified differences without bluffing", () => {
  const report = profile.formatCapabilityReport();
  assert.match(report, /persistent memory/i);
  assert.match(report, /full website\/app generation/i);
  assert.match(report, /can(?:’|')t inspect another assistant(?:’|')s private implementation/i);
  assert.match(report, /I won’t bluff about/i);
});

test("humanizer contains no configurable delayed-reply path", () => {
  const source = fs.readFileSync(require.resolve("../src/tools/humanizer"), "utf8");
  assert.equal(source.includes("ARIA_HUMANIZER_DELAY"), false);
  assert.equal(source.includes("setTimeout"), false);
  assert.equal(source.includes("randomDelayMs"), false);
});
