const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveNaturalAction } = require("../src/utils/commandRouter");
const ResultFormatter = require("../src/coding/reporting/ResultFormatter");

test("successful build results are formatted for humans instead of serialized JSON", () => {
  const formatter = new ResultFormatter();
  const text = formatter.formatCompleted({
    id: "task_123",
    title: "barbershop website",
    provider: "Local",
    filesChanged: ["index.html", "style.css"],
    verification: ["Build passed", "HTTP 200 responded"],
  });
  assert.match(text, /ARIA Coding Agent Completed Task/);
  assert.match(text, /barbershop website/);
  assert.doesNotMatch(text, /\{"success"/);
});

test("successful build without deployment does not invent a public link", () => {
  const formatter = new ResultFormatter();
  const text = formatter.formatCompleted({
    id: "task_123",
    title: "barbershop website",
    provider: "Local",
    filesChanged: ["index.html"],
    verification: ["Build passed"],
  });
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
