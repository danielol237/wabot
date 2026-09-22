const { test } = require("node:test");
const assert = require("node:assert/strict");
const { detectIntent, resolveNaturalAction, naturalArgs, _test } = require("../src/utils/commandRouter");

test("natural image requests resolve without a prefix", () => {
  assert.equal(detectIntent("generate a pic of a dog"), "image");
  const action = resolveNaturalAction("generate a pic of a dog");
  assert.equal(action.intent, "image");
  assert.equal(action.args, "a dog");
});

test("natural image requests keep pronoun prompts for quoted-context expansion", () => {
  assert.equal(detectIntent("generate a picture of it"), "image");
  assert.equal(naturalArgs("image", "generate a picture of it"), "it");
});

test("ordinary conversation does not get hijacked by the image handler", () => {
  assert.equal(detectIntent("I generated a picture yesterday"), null);
});

test("natural hosting request resolves to the protected deployment action", () => {
  assert.equal(detectIntent("host it"), "deploy");
  const action = resolveNaturalAction("host it");
  assert.equal(action.intent, "deploy");
  assert.equal(action.command.ownerOnly, true);
});

test("automatic media routing detects supported social video links", () => {
  assert.equal(_test.detectAutoMediaLink("https://youtu.be/demo"), "https://youtu.be/demo");
  assert.equal(_test.detectAutoMediaLink("check this https://www.tiktok.com/@aria/video/123"), "https://www.tiktok.com/@aria/video/123");
  assert.equal(_test.detectAutoMediaLink("https://www.facebook.com/reel/123"), "https://www.facebook.com/reel/123");
  assert.equal(_test.detectAutoMediaLink("https://pin.it/demo"), "https://pin.it/demo");
  assert.equal(_test.detectAutoMediaLink("https://example.com/article"), null);
});
