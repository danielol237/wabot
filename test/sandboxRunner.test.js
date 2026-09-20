const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sandbox = require("../src/tools/codingAgent/sandboxRunner");

test("coding-agent package verification is sandboxed or explicitly refuses unsafe fallback", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-sandbox-test-"));
  const previous = process.env.ARIA_ALLOW_UNSANDBOXED_BUILDS;
  delete process.env.ARIA_ALLOW_UNSANDBOXED_BUILDS;
  try {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "node -e \"process.stdout.write('ok')\"" } }));
    const result = await sandbox.verifyPackageInSandbox(dir);
    if (sandbox.dockerAvailable()) assert.equal(result.success, true, result.error);
    else assert.match(result.error, /Docker sandbox is unavailable/);
  } finally {
    if (previous === undefined) delete process.env.ARIA_ALLOW_UNSANDBOXED_BUILDS;
    else process.env.ARIA_ALLOW_UNSANDBOXED_BUILDS = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
