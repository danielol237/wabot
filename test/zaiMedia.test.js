const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const harness = path.join(__dirname, "fixtures", "zaiMediaHarness.js");

function run(mode) {
  const result = spawnSync(process.execPath, [harness, mode], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, ZHIPU_API_KEY: "", ZHIPU_BASE_URL: "https://api.z.ai/api/paas/v4" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("Z.AI adapter reports missing configuration honestly", () => {
  assert.deepEqual(run("config"), { configured: false });
  const result = run("missing");
  assert.equal(result.success, false);
  assert.match(result.error, /Z\.AI media provider is not configured/);
});

test("Z.AI image generation accepts direct URLs and async task results", () => {
  const direct = run("image-direct");
  assert.equal(direct.success, true);
  assert.equal(direct.provider, "zai");
  assert.equal(direct.kind, "image");
  assert.equal(direct.url, "https://cdn.example/image.png");

  const asyncResult = run("image-async");
  assert.equal(asyncResult.success, true);
  assert.equal(asyncResult.taskId, "image-task-1");
  assert.equal(asyncResult.url, "https://cdn.example/image-async.png");
});

test("Z.AI video generation polls the async result and vision returns text", () => {
  const video = run("video");
  assert.equal(video.success, true);
  assert.equal(video.kind, "video");
  assert.equal(video.url, "https://cdn.example/video.mp4");

  const vision = run("vision");
  assert.equal(vision.success, true);
  assert.equal(vision.kind, "vision");
  assert.match(vision.text, /orbital ribbon/);
});

test("Z.AI adapter returns bounded, non-secret errors", () => {
  const result = run("failure");
  assert.equal(result.success, false);
  assert.match(result.error, /HTTP 401: invalid key/);
  assert.doesNotMatch(result.error, /test-zai-key/);
});
