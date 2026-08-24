const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("../src/tools/vercelDeploy");

test("Vercel URL extraction handles CLI ANSI output and supported hostnames", () => {
  const output = "Deploying...\u001b[32mhttps://aria-preview.vercel.app\u001b[0m\nhttps://aria-preview.vercel.sh";
  assert.equal(_test.extractDeploymentUrl(output), "https://aria-preview.vercel.sh");
  assert.equal(_test.extractDeploymentUrl("done: https://vercel.com/acme/project"), "https://vercel.com/acme/project");
});

test("Vercel project names are normalized and bounded", () => {
  assert.equal(_test.sanitizeProjectName("My ARIA Site 2026"), "my-aria-site-2026");
  assert.equal(_test.sanitizeProjectName("!!!"), "aria-project");
  assert.ok(_test.sanitizeProjectName("x".repeat(100)).length <= 40);
});

test("Vercel diagnostics redact the runtime token", () => {
  const previous = process.env.VERCEL_TOKEN;
  process.env.VERCEL_TOKEN = "vercel-secret-for-test";
  assert.equal(_test.redact("failure vercel-secret-for-test"), "failure [redacted]");
  if (previous === undefined) delete process.env.VERCEL_TOKEN;
  else process.env.VERCEL_TOKEN = previous;
});

test("Vercel deployment names retain a project-specific suffix", () => {
  const a = _test.deploymentName("A polished marketing site", "project_alpha");
  const b = _test.deploymentName("A polished marketing site", "project_beta");
  assert.notEqual(a, b);
  assert.ok(a.length <= 40);
  assert.ok(b.length <= 40);
});

test("Vercel file collection rejects symlinks", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-vercel-files-"));
  try {
    fs.writeFileSync(path.join(dir, "index.html"), "<main>ok</main>");
    fs.symlinkSync("/etc/passwd", path.join(dir, "leak.txt"));
    assert.throws(() => _test.safeFiles(dir), /symbolic links/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
