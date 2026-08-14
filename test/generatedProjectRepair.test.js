const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { repairGeneratedProject, hasProviderFailureText } = require("../src/tools/generatedProjectRepair");

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aria-generated-"));
}

test("generated-project repair removes ESM type when generated files use CommonJS", () => {
  const dir = tempProject();
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module", scripts: {} }));
  fs.writeFileSync(path.join(dir, "server.js"), "const express = require('express'); module.exports = express();");
  const result = repairGeneratedProject(dir, ["package.json", "server.js"]);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  assert.equal(pkg.type, undefined);
  assert.equal(pkg.scripts.start, "node server.js");
  assert.ok(result.fixes.length >= 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("generated-project repair rejects raw provider failures as deliverables", () => {
  assert.equal(hasProviderFailureText("❌ AI request failed on all providers. Last error: User not found."), true);
  const dir = tempProject();
  fs.writeFileSync(path.join(dir, "styles.css"), "❌ AI request failed on all providers. Last error: User not found.");
  const result = repairGeneratedProject(dir, ["styles.css"]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].file, "styles.css");
  fs.rmSync(dir, { recursive: true, force: true });
});
