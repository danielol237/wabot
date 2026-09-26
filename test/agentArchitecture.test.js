const test = require("node:test");
const assert = require("node:assert/strict");

const CapabilityRegistry = require("../src/agent/CapabilityRegistry").CapabilityRegistry;
const GoalRouter = require("../src/agent/GoalRouter");
const MissionAgent = require("../src/agent/MissionAgent");
const SecurityAssessmentCapability = require("../src/agent/SecurityAssessmentCapability");

test("CapabilityRegistry registers and discovers capabilities", () => {
  const registry = new CapabilityRegistry();
  registry.register({
    name: "test.cap",
    description: "Sample test capability",
    implementation: async () => ({ ok: true })
  });

  const cap = registry.get("test.cap");
  assert.equal(cap.name, "test.cap");

  const discovered = registry.discover("Sample");
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].name, "test.cap");
});

test("GoalRouter correctly classifies intent", () => {
  const router = new GoalRouter();

  const conv = router.classifyIntent("hello how are you?");
  assert.equal(conv.type, "CONVERSATIONAL");

  const pfp = router.classifyIntent("set profile picture to this image");
  assert.equal(pfp.type, "DIRECT_CAPABILITY");

  const mission = router.classifyIntent("inspect my app https://frog-vibes.vercel.app, find security issues and write a report");
  assert.equal(mission.type, "MISSION");
});

test("SecurityAssessmentCapability executes passive assessment", async () => {
  const sec = new SecurityAssessmentCapability();
  const res = await sec.runAssessment({ targetUrl: "https://example.com", policy: "PASSIVE" });

  assert.equal(res.success, true);
  assert.equal(typeof res.report, "string");
  assert.ok(res.evidence.length > 0);
});

test("MissionAgent executes multi-step security mission and produces artifact", async () => {
  const agent = new MissionAgent();
  const missionRes = await agent.executeMission("pentest my app https://example.com and create a report");

  assert.equal(missionRes.success, true);
  assert.equal(missionRes.stepsExecuted, 2);
  assert.ok(missionRes.artifacts.length > 0);
});
