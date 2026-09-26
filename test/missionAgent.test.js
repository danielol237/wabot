const test = require("node:test");
const assert = require("node:assert/strict");
const goalRouter = require("../src/agent/GoalRouter");
const capabilityRegistry = require("../src/agent/CapabilityRegistry");
const MissionAgent = require("../src/agent/MissionAgent");
const ArtifactManager = require("../src/agent/ArtifactManager");
const SecurityAssessmentCapability = require("../src/agent/SecurityAssessmentCapability");

test("GoalRouter classifies requests accurately", () => {
  assert.equal(goalRouter.classifyGoal("hello").type, "CONVERSATIONAL");
  assert.equal(goalRouter.classifyGoal("show git status").type, "DIRECT_CAPABILITY");
  assert.equal(goalRouter.classifyGoal("Inspect my repo, find failing tests, fix them, and commit").type, "MISSION");
});

test("CapabilityRegistry lists registered capabilities", () => {
  const caps = capabilityRegistry.listCapabilities();
  assert.ok(caps.length >= 8);
  assert.ok(capabilityRegistry.hasCapability("terminal.execute"));
  assert.ok(capabilityRegistry.hasCapability("coding.modify"));
  assert.ok(capabilityRegistry.hasCapability("git.status"));
});

test("ArtifactManager creates and retrieves artifacts", () => {
  const am = new ArtifactManager();
  const art = am.createArtifact("test_report.md", "# Report Content", "md");
  assert.ok(art.artifactId);
  assert.equal(art.filename, "test_report.md");

  const retrieved = am.getArtifact("test_report.md");
  assert.ok(retrieved);
  assert.equal(retrieved.content, "# Report Content");
});

test("SecurityAssessmentCapability performs passive scanning safely", async () => {
  const sec = new SecurityAssessmentCapability();
  const scan = await sec.runPassiveScan("https://example.com");
  assert.equal(scan.success, true);
  assert.equal(scan.scanType, "PASSIVE");
});

test("MissionAgent composes plan and executes end-to-end mission", async () => {
  const agent = new MissionAgent();
  const result = await agent.executeMission("Check why the server isn’t starting");
  assert.equal(result.success, true);
  assert.ok(result.results.length >= 2);
});
