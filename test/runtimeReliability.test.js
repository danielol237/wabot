const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const providerHealth = require("../src/tools/providerHealth");

test("provider health records failure backoff and recovers after success", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    providerHealth.recordFailure("OpenRouter", "auth failed");
    const failed = providerHealth.getAvailability("OpenRouter");
    assert.equal(failed.ok, false);
    assert.equal(failed.lastError, "auth failed");
    providerHealth.recordSuccess("OpenRouter", { latency: 42 });
    const recovered = providerHealth.getAvailability("OpenRouter");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.failures, 0);
    assert.equal(recovered.lastLatency, 42);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("provider health normalizes provider aliases and never exposes key values", () => {
  assert.equal(providerHealth._test.providerKey("gemini-unofficial"), "Gemini-web");
  assert.equal(providerHealth._test.providerKey("openrouter"), "OpenRouter");
  assert.equal(providerHealth._test.keySet("OpenRouter"), Boolean(process.env.OPENROUTER_API_KEY));
});

test("event memory stores structured events and redacts secret-shaped metadata", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aria-events-")), "events.json");
  const previous = process.env.ARIA_EVENT_LOG_FILE;
  process.env.ARIA_EVENT_LOG_FILE = file;
  delete require.cache[require.resolve("../src/utils/eventLog")];
  const eventLog = require("../src/utils/eventLog");
  const event = eventLog.trackConversationEvent("chat-1", "inbound", "Message received", {
    senderJid: "user@s.whatsapp.net",
    apiKey: "should-not-persist",
    correlationId: "corr-1",
  });
  assert.equal(event.meta.chatId, "chat-1");
  assert.equal(event.meta.apiKey, "[redacted]");
  assert.equal(eventLog.getConversation("chat-1", 5).length, 1);
  assert.equal(eventLog.getEvents({ correlationId: "corr-1" }, 5).length, 1);
  if (previous === undefined) delete process.env.ARIA_EVENT_LOG_FILE;
  else process.env.ARIA_EVENT_LOG_FILE = previous;
});
