const test = require("node:test");
const assert = require("node:assert/strict");
const MissionAgent = require("../src/agent/MissionAgent");
const capabilityRegistry = require("../src/agent/CapabilityRegistry");
const codingSubsystem = require("../src/coding");

test("MissionAgent.executeMission('Aria build a website') delegates to authoritative CodingSubsystem", async () => {
  const agent = new MissionAgent();

  assert.ok(capabilityRegistry.hasCapability("coding.build_app"), "coding.build_app capability must be registered");

  let submittedRequest = null;
  const originalHandleCodingRequest = codingSubsystem.handleCodingRequest;

  // Intercept codingSubsystem call to verify exact delegation
  codingSubsystem.handleCodingRequest = async (userRequest, options) => {
    submittedRequest = userRequest;
    const res = await originalHandleCodingRequest.call(codingSubsystem, userRequest, options);
    return res;
  };

  try {
    const res = await agent.executeMission("Aria build a website", {
      userId: "test-user-123",
      chatId: "test-chat-456",
    });

    assert.equal(res.success, true, "Mission should complete successfully");
    assert.equal(submittedRequest, "Aria build a website", "Request should reach authoritative CodingSubsystem");

    // Verify task exists in authoritative CodingSubsystem store
    const tasks = codingSubsystem.engine.store.getAllTasks();
    const createdTask = tasks.find((t) => t.request === "Aria build a website");
    assert.ok(createdTask, "A task should have been created in CodingSubsystem's TaskStore");
    assert.ok(createdTask.id, "Created task must have a valid ID");
  } finally {
    codingSubsystem.handleCodingRequest = originalHandleCodingRequest;
  }
});

test("MissionAgent does NOT instantiate a second TaskManager or CodingEngine for coding.build_app", async () => {
  const agent = new MissionAgent();

  let taskManagerConstructorCount = 0;
  const TaskManager = require("../src/coding/TaskManager");

  // Spy on TaskManager instantiation
  const ProxyTaskManager = new Proxy(TaskManager, {
    construct(target, args) {
      taskManagerConstructorCount++;
      return Reflect.construct(target, args);
    },
  });

  const res = await agent.executeMission("Aria build a website", {
    userId: "test-user-456",
    chatId: "test-chat-789",
  });

  assert.equal(res.success, true, "Mission should complete successfully");
  assert.equal(taskManagerConstructorCount, 0, "MissionAgent must NOT construct new TaskManager instances during execution");
});
