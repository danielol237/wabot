const test = require("node:test");
const assert = require("node:assert/strict");

const previousOwner = process.env.OWNER_NUMBER;
process.env.OWNER_NUMBER = "12345000000";
process.env.ARIA_CAPSULE_KEY = "test-only-capsule-key";

const { commands, resolveNaturalAction } = require("../src/utils/commandRouter");
const { handleAriaLifeFeature, _state } = require("../src/tools/ariaLifeFeatures");

function fakeMessage(chatId = "life-features@g.us") {
  return { key: { remoteJid: chatId, id: `life-${Date.now()}`, participant: "12345000000@s.whatsapp.net" }, message: { conversation: "" } };
}

function fakeSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (chatId, payload) => { sent.push({ chatId, payload }); return {}; },
  };
}

test.after(() => {
  if (previousOwner === undefined) delete process.env.OWNER_NUMBER;
  else process.env.OWNER_NUMBER = previousOwner;
});

test("ARIA life features: all ten owner-only commands are registered without collisions", () => {
  const names = new Set(commands.map((command) => command.name));
  for (const name of [
    "echolocation", "timecapsule", "mirrorreport", "memorypalace", "secondbrain",
    "dreamcatcher", "paralleluniverse", "soulsearch", "emotiontimeline", "oracle",
  ]) {
    const command = commands.find((item) => item.name === name);
    assert.ok(names.has(name), `${name} should be registered`);
    assert.equal(command.ownerOnly, true, `${name} should be owner-only`);
  }
});

test("ARIA life features: natural phrases resolve to their private feature intents", () => {
  const cases = [
    ["ARIA, search all my conversations for launch", "echolocation"],
    ["ARIA, time capsule in 2 weeks tell me to review the app", "timecapsule"],
    ["ARIA, write my personality report", "mirrorreport"],
    ["ARIA, show my conversation graph", "memorypalace"],
    ["ARIA, save a note about the release", "secondbrain"],
    ["ARIA, log my dream about flying", "dreamcatcher"],
    ["ARIA, what if I moved to another city", "paralleluniverse"],
    ["ARIA, write my biography", "soulsearch"],
    ["ARIA, show my mood timeline", "emotiontimeline"],
    ["ARIA, predict my next move", "oracle"],
  ];
  for (const [phrase, intent] of cases) assert.equal(resolveNaturalAction(phrase)?.intent, intent, phrase);
});

test("ARIA life features: non-owner requests are refused", async () => {
  const sock = fakeSock();
  await handleAriaLifeFeature(sock, fakeMessage(), "show my notes", {
    senderJid: "23456000000@s.whatsapp.net",
    chatId: "life-features@g.us",
    ariaFeature: "secondbrain",
  });
  assert.match(sock.sent.at(-1).payload.text, /private and owner-only/i);
});

test("ARIA life features: Time Capsule stores encrypted payload without plaintext", async () => {
  const sock = fakeSock();
  const chatId = `capsule-test-${Date.now()}@g.us`;
  const before = _state.capsules.length;
  await handleAriaLifeFeature(sock, fakeMessage(chatId), "in 2 days tell me the private launch note", {
    senderJid: "12345000000@s.whatsapp.net",
    chatId,
    ariaFeature: "timecapsule",
  });
  const capsule = _state.capsules.slice(before).find((item) => item.chatId === chatId);
  assert.ok(capsule);
  assert.equal(typeof capsule.data, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(capsule, "message"), false);
  assert.equal(JSON.stringify(capsule).includes("private launch note"), false);
  capsule.active = false;
});
