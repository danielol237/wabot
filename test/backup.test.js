// Backup system tests.
const test = require("node:test");
const assert = require("node:assert");
const { execFile } = require("child_process");

test("backup: createBackup produces a zip of data + plugins", async () => {
  const bs = require("../src/tools/backupSystem");
  const r = await bs.createBackup();
  assert.ok(r.success, "backup succeeded");
  assert.ok(r.filePath.endsWith(".zip"), "produces a zip");
  try { require("fs").unlinkSync(r.filePath); } catch (_) {}
});

test("backup: backupToGist returns graceful failure without GITHUB_TOKEN", async () => {
  const bs = require("../src/tools/backupSystem");
  delete process.env.GITHUB_TOKEN;
  const r = await bs.backupToGist();
  assert.strictEqual(r.success, false);
  assert.ok(/GITHUB_TOKEN/.test(r.error), "mentions missing token");
});
