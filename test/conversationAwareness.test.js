const test = require("node:test");
const assert = require("node:assert/strict");

const awareness = require("../src/tools/conversationAwareness");
const memory = require("../src/utils/memory");

test("dialogue awareness detects repeated questions instead of treating them as isolated prompts", () => {
  const context = awareness.buildDialogueAwareness([
    { role: "user", content: "Who?" },
    { role: "assistant", content: "I'm ARIA, your companion." },
  ], "Who?");
  assert.match(context, /repeated this question/i);
  assert.match(context, /fresh, context-aware/i);
});

test("dialogue awareness recognizes an identity callback after a prior ARIA answer", () => {
  const context = awareness.buildDialogueAwareness([
    { role: "user", content: "Who is he?" },
    { role: "assistant", content: "He's the mastermind behind me—yeah, Daniel." },
  ], "Who?");
  assert.match(context, /playful identity callback/i);
});

test("memory saveMemory preserves user and assistant turns", () => {
  const chatId = `memory-test-${Date.now()}`;
  memory.saveMemory(chatId, "Who?", "You mean Daniel, the mastermind.");
  assert.deepEqual(memory.getMemory(chatId), [
    { role: "user", content: "Who?" },
    { role: "assistant", content: "You mean Daniel, the mastermind." },
  ]);
  memory.clearMemory(chatId);
});
