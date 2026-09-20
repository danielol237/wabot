const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { repairGeneratedProject, hasProviderFailureText } = require("../src/tools/generatedProjectRepair");
const { checkProject } = require("../src/tools/websiteQuality");

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

test("generated frontend repair fixes missing CSS contracts, metadata, and starter copy", () => {
  const dir = tempProject();
  try {
    fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html lang="en"><head><title>Portfolio</title></head><body><main class="hero-section project-tags contact-email site-footer"><h1>Build Something Great</h1><p>Contact us at example.com</p></main></body></html>`);
    fs.writeFileSync(path.join(dir, "style.css"), ".contact-link { color: red; }\n");
    const result = repairGeneratedProject(dir, ["index.html", "style.css"]);
    assert.equal(result.failures.length, 0);
    assert.ok(result.fixes.some((fix) => /CSS contracts/.test(fix)));
    assert.ok(result.fixes.some((fix) => /meta description/.test(fix)));
    assert.ok(result.fixes.some((fix) => /starter copy/.test(fix)));
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    const css = fs.readFileSync(path.join(dir, "style.css"), "utf8");
    assert.match(html, /meta name="description"/);
    assert.doesNotMatch(html, /Build Something Great|example\.com/);
    assert.match(css, /\.hero-section\s*\{/);
    assert.match(css, /\.contact-email\s*\{/);
    assert.deepEqual(checkProject(dir, ["index.html", "style.css"]).blocking, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("generated dashboard repair reconciles navigation ids and section selectors", () => {
  const dir = tempProject();
  try {
    fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html lang="en"><head><title>Workspace</title><meta name="viewport" content="width=device-width"></head><body><nav><a href="#dashboard">Dashboard</a><a href="#deployments">Deployments</a><a href="#settings">Settings</a></nav><main><h1>Workspace</h1></main><script src="app.js"></script></body></html>`);
    fs.writeFileSync(path.join(dir, "style.css"), ".nav { display: flex; }\n");
    fs.writeFileSync(path.join(dir, "app.js"), "const sections = document.querySelectorAll('.dashboard-section'); sections.forEach((section) => section.classList.add('ready'));\n");
    const result = repairGeneratedProject(dir, ["index.html", "style.css", "app.js"]);
    assert.equal(result.failures.length, 0);
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    assert.match(html, /id="dashboard"/);
    assert.match(html, /id="deployments"/);
    assert.match(html, /id="settings"/);
    assert.match(html, /class="dashboard-section"/);
    assert.equal(checkProject(dir, ["index.html", "style.css", "app.js"]).blocking.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
