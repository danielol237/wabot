const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const harness = path.join(__dirname, "fixtures", "imageGenHarness.js");

function run(mode) {
  const result = spawnSync(process.execPath, [harness, mode], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("image generation: MiniMax URL is downloaded into a WhatsApp-ready buffer", () => {
  const result = run("minimax");
  assert.deepEqual(result, {
    success: true,
    provider: "minimax",
    hasBuffer: true,
    mimetype: "image/png",
    bytes: "png-bytes",
  });
});

test("image generation: no-key fallback uses a real GET and returns image bytes", () => {
  const result = run("pollinations");
  assert.deepEqual(result, {
    success: true,
    provider: "pollinations",
    hasBuffer: true,
    mimetype: "image/jpeg",
    bytes: "fallback-image",
  });
});
