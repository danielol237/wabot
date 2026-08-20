const test = require("node:test");
const assert = require("node:assert/strict");

const venice = require("../src/tools/veniceMedia");

test("Venice adapter: normalizes binary image responses", () => {
  const payload = Buffer.from([137, 80, 78, 71, 13, 10]);
  const parsed = venice._test.parsePayload(payload);
  assert.deepEqual(parsed, { buffer: payload });
  assert.deepEqual(venice._test.extractImage(parsed), { buffer: payload, mimetype: "image/png" });
});

test("Venice adapter: normalizes base64 and URL image payloads", () => {
  const base64 = Buffer.from("valid-image-bytes").toString("base64");
  const fromBase64 = venice._test.extractImage({ images: [{ b64_json: base64 }] });
  assert.equal(fromBase64.buffer.toString(), "valid-image-bytes");
  assert.deepEqual(venice._test.extractImage({ data: [{ url: "https://cdn.example/image.png" }] }), { url: "https://cdn.example/image.png" });
});

test("Venice adapter: does not claim configuration when the key is absent", () => {
  const previous = process.env.VENICE_API_KEY;
  delete process.env.VENICE_API_KEY;
  delete require.cache[require.resolve("../src/tools/veniceMedia")];
  const fresh = require("../src/tools/veniceMedia");
  assert.equal(fresh.configured(), false);
  return (async () => {
    const result = await fresh.generateImage("test prompt");
    assert.equal(result.success, false);
    assert.match(result.error, /not configured/i);
    if (previous === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = previous;
  })();
});

test("Venice adapter: bounds provider errors without leaking authorization", () => {
  const error = { response: { status: 401, data: { message: "invalid api key SECRET_VALUE" } } };
  const message = venice._test.safeError(error);
  assert.match(message, /HTTP 401/);
  assert.doesNotMatch(message, /Bearer|Authorization/i);
  assert.ok(message.length < 600);
});
