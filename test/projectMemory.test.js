const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-memory-"));
process.env.ARIA_PROJECT_DATA_DIR = tempDir;
const state = require("../src/tools/projectState");

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
});

test("project memory resolves named sites and preserves revisions and deployments", () => {
  const project = state.createProject("chat-memory-test", "Build a restaurant website", [{ path: "index.html", description: "Restaurant landing page" }], { workflow: "autonomous" });
  state.markFileStatus(project.id, 0, "done", "<!doctype html><title>Harbor Table</title>");
  state.setProjectStatus(project.id, "done");
  state.recordRevision(project.id, "polish", "Improved the hero and menu layout", ["index.html"]);
  state.recordDeployment(project.id, { provider: "vercel", url: "https://harbor-table.example", target: "preview", state: "ready" });

  const resolved = state.resolveProjectForChat("chat-memory-test", "the restaurant website");
  assert.equal(resolved.id, project.id);
  assert.equal(resolved.name, "restaurant website");
  assert.equal(resolved.revision, 1);
  assert.equal(resolved.deployment.url, "https://harbor-table.example");
  assert.equal(state.getFileContent(project.id, "index.html"), "<!doctype html><title>Harbor Table</title>");
  assert.equal(state.getProgress(resolved).percent, 100);
});
