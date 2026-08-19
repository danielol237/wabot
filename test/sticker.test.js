const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createSticker, isStickerMedia } = require("../src/tools/sticker");
const { resolveNaturalAction } = require("../src/utils/commandRouter");
const { findQuotedMediaReference, hasMedia, hasVoiceNote, getMessageText } = require("../src/utils/baileysHelpers");

const ONE_PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

test("sticker: natural language phrase resolves to sticker intent after ARIA address", () => {
  const action = resolveNaturalAction("Aria turn this into a sticker");
  assert.equal(action?.intent, "sticker");
});

test("sticker: attached GIF and WhatsApp video media are recognized", () => {
  assert.equal(isStickerMedia({ mimetype: "image/gif", filename: "reaction.gif" }), true);
  assert.equal(isStickerMedia({ mimetype: "video/mp4", filename: "reaction.mp4" }), true);
  assert.equal(isStickerMedia({ mimetype: "application/pdf", filename: "file.pdf" }), false);
});

test("sticker: direct quoted GIF is found inside an ephemeral wrapper", () => {
  const msg = {
    key: { remoteJid: "123@g.us", id: "command-1", participant: "123@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "Aria make this a sticker",
        contextInfo: {
          stanzaId: "gif-1",
          remoteJid: "123@g.us",
          participant: "456@s.whatsapp.net",
          quotedMessage: {
            ephemeralMessage: {
              message: {
                videoMessage: { mimetype: "video/mp4", fileName: "reaction.gif", gifPlayback: true },
              },
            },
          },
        },
      },
    },
  };
  const reference = findQuotedMediaReference(msg);
  assert.equal(reference?.type, "videoMessage");
  assert.equal(reference?.media?.gifPlayback, true);
  assert.equal(reference?.depth, 1);
});

test("sticker: replying to ARIA's error walks back to the original quoted GIF", () => {
  const originalGif = {
    videoMessage: { mimetype: "video/mp4", fileName: "reaction.gif", gifPlayback: true },
  };
  const msg = {
    key: { remoteJid: "123@g.us", id: "follow-up", participant: "123@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "Fuck didn't I reply to it check again",
        contextInfo: {
          stanzaId: "aria-error",
          remoteJid: "123@g.us",
          participant: "999@s.whatsapp.net",
          quotedMessage: {
            extendedTextMessage: {
              text: "❌ Reply to or attach an image, GIF, or video first.",
              contextInfo: {
                stanzaId: "command-1",
                remoteJid: "123@g.us",
                participant: "123@s.whatsapp.net",
                quotedMessage: originalGif,
              },
            },
          },
        },
      },
    },
  };
  const reference = findQuotedMediaReference(msg);
  assert.equal(reference?.type, "videoMessage");
  assert.equal(reference?.depth, 2);
  assert.match(getMessageText({ message: msg.message }), /check again/i);
});

test("sticker: wrapped current video counts as media", () => {
  const msg = {
    message: {
      viewOnceMessageV2: {
        message: {
          videoMessage: { mimetype: "video/mp4", fileName: "reaction.mp4" },
        },
      },
    },
  };
  assert.equal(hasMedia(msg), true);
});

test("sticker: voice notes remain separate from visual media", () => {
  const msg = { message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } } };
  assert.equal(hasMedia(msg), false);
  assert.equal(hasVoiceNote(msg), true);
});

test("sticker: GIF conversion emits a 512px WebP sticker", async () => {
  const result = await createSticker(ONE_PIXEL_GIF, { mimetype: "image/gif", filename: "reaction.gif" });
  assert.equal(result.success, true, result.error);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});
