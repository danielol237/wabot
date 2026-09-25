const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const CodingEngine = require("../src/coding/CodingEngine");
const TaskStore = require("../src/coding/state/TaskStore");
const LocalCodingProvider = require("../src/coding/providers/LocalCodingProvider");

test("Real E2E: Full coding engine lifecycle on real disposable workspace", async () => {
  const fixtureDir = path.join(__dirname, "../temp/fixture_proj");
  if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
  fs.mkdirSync(fixtureDir, { recursive: true });

  // Initialize disposable npm package fixture
  fs.writeFileSync(
    path.join(fixtureDir, "package.json"),
    JSON.stringify({ name: "fixture-app", version: "1.0.0", scripts: { test: "node --test" } })
  );

  fs.writeFileSync(
    path.join(fixtureDir, "index.js"),
    "function add(a, b) { return a + b; }\nmodule.exports = { add };"
  );

  fs.writeFileSync(
    path.join(fixtureDir, "test.js"),
    "const assert = require('assert'); const { test } = require('node:test'); const { add } = require('./index'); test('add', () => assert.strictEqual(add(1, 2), 3));"
  );

  const localProvider = new LocalCodingProvider(fixtureDir);
  const storeFile = path.join(fixtureDir, "tasks.json");
  const engine = new CodingEngine({ taskStoreFile: storeFile });

  engine.setPipelineExecutor(async (task, emitProgress) => {
    return await localProvider.executeTask(task, emitProgress);
  });

  await engine.initialize();

  // Submit task
  const task = engine.submitRequest("Fix bug in addition function", {
    userId: "test_dev",
  });

  assert.ok(task.id);

  // Wait for background execution completion
  await new Promise((r) => setTimeout(r, 500));

  const completedTask = engine.getTask(task.id);
  assert.strictEqual(completedTask.status, "COMPLETED");
  assert.ok(completedTask.verification.length > 0);

  // Cleanup
  if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
});
