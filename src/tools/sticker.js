const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const sharp = require("sharp");
const ffmpegStatic = require("ffmpeg-static");

const execFileAsync = promisify(execFile);
const MAX_CANVAS = 512;
const MAX_VIDEO_SECONDS = 6;
const MAX_INPUT_BYTES = 35 * 1024 * 1024;

function isStickerMedia(media) {
  const mimetype = String(media?.mimetype || "").toLowerCase();
  const filename = String(media?.filename || "").toLowerCase();
  return mimetype.startsWith("image/") || mimetype.startsWith("video/") ||
    /\.(gif|webp|png|jpe?g|mp4|mov|webm|mkv)$/i.test(filename);
}

async function downloadStickerMedia(sock, msg) {
  const { hasMedia, downloadMediaFromMsg, downloadQuotedMedia } = require("../utils/baileysHelpers");
  let media = hasMedia(msg) ? await downloadMediaFromMsg(sock, msg) : null;
  if (!media) media = await downloadQuotedMedia(sock, msg);
  return media && isStickerMedia(media) ? media : null;
}

function looksLikeAnimatedGif(media) {
  return /gif/i.test(String(media?.mimetype || "")) || /\.gif$/i.test(String(media?.filename || ""));
}

function looksLikeVideo(media) {
  return String(media?.mimetype || "").toLowerCase().startsWith("video/") ||
    /\.(mp4|mov|webm|mkv)$/i.test(String(media?.filename || ""));
}

async function createRasterSticker(imageBuffer, animated = false) {
  const input = sharp(imageBuffer, { animated, failOn: "none" });
  const metadata = await input.metadata();
  const pages = Number(metadata.pages || 1);
  const isAnimated = animated && pages > 1;
  let pipeline = input;

  // Remove transparent edge padding for still images so the sticker appears
  // slightly larger in WhatsApp while remaining inside the 512x512 limit.
  if (!isAnimated && Number(metadata.width || 0) >= 3 && Number(metadata.height || 0) >= 3) {
    pipeline = pipeline.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 });
  }

  pipeline = pipeline.resize({
    width: MAX_CANVAS,
    height: MAX_CANVAS,
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  if (isAnimated) {
    return pipeline.webp({
      quality: 82,
      effort: 4,
      loop: 0,
      delay: metadata.delay || 100,
    }).toBuffer();
  }
  return pipeline.webp({ quality: 82, effort: 4 }).toBuffer();
}

async function createVideoSticker(inputBuffer) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "aria-sticker-"));
  const inputPath = path.join(dir, "input");
  const outputPath = path.join(dir, "sticker.webp");
  try {
    await fs.promises.writeFile(inputPath, inputBuffer, { mode: 0o600 });
    await execFileAsync(ffmpegStatic || "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", inputPath,
      "-t", String(MAX_VIDEO_SECONDS),
      "-an",
      "-vf", "fps=12,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,format=yuva420p",
      "-c:v", "libwebp",
      "-q:v", "70",
      "-compression_level", "6",
      "-loop", "0",
      outputPath,
    ], { maxBuffer: 1024 * 1024 });
    return await fs.promises.readFile(outputPath);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Converts still images, animated GIFs, and short videos into WhatsApp-ready
// WebP stickers. WhatsApp's maximum sticker canvas remains 512x512; the visual
// content is trimmed and fitted to that canvas instead of producing a larger,
// invalid sticker.
async function createSticker(mediaBuffer, options = {}) {
  try {
    if (!Buffer.isBuffer(mediaBuffer) || mediaBuffer.length === 0) {
      throw new Error("The media buffer is empty.");
    }
    if (mediaBuffer.length > MAX_INPUT_BYTES) {
      throw new Error("That media file is too large for sticker conversion. Send a shorter or smaller GIF/video.");
    }

    const media = {
      mimetype: options.mimetype || "",
      filename: options.filename || "",
    };
    const output = looksLikeVideo(media) && !looksLikeAnimatedGif(media)
      ? await createVideoSticker(mediaBuffer)
      : await createRasterSticker(mediaBuffer, looksLikeAnimatedGif(media));

    return { success: true, buffer: output, width: MAX_CANVAS, height: MAX_CANVAS };
  } catch (err) {
    console.error("Sticker creation error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  createSticker,
  downloadStickerMedia,
  isStickerMedia,
};
