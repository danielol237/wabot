const test = require("node:test");
const assert = require("node:assert/strict");

const vision = require("../src/tools/visionAI");

test("vision prompt makes bare stickers conversational instead of an object inventory", () => {
  const prompt = vision._test.buildVisionPrompt({ kind: "sticker", question: "" });
  assert.match(prompt, /reply naturally to the emotional or comedic meaning/i);
  assert.match(prompt, /Do not begin with “I see an image”/i);
  assert.match(prompt, /prioritize a genuine conversational reaction/i);
});

test("vision prompt switches to precise observation when the user asks what is shown", () => {
  const prompt = vision._test.buildVisionPrompt({ kind: "sticker", question: "What's in this sticker exactly?" });
  assert.match(prompt, /identify characters\/people, pose, facial expression/i);
  assert.match(prompt, /prioritize accurate observation over banter/i);
});

test("vision prompt explains media interpretation honestly", () => {
  const prompt = vision._test.buildVisionPrompt({ kind: "image", question: "How can you read this?" });
  assert.match(prompt, /media bytes and a vision model interpreted the pixels/i);
  assert.match(prompt, /Do not claim human eyesight/i);
});

test("vision model selection keeps the visual route separate from coding", () => {
  assert.equal(vision._test.OPENROUTER_VISION_MODEL, "google/gemini-3.1-pro-preview");
});
