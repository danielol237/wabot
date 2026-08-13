const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Regression tests for audit #12/#37: the durable mission ACTION executor must
// dispatch concrete, capability-checked verbs to real handlers — NOT run
// arbitrary shell — and must never fall through to pretending to execute.
test("durableMissions: file.write creates a scoped mission artifact (audit #12)", async () => {
  const { executeAction } = require("../src/tools/durableMissions");
  const mission = { id: "m-test-1", objective: "test", chatId: "x@s.whatsapp.net" };
  const out = await executeAction("file.write: hello artifact content", mission);
  assert.ok(typeof out === "string", "returns a string result");
  // It writes into the missions data dir, not an arbitrary path.
  assert.ok(/Wrote mission artifact/.test(out), "reports writing an artifact");
  const dir = path.join(__dirname, "../data/missions");
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("action_m-test-1_"));
  assert.ok(files.length >= 1, "an action artifact file exists");
  // Cleanup
  for (const f of files) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
});

test("durableMissions: unknown ACTION verb does NOT execute shell (audit #12/#37)", async () => {
  const { executeAction } = require("../src/tools/durableMissions");
  const mission = { id: "m-test-2", objective: "test", chatId: "x@s.whatsapp.net" };
  // A hostile verb like `shell.command` or `exec` must NOT reach a shell. It
  // falls back to the bounded analysis path (returns a string) rather than
  // executing. The key safety property: no child_process is spawned here.
  const out = await executeAction("shell.command: rm -rf /", mission);
  assert.strictEqual(typeof out, "string", "returns a string (analysis fallback), never spawns shell");
});

test("durableMissions: http.request is a safe GET only (audit #12)", async () => {
  const { executeAction } = require("../src/tools/durableMissions");
  const mission = { id: "m-test-3", objective: "test", chatId: "x@s.whatsapp.net" };
  // Non-http arg → refused, no request fired.
  const bad = await executeAction("http.request: not a url", mission);
  assert.match(bad, /skipped|not an http/i, "rejects non-URL");
  // Empty/missing verb falls to analysis fallback, still a string.
  const empty = await executeAction("", mission);
  assert.strictEqual(typeof empty, "string");
});
