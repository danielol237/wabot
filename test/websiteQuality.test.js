const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { checkProject } = require("../src/tools/websiteQuality");
const WorkspacePolicy = require("../src/coding/security/WorkspacePolicy");

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

test("WorkspacePolicy prevents path traversal out of workspace", () => {
  const policy = new WorkspacePolicy("/tmp/workspace");
  assert.throws(() => policy.resolvePath("../secret"), /Path traversal denied/);
  assert.equal(policy.resolvePath("src/App.jsx"), path.resolve("/tmp/workspace/src/App.jsx"));
});

test("browser smoke renders the upgraded landing template", async () => {
  const { runBrowserSmoke } = require("../src/tools/browserSmoke");
  const result = await runBrowserSmoke(path.join(__dirname, "../src/templates/landing"), { timeoutMs: 30000 });
  assert.equal(result.success, true, result.error);
  assert.match(result.title, /Northstar/);
  assert.ok(result.textLength > 200);
});

test("browser smoke falls back to static validation when Chromium is unavailable", async () => {
  const { _test: smokeTest } = require("../src/tools/browserSmoke");
  const dir = fixture({
    "index.html": "<html><head><title>Static fallback</title></head><body><main><h1>ARIA project</h1><p>This page is valid without a browser executable.</p></main></body></html>",
  });
  try {
    const result = smokeTest.runStaticSmoke(dir, "simulated missing Chromium");
    assert.equal(result.success, true, result.error);
    assert.equal(result.skipped, true);
    assert.match(result.warning, /Chromium/);
    assert.ok(result.textLength > 20);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
