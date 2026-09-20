const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const nativeMedia = require("../src/tools/nativeMedia");
const executor = require("../src/tools/capabilityExecutor");
const catalog = require("../src/utils/capabilityCatalog");

test("native media inspection and conversion stay local and verifiable", async () => {
  const input = await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 120, g: 40, b: 220, alpha: 1 } } }).png().toBuffer();
  const metadata = await nativeMedia.inspectImage(input);
  const converted = await nativeMedia.convertImage(input, { format: "webp", width: 2 });
  assert.equal(metadata.success, true);
  assert.equal(metadata.width, 3);
  assert.equal(metadata.height, 2);
  assert.equal(converted.success, true);
  assert.equal(converted.format, "webp");
  assert.ok(converted.sha256);
  assert.ok(Buffer.isBuffer(converted.buffer));
});

test("native runtime report exposes actual local media tools", () => {
  const runtime = nativeMedia.inspectLocalRuntimes();
  assert.equal(runtime.sharp, true);
  assert.equal(typeof runtime.ffmpeg, "boolean");
  assert.equal(typeof runtime.tesseract, "boolean");
  assert.equal(typeof runtime.espeak, "boolean");
});

test("capability discovery returns registered native media actions", () => {
  const found = executor.discoverCapabilities("sticker image");
  assert.ok(found.some((item) => item.name === "media.inspect_image"));
  assert.ok(found.some((item) => item.name === "media.convert_image"));
  assert.ok(catalog.getCapability("media.convert_image"));
});

test("multi-step capability plans pass outputs and fail truthfully", async () => {
  const input = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
  const result = await executor.executePlan({
    goal: "inspect then convert image",
    steps: [
      { id: "inspect", capability: "media.inspect_image", input: { buffer: input } },
      { id: "convert", capability: "media.convert_image", dependsOn: ["inspect"], input: { buffer: input, options: { format: "webp" } } },
    ],
  });
  assert.equal(result.state, "SUCCEEDED");
  assert.ok(result.output.convert.buffer);
  assert.equal(result.evidence.every((item) => item.state === "COMPLETED"), true);
});
