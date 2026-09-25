const test = require("node:test");
const assert = require("node:assert/strict");

const StickerRegistry = require("../src/tools/stickers/StickerRegistry");
const StickerSelector = require("../src/tools/stickers/StickerSelector");
const StickerContext = require("../src/tools/stickers/StickerContext");

test("StickerRegistry validates emotion categories", () => {
  const registry = new StickerRegistry();
  assert.equal(registry.isValidCategory("happy"), true);
  assert.equal(registry.isValidCategory("victory"), true);
  assert.equal(registry.isValidCategory("unknown_cat"), false);
});

test("StickerContext analyzes emotion and intensity", () => {
  const ctxAnalyzer = new StickerContext();
  const c1 = ctxAnalyzer.analyzeContext("Yay we won the match!");
  assert.equal(c1.emotion, "celebrating");

  const c2 = ctxAnalyzer.analyzeContext("Build and tests completed!");
  assert.equal(c2.emotion, "victory");
});

test("StickerSelector respects cooldowns per chat", () => {
  const selector = new StickerSelector();
  const res1 = selector.selectSticker("Yay completed!", { chatId: "chat_1" });
  assert.ok(res1);

  // Immediate second call should be blocked by cooldown
  const res2 = selector.selectSticker("Yay completed!", { chatId: "chat_1" });
  assert.equal(res2, null);

  // Different chat should succeed
  const res3 = selector.selectSticker("Yay completed!", { chatId: "chat_2" });
  assert.ok(res3);
});
