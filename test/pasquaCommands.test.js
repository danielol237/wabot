const test = require("node:test");
const assert = require("node:assert");
const { commands, detectCommandCollisions } = require("../src/utils/commandRouter");
const { getPasquaCommands, handleWcgCommand } = require("../src/tools/pasquaCommands");
const { getGroupSettings } = require("../src/utils/groupSettings");

function fakeMessage(chatId = "120363000000000000@g.us") {
  return { key: { remoteJid: chatId, id: "msg-1", participant: "12345@s.whatsapp.net" }, message: { conversation: "" } };
}

function fakeSock() {
  const sent = [];
  return {
    user: { id: "12345000000@s.whatsapp.net" },
    sent,
    groupMetadata: async () => ({ subject: "Test Group", participants: [
      { id: "12345000000@s.whatsapp.net", admin: "superadmin" },
      { id: "23456000000@s.whatsapp.net", admin: "admin" },
      { id: "34567000000@s.whatsapp.net" },
    ] }),
    sendMessage: async (chatId, payload) => { sent.push({ chatId, payload }); return {}; },
    updateProfileName: async (name) => { sent.push({ profileName: name }); },
    updateProfileStatus: async (status) => { sent.push({ profileStatus: status }); },
    groupParticipantsUpdate: async () => [],
  };
}

test("PASQUA: requested safe commands are registered while approve and confirmkick remain absent", () => {
  const names = new Set(commands.flatMap((c) => [c.name, ...(c.aliases || [])]));
  for (const name of ["antibot", "antidemote", "antigroupmention", "antigroupstatus", "antihijack", "antimention", "antipromote", "slowmode", "kickall", "getgpp", "setgpp", "introcard", "setwelcomemsg", "setgoodbyemsg", "setbio", "setname", "setpp", "pp", "randompp", "password", "wcg", "aichat", "essay", "summarize"]) assert.ok(names.has(name), `${name} should be registered`);
  assert.equal(names.has("approve"), false);
  assert.equal(names.has("confirmkick"), false);
  assert.equal(names.has("randompp"), true);
  assert.deepEqual(detectCommandCollisions(), []);
  assert.equal(commands.find((c) => c.name === "kickall")?.ownerOnly, true);
  assert.equal(getPasquaCommands().find((c) => c.name === "setpp")?.ownerOnly, true);
});

test("PASQUA: protection commands persist on/off state", async () => {
  const sock = fakeSock();
  const msg = fakeMessage();
  const command = getPasquaCommands().find((c) => c.name === "antibot");
  const ctx = { chatId: msg.key.remoteJid, senderJid: "23456000000@s.whatsapp.net", isGroup: true, pasquaCommand: "antibot" };
  await command.handler(sock, msg, "on", ctx);
  assert.equal(getGroupSettings(ctx.chatId).protections.antibot, true);
  await command.handler(sock, msg, "off", ctx);
  assert.equal(getGroupSettings(ctx.chatId).protections.antibot, false);
});

test("PASQUA: secure password command returns a non-empty generated secret", async () => {
  const sock = fakeSock();
  const msg = fakeMessage("23456000000@s.whatsapp.net");
  const command = getPasquaCommands().find((c) => c.name === "password");
  await command.handler(sock, msg, "32", { chatId: msg.key.remoteJid, pasquaCommand: "password" });
  const text = sock.sent.at(-1).payload.text;
  assert.match(text, /Secure password/);
  assert.ok(text.includes("32 chars"));
});

test("PASQUA: Word Chain Game enforces the next letter", async () => {
  const sock = fakeSock();
  const msg = fakeMessage();
  const ctx = { chatId: msg.key.remoteJid, senderJid: "12345@s.whatsapp.net", isGroup: true };
  await handleWcgCommand(sock, msg, "cat", ctx);
  await handleWcgCommand(sock, msg, "tree", ctx);
  await handleWcgCommand(sock, msg, "wrong", ctx);
  const texts = sock.sent.map((entry) => entry.payload.text).filter(Boolean).join("\n");
  assert.match(texts, /Word Chain Game started/);
  assert.match(texts, /tree.*accepted/);
  assert.match(texts, /must start with/i);
});
