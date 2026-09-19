const test = require("node:test");
const assert = require("node:assert/strict");

const { listCapabilities, getCapability, operationResult } = require("../src/utils/capabilityCatalog");
const { learnFact, getFacts } = require("../src/utils/learnedFacts");
const { addPreference, getPreferences } = require("../src/utils/userPreferences");

const id = `test_${process.pid}_${Date.now()}`;

test("capability catalog describes real memory, build, deployment, and engineering seams", () => {
  const names = listCapabilities().map((capability) => capability.name);
  assert.deepEqual(names, ["memory.write", "memory.read", "project.build", "project.deploy", "project.deliver", "engineering.inspect"]);
  assert.equal(getCapability("project.deploy").outputSchema.verified, "boolean");
});

test("operation results use explicit truthful states", () => {
  const result = operationResult({ capability: "project.deploy", state: "SUCCEEDED", output: { url: "https://example.test" }, evidence: ["healthz:200"] });
  assert.equal(result.state, "SUCCEEDED");
  assert.deepEqual(result.evidence, ["healthz:200"]);
  assert.equal(operationResult({ capability: "project.deploy", state: "invented" }).state, "FAILED");
});

test("memory and preference writes return persistence confirmation and can be retrieved", () => {
  const fact = `prefers durable test memory ${id}`;
  const factResult = learnFact(id, fact);
  assert.equal(factResult.persisted, true);
  assert.ok(getFacts(id).includes(fact));

  const preference = `uses test preference ${id}`;
  const preferenceResult = addPreference(id, preference);
  assert.equal(preferenceResult.persisted, true);
  assert.ok(getPreferences(id).includes(preference));
});
