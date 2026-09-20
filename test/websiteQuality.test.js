const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { checkProject } = require("../src/tools/websiteQuality");
const { _test: builderTest } = require("../src/tools/appBuilder");

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-website-quality-"));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test("website quality gate blocks missing accessibility and broken DOM targets", () => {
  const dir = fixture({
    "index.html": "<html><head><title>Your Company</title><meta name=viewport content=width=device-width></head><body><img src=hero.png><button>Build Something Great</button><script src=app.js></script></body></html>",
    "style.css": ".hero { color: red; }",
    "app.js": "document.getElementById('missing').textContent = 'x';",
  });
  try {
    const result = checkProject(dir, ["index.html", "style.css", "app.js"]);
    assert.ok(result.blocking.length >= 3);
    assert.ok(result.blocking.some((item) => /placeholder|generic|alt/i.test(item.issue)));
    assert.ok(result.blocking.some((item) => /missing DOM selector/i.test(item.issue)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("website quality gate accepts a complete small landing page", () => {
  const dir = fixture({
    "index.html": "<html lang=\"en\"><head><meta name=\"viewport\" content=\"width=device-width\"><meta name=\"description\" content=\"A focused product site.\"><meta property=\"og:title\" content=\"Product\"><title>Product</title></head><body><main><h1>Product</h1><img src=hero.png alt=\"Product preview\"><button type=\"button\" id=\"cta\">Start</button></main><script src=app.js></script></body></html>",
    "style.css": ".hero { color: red; }",
    "app.js": "document.getElementById('cta').addEventListener('click', () => {});",
    "hero.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  try {
    const result = checkProject(dir, ["index.html", "style.css", "app.js", "hero.png"]);
    assert.equal(result.blocking.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("builder reserves mandatory files under a full planner budget", () => {
  const planned = Array.from({ length: 12 }, (_, i) => ({ path: `src/file${i}.js` }));
  const mandatory = ["package.json", "index.html", "vite.config.js", "README.md"].map((path) => ({ path }));
  const merged = builderTest.mergePlannedFiles(planned, mandatory);
  for (const required of mandatory) assert.ok(merged.some((file) => file.path === required.path));
  assert.ok(merged.length <= 12);
});

test("builder rejects absolute, traversal, and NUL-containing paths", () => {
  assert.equal(builderTest.safeRelativePath("src/App.jsx"), "src/App.jsx");
  assert.equal(builderTest.safeRelativePath("../secret"), null);
  assert.equal(builderTest.safeRelativePath("/etc/passwd"), null);
  assert.equal(builderTest.safeRelativePath("src/\0evil.js"), null);
});

test("browser smoke renders the upgraded landing template", async () => {
  const { runBrowserSmoke } = require("../src/tools/browserSmoke");
  const result = await runBrowserSmoke(path.join(__dirname, "../src/templates/landing"), { timeoutMs: 30000 });
  assert.equal(result.success, true, result.error);
  assert.match(result.title, /Northstar/);
  assert.ok(result.textLength > 200);
});

test("builder exposes complete verified starter fallback plans", async () => {
  assert.equal(builderTest.matchTemplate("make a focused product landing page"), "landing");
  const starter = await builderTest.scaffoldFromTemplate("make a todo app", "todo");
  assert.equal(starter.template, "todo");
  assert.deepEqual(starter.files.map((file) => file.path), ["index.html", "style.css", "script.js"]);
});

test("build flow runs all files without a continuation prompt or command", () => {
  const builderSource = fs.readFileSync(path.join(__dirname, "../src/tools/appBuilder.js"), "utf8");
  const routerSource = fs.readFileSync(path.join(__dirname, "../src/utils/commandRouter.js"), "utf8");
  assert.match(builderSource, /contract-first/);
  assert.match(builderSource, /executeBuild/);
  assert.doesNotMatch(builderSource, /continue the project|reply ["']continue["']/i);
  assert.doesNotMatch(routerSource, /name:\s*["']continue["']/);
});

test("autonomous builder identifies briefs that benefit from research", () => {
  assert.equal(builderTest.shouldResearchBuild("build an integrated farmer income solution"), true);
  assert.equal(builderTest.shouldResearchBuild("build a polished static landing page for a neighborhood coffee shop with a warm editorial visual system and accessible interactions"), false);
});
