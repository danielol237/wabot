const test = require("node:test");
const assert = require("node:assert/strict");

const helpers = require("../src/utils/baileysHelpers");

test("central outbound sanitizer removes internal reasoning markers", () => {
  const result = helpers._test.sanitizeOutboundText("<think>private draft</think>\nActual reply.");
  assert.equal(result, "Actual reply.");
});

test("central outbound sanitizer removes unterminated reasoning blocks", () => {
  const result = helpers._test.sanitizeOutboundText("<analysis>private draft with no close tag");
  assert.equal(result, "");
});

test("central outbound sanitizer preserves ordinary WhatsApp formatting", () => {
  const result = helpers._test.sanitizeOutboundText("*ARIA* is ready — no @tag needed.");
  assert.equal(result, "*ARIA* is ready — no @tag needed.");
});

test("reply returns a safe failure result when WhatsApp send fails", async () => {
  const result = await helpers.reply(
    { sendMessage: async () => { throw new Error("transport unavailable"); } },
    { key: { remoteJid: "12345@s.whatsapp.net" } },
    "hello",
  );
  assert.equal(result.success, false);
  assert.match(result.error, /transport unavailable/);
});
