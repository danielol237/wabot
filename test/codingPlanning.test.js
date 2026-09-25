const assert = require("assert");
const { test } = require("node:test");

const RequirementAnalyzer = require("../src/coding/planning/RequirementAnalyzer");
const ArchitectureAnalyzer = require("../src/coding/planning/ArchitectureAnalyzer");
const PlanGenerator = require("../src/coding/planning/PlanGenerator");
const PlanValidator = require("../src/coding/planning/PlanValidator");

test("RequirementAnalyzer classifies request and assigns risk level", () => {
  const analyzer = new RequirementAnalyzer();
  const res = analyzer.analyze("Fix authentication bug in session handler");

  assert.strictEqual(res.type, "bugfix");
  assert.strictEqual(res.riskLevel, "high");
  assert.ok(res.acceptanceCriteria.length > 0);
});

test("PlanGenerator and PlanValidator create and validate executable plans", () => {
  const reqAnalyzer = new RequirementAnalyzer();
  const req = reqAnalyzer.analyze("Fix Docker detection bug");

  const archAnalyzer = new ArchitectureAnalyzer();
  const arch = archAnalyzer.analyze(req, {
    discovery: { projectType: "nodejs", scripts: { test: "node --test" } },
    relevantFiles: [{ path: "src/utils/taskClassifier.js" }],
  });

  const generator = new PlanGenerator();
  const plan = generator.generatePlan(req, arch);

  const validator = new PlanValidator();
  const val = validator.validate(plan, {
    discovery: { projectType: "nodejs", scripts: { test: "node --test" } },
  });

  assert.strictEqual(val.valid, true);
  assert.ok(val.plan.steps.length >= 3);
});

test("PlanValidator reports explicit PLAN_BLOCKED reason when invalid", () => {
  const validator = new PlanValidator();
  const val = validator.validate({ steps: [] }, { discovery: { projectType: "generic" } });

  assert.strictEqual(val.valid, false);
  assert.strictEqual(val.reason, "PLAN_BLOCKED");
  assert.ok(val.errors.length > 0);
  assert.ok(val.evidence);
});
