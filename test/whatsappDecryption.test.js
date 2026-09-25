const test = require("node:test");
const assert = require("node:assert/strict");
const decryptionHandler = require("../src/utils/whatsappDecryptionHandler");

test("whatsappDecryptionHandler detects and classifies Bad MAC errors", () => {
  const badMacErr = new Error("Session error: Error: Bad MAC Error: Bad MAC at libsignal/src/crypto.js");
  assert.equal(decryptionHandler.isDecryptionError(badMacErr), true);
  assert.equal(decryptionHandler.classifyDecryptionError(badMacErr), "BAD_MAC");
});

test("whatsappDecryptionHandler rate limits repeated decryption error logs", () => {
  decryptionHandler.clearFailureStats();
  const err = new Error("Failed to decrypt message with any known session");

  const handled1 = decryptionHandler.handleDecryptionError(err, { jid: "12345@s.whatsapp.net" });
  assert.equal(handled1, true);

  const stats1 = decryptionHandler.getFailureStats("12345@s.whatsapp.net");
  assert.equal(stats1.count, 1);

  // Immediately log second failure — count increments, but rate limits duplicate output
  decryptionHandler.handleDecryptionError(err, { jid: "12345@s.whatsapp.net" });
  const stats2 = decryptionHandler.getFailureStats("12345@s.whatsapp.net");
  assert.equal(stats2.count, 2);
});
