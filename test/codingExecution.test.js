const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { test } = require("node:test");

const ExecutionPolicy = require("../src/coding/security/ExecutionPolicy");
const WorkspacePolicy = require("../src/coding/security/WorkspacePolicy");
const FileManager = require("../src/coding/execution/FileManager");
const CommandRunner = require("../src/coding/execution/CommandRunner");
const GitManager = require("../src/coding/execution/GitManager");

test("ExecutionPolicy enforces permissions and path safety", () => {
  const policy = new ExecutionPolicy(process.cwd());

  assert.strictEqual(policy.isPathSafe("package.json"), true);
  assert.strictEqual(policy.isPathSafe(".env"), false);
  assert.strictEqual(policy.isPathSafe("../../etc/passwd"), false);

  const readPerm = policy.checkPermission("READ");
  assert.strictEqual(readPerm.allowed, true);

  const pushPerm = policy.checkPermission("GIT_PUSH");
  assert.strictEqual(pushPerm.allowed, false);
  assert.strictEqual(pushPerm.requiresAuthorization, true);
});

test("FileManager reads and writes files within workspace sandbox", () => {
  const fm = new FileManager(process.cwd());
  const testPath = "temp/security_test.txt";

  fm.writeFile(testPath, "hello world");
  assert.strictEqual(fm.fileExists(testPath), true);
  assert.strictEqual(fm.readFile(testPath), "hello world");

  assert.throws(() => fm.readFile(".env"), /Security policy denied read access/);

  if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
});

test("CommandRunner executes commands with timeout and output limits", async () => {
  const runner = new CommandRunner(process.cwd());
  const res = await runner.runCommand("node -e \"console.log('test')\"");

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.stdout.trim(), "test");
});

test("GitManager inspects git status and head commit", async () => {
  const git = new GitManager(process.cwd());
  const status = await git.getStatus();

  assert.strictEqual(status.ok, true);
  const head = await git.getHeadCommit();
  assert.ok(head);
});
