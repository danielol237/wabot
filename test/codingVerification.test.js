const assert = require("assert");
const { test } = require("node:test");

const VerificationEngine = require("../src/coding/verification/VerificationEngine");
const DiffAnalyzer = require("../src/coding/verification/DiffAnalyzer");

test("DiffAnalyzer inspects local workspace diffs", async () => {
  const analyzer = new DiffAnalyzer(process.cwd());
  const diff = await analyzer.analyzeDiff();

  assert.ok(diff !== null);
  assert.ok(Array.isArray(diff.changedFiles));
});

test("VerificationEngine orchestrates multi-layer verification checks", async () => {
  const engine = new VerificationEngine(process.cwd());
  const res = await engine.verify();

  assert.strictEqual(res.verified, true);
  assert.ok(res.diff);
});
