const test = require("node:test");
const assert = require("node:assert/strict");
const { inspectSystem, formatInspection, _test } = require("../src/tools/engineeringSystem");

test("engineering path policy allows source files and rejects traversal or secret paths", () => {
  assert.equal(_test.safeRelativePath("src/tools/example.js"), "src/tools/example.js");
  assert.equal(_test.safeRelativePath("test/example.test.js"), "test/example.test.js");
  assert.equal(_test.safeRelativePath("../.env"), null);
  assert.equal(_test.safeRelativePath(".env"), null);
  assert.equal(_test.safeRelativePath("data/private.json"), null);
  assert.equal(_test.safeRelativePath(".github/workflows/deploy.yml"), null);
  assert.equal(_test.safeRelativePath("/src/index.js"), "src/index.js");
});

test("engineering plan normalization bounds files and preserves required metadata", () => {
  const plan = _test.normalizePlan({
    summary: "Improve self-inspection",
    files: [
      { path: "src/tools/engineeringSystem.js", description: "Engineering controller" },
      { path: "../secrets.txt", description: "Forbidden" },
      { path: "plugins/example.js", description: "Plugin" },
    ],
    tests: ["npm test"],
    risks: ["Generated code needs review"],
    rollback: "Close the PR",
  }, "Improve ARIA");
  assert.equal(plan.files.length, 2);
  assert.equal(plan.files[0].path, "src/tools/engineeringSystem.js");
  assert.equal(plan.objective, "Improve ARIA");
  assert.deepEqual(plan.tests, ["npm test"]);
});

test("system inventory is honest about main-write and production controls", () => {
  const report = inspectSystem();
  assert.equal(report.repository, "danielol237/wabot");
  assert.equal(report.providers.gpt5, true);
  assert.equal(report.controls.directMainWrites, false);
  assert.equal(report.controls.pullRequestRequired, true);
  assert.equal(report.controls.secretsReadFromEnvironmentOnly, true);
  assert.match(formatInspection(report), /Direct main writes: blocked/);
  assert.match(formatInspection(report), /Pull request required: yes/);
});

test("repository selection rejects malformed overrides", () => {
  const previous = process.env.ARIA_ENGINEERING_REPO;
  process.env.ARIA_ENGINEERING_REPO = "not a repository";
  assert.equal(_test.repositoryName(), "danielol237/wabot");
  if (previous === undefined) delete process.env.ARIA_ENGINEERING_REPO;
  else process.env.ARIA_ENGINEERING_REPO = previous;
});
