const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveNaturalAction, _test } = require("../src/utils/commandRouter");
const { formatDeliveryReport } = require("../src/tools/deliveryWorkflow");

test("successful build results are formatted for humans instead of serialized JSON", () => {
  const text = _test.formatBuildResult({ success: true, projectId: "project_ab12cd34", projectName: "barbershop", fileCount: 8, verificationState: "VALID", buildVerification: "passed", browserSmoke: { success: true, skipped: true } });
  assert.match(text, /Project built and verified/);
  assert.match(text, /barbershop/);
  assert.match(text, /static fallback used/);
  assert.doesNotMatch(text, /\{"success"/);
  assert.doesNotMatch(text, /zipPath|projectValidation|repairFixes/);
});

test("successful build without deployment does not invent a public link", () => {
  const text = _test.formatBuildResult({ success: true, projectId: "project_ab12cd34", fileCount: 4, buildVerification: "passed" });
  assert.match(text, /no public link exists until it is deployed/i);
  assert.doesNotMatch(text, /https?:\/\//);
});

test("specific website requests preserve build intent for handler-level delivery escalation", () => {
  const specific = resolveNaturalAction("ARIA, build a website for a barbershop with prices and booking");
  const vague = resolveNaturalAction("ARIA, build a website");
  assert.equal(specific.intent, "build");
  assert.match(specific.args, /barbershop/i);
  assert.equal(vague.intent, "build");
  assert.equal(vague.args, "website");
});

test("delivery report never claims a live workflow without a real deployment URL", () => {
  const text = formatDeliveryReport({ project: { projectName: "demo", verificationState: "VALID", fileCount: 4 } });
  assert.match(text, /built and verified the project locally/i);
  assert.match(text, /No public URL was created/i);
  assert.doesNotMatch(text, /finished the delivery workflow/i);
});
