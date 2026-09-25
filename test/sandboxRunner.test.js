const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const BuildVerifier = require("../src/coding/verification/BuildVerifier");

test("BuildVerifier checks package build in workspace", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-sandbox-test-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "aria-sandbox-fixture", version: "1.0.0", scripts: { build: "node -e \"process.stdout.write('ok')\"" } }));
    const verifier = new BuildVerifier(dir);
    const result = await verifier.verifyBuild();
    assert.equal(result.success, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
