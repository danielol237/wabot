// Group admin helpers — regression tests for the !add command + robust isBotAdmin.
const test = require("node:test");
const assert = require("node:assert");

test("groupAdmin: addUser is exported and calls groupParticipantsUpdate with 'add'", async () => {
  const ga = require("../src/tools/groupAdmin");
  assert.strictEqual(typeof ga.addUser, "function", "addUser exported");
  let called = null;
  const sock = { groupParticipantsUpdate: async (gid, jids, action) => { called = { gid, jids, action }; } };
  const r = await ga.addUser(sock, "g@us", "234810000000@s.whatsapp.net");
  assert.strictEqual(called.action, "add", "calls 'add' action");
  assert.deepStrictEqual(called.jids, ["234810000000@s.whatsapp.net"]);
  assert.strictEqual(r.success, true);
});

test("groupAdmin: isBotAdmin returns false (not throws) when sock.user is undefined", async () => {
  const ga = require("../src/tools/groupAdmin");
  const sock = {
    // No .user — the old code crashed on sock.user.id; must return false gracefully.
    groupMetadata: async () => ({ participants: [{ id: "123@s.whatsapp.net", admin: "admin" }] }),
  };
  const r = await ga.isBotAdmin(sock, "g@us");
  assert.strictEqual(r, false, "should return false without throwing");
});

test("router: !add command is registered with invite aliases", () => {
  const r = require("../src/utils/commandRouter");
  const c = r.commands.find((x) => x.name === "add");
  assert.ok(c, "add command registered");
  assert.ok(c.aliases.includes("invite") && c.aliases.includes("addmember"), "has invite aliases");
  assert.strictEqual(c.category, "group", "group command");
});
