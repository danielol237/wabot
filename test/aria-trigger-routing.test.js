const test = require("node:test");
const assert = require("node:assert/strict");
const { triggeredByName, resolveNaturalAction, commands } = require("../src/utils/commandRouter");
const { isBotMentioned } = require("../src/utils/baileysHelpers");
const { checkGroupProtection } = require("../src/tools/groupProtection");
const { setProtection } = require("../src/utils/groupSettings");

test("ARIA name trigger matches a word in the middle of a group message", () => {
  assert.equal(triggeredByName("I was talking to Aria about the group rules"), true);
  assert.equal(triggeredByName("diariamessage is not addressed"), false);
});

test("ARIA direct mention works in an image caption and normalizes device JIDs", () => {
  const msg = {
    message: {
      imageMessage: {
        caption: "@Aria check this",
        contextInfo: { mentionedJid: ["237650284057@s.whatsapp.net"] },
      },
    },
  };
  assert.equal(isBotMentioned(msg, ["237650284057:7@s.whatsapp.net"]), true);
});

test("new group commands are registered once", () => {
  const names = commands.map((command) => command.name);
  for (const name of ["antispam", "antisticker", "antiword", "antileave", "groupinfo"]) {
    assert.equal(names.filter((item) => item === name).length, 1, `${name} should be registered once`);
  }
});

test("natural-language protection toggles resolve to the correct commands", () => {
  assert.equal(resolveNaturalAction("Aria enable antispam")?.intent, "antispam");
  assert.equal(resolveNaturalAction("Aria turn on antiword")?.intent, "antiword");
});

test("anti-sticker protection deletes sticker messages when enabled", () => {
  const chatId = "trigger-test-antisticker@g.us";
  setProtection(chatId, "antisticker", true);
  const result = checkGroupProtection({
    text: "",
    msg: { message: { stickerMessage: { mimetype: "image/webp" } } },
    chatId,
    senderJid: "237650000000@s.whatsapp.net",
    isGroup: true,
  });
  assert.equal(result?.action, "delete");
});
