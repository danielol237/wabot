const test = require("node:test");
const assert = require("node:assert/strict");
const ResultFormatter = require("../src/coding/reporting/ResultFormatter");
const router = require("../src/utils/commandRouter");

test("ResultFormatter formats verified project evidence", () => {
  const formatter = new ResultFormatter();
  const report = formatter.formatCompleted({
    id: "task_123",
    title: "ARIA Portfolio",
    provider: "Local",
    filesChanged: ["index.html"],
    verification: ["Build passed", "HTTP 200 responded"]
  });
  assert.match(report, /ARIA Coding Agent Completed Task/);
  assert.match(report, /ARIA Portfolio/);
  assert.match(report, /Build passed/);
});

test("natural build/deliver request resolves to deliver command", () => {
  const action = router.resolveNaturalAction("build a website and give me the link for a portfolio");
  assert.equal(action?.intent, "deliver");
});
