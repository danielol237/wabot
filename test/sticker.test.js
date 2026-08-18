const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createSticker, isStickerMedia } = require("../src/tools/sticker");
const { resolveNaturalAction } = require("../src/utils/commandRouter");

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

test("sticker: GIF conversion emits a 512px WebP sticker", async () => {
  const result = await createSticker(ONE_PIXEL_GIF, { mimetype: "image/gif", filename: "reaction.gif" });
  assert.equal(result.success, true, result.error);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});
