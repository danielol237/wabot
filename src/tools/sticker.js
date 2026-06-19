const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");

const TEMP_DIR = path.join(__dirname, "../../temp");

// Converts an image buffer into a WhatsApp-ready sticker (WebP, 512x512, padded)
async function createSticker(imageBuffer) {
  try {
    const webpBuffer = await sharp(imageBuffer)
      .resize(512, 512, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent padding
      })
      .webp({ quality: 80 })
      .toBuffer();

    return { success: true, buffer: webpBuffer };
  } catch (err) {
    console.error("Sticker creation error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { createSticker };
