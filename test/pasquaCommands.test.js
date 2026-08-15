const test = require("node:test");
const assert = require("node:assert");
const { commands, detectCommandCollisions } = require("../src/utils/commandRouter");
const { getPasquaCommands, handleWcgCommand } = require("../src/tools/pasquaCommands");
const { getGroupSettings, setAntiAdmin } = require("../src/utils/groupSettings");
const { handleParticipantUpdate } = require("../src/tools/groupProtection");
const { isBotAdmin, isSenderAdmin } = require("../src/tools/groupAdmin");
const { resolveNaturalAction } = require("../src/utils/commandRouter");

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
    groupParticipantsUpdate: async (chatId, ids, action) => { sent.push({ groupUpdate: { chatId, ids, action } }); return ids.map((id) => ({ id, status: "200" })); },
    profilePictureUrl: async () => { throw new Error("profile picture unavailable"); },
  };
}

test("PASQUA: requested safe commands are registered while approve and confirmkick remain absent", () => {
  const names = new Set(commands.flatMap((c) => [c.name, ...(c.aliases || [])]));
  for (const name of ["antibot", "antidemote", "antigroupmention", "antigroupstatus", "antihijack", "antimention", "antipromote", "slowmode", "kickall", "getgpp", "setgpp", "introcard", "setwelcomemsg", "setgoodbyemsg", "setbio", "setname", "setpp", "pp", "randompp", "pinterest", "antiadmin", "password", "wcg", "aichat", "essay", "summarize"]) assert.ok(names.has(name), `${name} should be registered`);
  assert.equal(names.has("approve"), false);
  assert.equal(names.has("confirmkick"), false);
  assert.equal(names.has("randompp"), true);
  assert.deepEqual(detectCommandCollisions(), []);
  assert.equal(commands.find((c) => c.name === "kickall")?.ownerOnly, true);
  assert.equal(getPasquaCommands().find((c) => c.name === "setpp")?.ownerOnly, true);
  assert.equal(getPasquaCommands().find((c) => c.name === "antiadmin")?.ownerOnly, true);
});

test("PASQUA: every registered command resolves without a prefix when addressed to ARIA", () => {
  for (const command of commands) {
    const resolved = resolveNaturalAction(`ARIA ${command.name}`);
    assert.equal(resolved?.command?.name, command.name, `${command.name} should resolve without !`);
  }
});

test("PASQUA: natural-language phrases resolve to real owner/media commands", () => {
  const kick = resolveNaturalAction("ARIA, kick everyone in this GC");
  assert.equal(kick?.command?.name, "kickall");
  assert.equal(kick?.command?.ownerOnly, true);
  assert.equal(resolveNaturalAction("ARIA, set your profile pic to this")?.command?.name, "setpp");
  assert.equal(resolveNaturalAction("ARIA, never make @23456000000 an admin")?.command?.name, "antiadmin");
  assert.equal(resolveNaturalAction("ARIA, make him admin")?.command?.name, "promote");
  assert.equal(resolveNaturalAction("ARIA, remove his admin")?.command?.name, "demote");
  assert.equal(resolveNaturalAction("ARIA, kick him")?.command?.name, "kick");
  assert.equal(resolveNaturalAction("ARIA, enable antigroupmention")?.command?.name, "antigroupmention");
  assert.equal(resolveNaturalAction("ARIA, give me 10 pics of Goku")?.command?.name, "pinterest");
  const releases = resolveNaturalAction("ARIA, search on GitHub about this and bring the link to releases");
  assert.equal(releases?.command?.name, "releases");
  assert.equal(releases?.args, "this");
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

test("group admin checks recognize phone and LID identities", async () => {
  const sock = fakeSock();
  sock.user = { id: "12345000000@s.whatsapp.net", lid: "555000000000000@lid" };
  sock.groupMetadata = async () => ({ participants: [
    { id: "555000000000000@lid", phoneNumber: "12345000000@s.whatsapp.net", admin: "superadmin" },
    { id: "666000000000000@lid", phoneNumber: "23456000000@s.whatsapp.net", admin: "admin" },
  ] });
  assert.equal(await isBotAdmin(sock, "120363000000000000@g.us"), true);
  assert.equal(await isSenderAdmin(sock, "120363000000000000@g.us", "666000000000000@lid"), true);
});

test("PASQUA: anti-admin denylist demotes a blocked promotion and restores the owner", async () => {
  const sock = fakeSock();
  const chatId = "120363000000000000@g.us";
  const blocked = "34567000000@s.whatsapp.net";
  setAntiAdmin(chatId, blocked, true, { addedBy: "12345000000@s.whatsapp.net" });
  await handleParticipantUpdate(sock, { id: chatId, author: "23456000000@s.whatsapp.net", participants: [blocked], action: "promote" });
  await handleParticipantUpdate(sock, { id: chatId, author: "23456000000@s.whatsapp.net", participants: ["12345000000@s.whatsapp.net"], action: "remove" });
  const updates = sock.sent.filter((entry) => entry.groupUpdate).map((entry) => entry.groupUpdate);
  assert.ok(updates.some((entry) => entry.action === "demote" && entry.ids.includes(blocked)));
  assert.ok(updates.some((entry) => entry.action === "add" && entry.ids.includes("12345000000@s.whatsapp.net")));
  assert.ok(updates.some((entry) => entry.action === "demote" && entry.ids.includes("23456000000@s.whatsapp.net")));
  setAntiAdmin(chatId, blocked, false);
});

test("PASQUA: anti-admin enforcement matches a stored phone identity to a promoted LID", async () => {
  const sock = fakeSock();
  sock.user = { id: "12345000000@s.whatsapp.net", lid: "555000000000000@lid" };
  sock.groupMetadata = async () => ({ participants: [
    { id: "555000000000000@lid", phoneNumber: "12345000000@s.whatsapp.net", admin: "superadmin" },
    { id: "666000000000000@lid", phoneNumber: "34567000000@s.whatsapp.net", admin: "admin" },
  ] });
  const chatId = "120363000000000000@g.us";
  setAntiAdmin(chatId, "34567000000@s.whatsapp.net", true, { addedBy: "12345000000@s.whatsapp.net" });
  await handleParticipantUpdate(sock, {
    id: chatId,
    author: "23456000000@s.whatsapp.net",
    participants: [{ id: "666000000000000@lid", phoneNumber: "34567000000@s.whatsapp.net" }],
    action: "promote",
  });
  const updates = sock.sent.filter((entry) => entry.groupUpdate).map((entry) => entry.groupUpdate);
  assert.ok(updates.some((entry) => entry.action === "demote" && entry.ids.includes("666000000000000@lid")));
  setAntiAdmin(chatId, "34567000000@s.whatsapp.net", false);
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
