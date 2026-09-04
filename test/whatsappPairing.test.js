const test = require("node:test");
const assert = require("node:assert/strict");

const pairing = require("../src/utils/whatsappPairing");
const state = pairing._test.state;

function reset() {
  pairing._test.reset();
  pairing.setRuntime({ getSocket: () => null, requestPairingCode: null });
}

test("phone pairing normalizes international numbers and masks them", () => {
  assert.equal(pairing.normalizePhoneNumber("+234 801-234-5678"), "2348012345678");
  assert.equal(pairing.normalizePhoneNumber("00234 801 234 5678"), "2348012345678");
  assert.equal(pairing.normalizePhoneNumber("local-number"), null);
  assert.equal(pairing.normalizePhoneNumber("08012345678"), null);
  assert.equal(pairing.maskPhoneNumber("2348012345678"), "•••••••••5678");
});

test("phone pairing requests a code from the live socket and does not expose the raw number in default status", async () => {
  reset();
  let requestedNumber = null;
  pairing.setRuntime({
    getSocket: () => ({ id: "socket" }),
    requestPairingCode: async (number) => { requestedNumber = number; return "ABCD-EFGH"; },
  });
  pairing.updateConnection("open", { ready: false, registered: false });
  const result = await pairing.requestPairingCode("+234 801 234 5678", { actorId: "test-1" });
  assert.equal(result.success, true);
  assert.equal(requestedNumber, "2348012345678");
  assert.equal(result.code, "ABCD-EFGH");
  assert.equal(result.phoneNumber, "•••••••••5678");
  assert.equal(pairing.getStatus().code, undefined);
  assert.equal(pairing.getStatus().phoneNumber, "•••••••••5678");
});

test("phone pairing rejects invalid, connected, unavailable, and duplicate requests", async () => {
  reset();
  assert.equal((await pairing.requestPairingCode("123", { actorId: "invalid" })).code, "invalid_number");
  pairing.updateConnection("open", { ready: true, registered: true });
  assert.equal((await pairing.requestPairingCode("+2348012345678", { actorId: "connected" })).code, "already_connected");
  reset();
  pairing.updateConnection("open", { ready: false, registered: false });
  pairing.setRuntime({ getSocket: () => null, requestPairingCode: async () => "ABCD" });
  assert.equal((await pairing.requestPairingCode("+2348012345678", { actorId: "offline" })).code, "socket_unavailable");
  reset();
  pairing.setRuntime({ getSocket: () => ({}), requestPairingCode: async () => "ABCD" });
  pairing.updateConnection("open", { ready: false, registered: false });
  await pairing.requestPairingCode("+2348012345678", { actorId: "duplicate-1" });
  assert.equal((await pairing.requestPairingCode("+2348012345679", { actorId: "duplicate-2" })).code, "pairing_in_progress");
});

test("phone pairing expires codes and enforces actor cooldown", async () => {
  reset();
  pairing.setRuntime({ getSocket: () => ({}), requestPairingCode: async () => "ABCD" });
  pairing.updateConnection("open", { ready: false, registered: false });
  await pairing.requestPairingCode("+2348012345678", { actorId: "cooldown" });
  state.codeExpiresAt = Date.now() - 1;
  assert.equal(pairing.getStatus().code, undefined);
  assert.equal(pairing.getStatus().mode, "qr");

  reset();
  pairing.setRuntime({ getSocket: () => ({}), requestPairingCode: async () => "ABCD" });
  pairing.updateConnection("open", { ready: false, registered: false });
  assert.equal((await pairing.requestPairingCode("+2348012345678", { actorId: "rate" })).success, true);
  state.codeExpiresAt = Date.now() - 1;
  const second = await pairing.requestPairingCode("+2348012345678", { actorId: "rate" });
  assert.equal(second.code, "cooldown");
});

test("pairing request failures return a safe generic error", async () => {
  reset();
  pairing.setRuntime({ getSocket: () => ({}), requestPairingCode: async () => { throw new Error("private provider detail"); } });
  pairing.updateConnection("open", { ready: false, registered: false });
  const result = await pairing.requestPairingCode("+2348012345678", { actorId: "failure" });
  assert.equal(result.success, false);
  assert.equal(result.code, "request_failed");
  assert.doesNotMatch(result.error, /private provider detail/i);
  assert.equal(pairing.getStatus().code, undefined);
});
