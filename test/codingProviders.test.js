const assert = require("assert");
const { test } = require("node:test");

const JulesProvider = require("../src/coding/providers/JulesProvider");
const LocalCodingProvider = require("../src/coding/providers/LocalCodingProvider");
const TaskRouter = require("../src/coding/TaskRouter");

test("TaskRouter routes coding requests to Jules or Local based on availability", () => {
  const router = new TaskRouter();

  assert.strictEqual(router.isCodingRequest("Fix the Docker detection bug in taskClassifier.js"), true);
  assert.strictEqual(router.isCodingRequest("What is Docker?"), false);

  const provider = router.selectProvider("Fix bug");
  assert.ok(provider.id === "jules" || provider.id === "local");
});

test("LocalCodingProvider executes local discovery and planning loop", async () => {
  const local = new LocalCodingProvider(process.cwd());
  assert.strictEqual(local.isAvailable(), true);

  const res = await local.executeTask({ request: "Fix Docker detection bug" });
  assert.strictEqual(res.success, true);
  assert.ok(res.verification.length > 0);
});
