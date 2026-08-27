const test = require("node:test");
const assert = require("node:assert/strict");

const helpers = require("../src/utils/baileysHelpers");

test("natural self-summons trigger a hidden self-mention", () => {
  assert.equal(helpers.shouldSelfMention("Where's my Aria", "Present 😌"), true);
  assert.equal(helpers.shouldSelfMention("Who is he?", "I'm ARIA—your companion."), true);
  assert.equal(helpers.shouldSelfMention("tell me a joke", "Here you go."), false);
});

test("bot JID resolution deduplicates WhatsApp identity variants", () => {
  const jids = helpers.getBotMentionJids({ user: {
    id: "237600000000:1@s.whatsapp.net",
    jid: "237600000000@s.whatsapp.net",
    lid: "12345@lid",
  } });
  assert.deepEqual(jids, ["237600000000:1@s.whatsapp.net", "12345@lid"]);
});

test("reply carries mention metadata without injecting visible @ text", async () => {
  const sent = [];
  const sock = { sendMessage: async (...args) => { sent.push(args); } };
  const msg = { key: { remoteJid: "group@g.us" } };
  await helpers.reply(sock, msg, "Present 😌", { mentions: ["237600000000@s.whatsapp.net"] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].text, "Present 😌");
  assert.deepEqual(sent[0][1].mentions, ["237600000000@s.whatsapp.net"]);
  assert.equal(sent[0][1].text.includes("@237600000000"), false);
});
