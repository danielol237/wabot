const test = require("node:test");
const assert = require("node:assert/strict");
const ExecutionPolicy = require("../src/coding/security/ExecutionPolicy");
const RequirementAnalyzer = require("../src/coding/planning/RequirementAnalyzer");

test("ExecutionPolicy classifies operations into read/write/execute/secrets", () => {
  const policy = new ExecutionPolicy();
  assert.equal(policy.classifyCommand("git status"), "READ");
  assert.equal(policy.classifyCommand("ls -la"), "READ");
  assert.equal(policy.classifyCommand("rm -rf /"), "DESTRUCTIVE");
  assert.equal(policy.classifyCommand("git reset --hard"), "DESTRUCTIVE");
});

test("RequirementAnalyzer classifies engineering requests and assigns risk levels", () => {
  const analyzer = new RequirementAnalyzer();
  const res = analyzer.analyze("Build a React landing page for a coffee shop");
  assert.ok(res.type);
  assert.ok(res.riskLevel);
});
