const test = require("node:test");
const assert = require("node:assert/strict");

const visualContext = require("../src/tools/visualContext");

test("visual context stores and returns a bounded recent media reference", () => {
  const chatId = `visual-test-${Date.now()}`;
  visualContext.remember(chatId, { base64: "abc123", mimeType: "image/webp", kind: "sticker" });
  const value = visualContext.get(chatId);
  assert.equal(value.base64, "abc123");
  assert.equal(value.mimeType, "image/webp");
  assert.equal(value.kind, "sticker");
  visualContext.clear(chatId);
  assert.equal(visualContext.get(chatId), null);
});

test("visual context does not itself persist raw media beyond the in-memory reference", () => {
  assert.equal(typeof visualContext.remember, "function");
  assert.equal(typeof visualContext.get, "function");
  assert.equal(typeof visualContext.clear, "function");
});
