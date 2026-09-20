const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const sharp = require("sharp");
const { execFileSync } = require("child_process");

const execFileAsync = promisify(execFile);
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const TEMP_ROOT = path.join(os.tmpdir(), "aria-native-media");
try { fs.mkdirSync(TEMP_ROOT, { recursive: true, mode: 0o700 }); } catch (_) {}

function commandPath(name) {
  try { return execFileSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8", timeout: 1500 }).trim() || null; } catch (_) { return null; }
}
function inspectLocalRuntimes() {
  return {
    sharp: true,
    ffmpeg: Boolean(commandPath("ffmpeg")),
    ffprobe: Boolean(commandPath("ffprobe")),
    tesseract: Boolean(commandPath("tesseract")),
    espeak: Boolean(commandPath("espeak") || commandPath("espeak-ng") || commandPath("pico2wave")),
  };
}
function assertBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Media buffer is empty.");
  if (buffer.length > MAX_INPUT_BYTES) throw new Error("Media exceeds the native processing size limit.");
}
function digest(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
async function inspectImage(buffer, options = {}) {
  assertBuffer(buffer);
  const metadata = await sharp(buffer, { animated: true, failOn: "none" }).metadata();
  return {
    success: true,
    kind: "image",
    bytes: buffer.length,
    sha256: digest(buffer),
    format: metadata.format || null,
    width: metadata.width || null,
    height: metadata.height || null,
    pages: metadata.pages || 1,
    animated: Boolean((metadata.pages || 1) > 1),
    hasAlpha: Boolean(metadata.hasAlpha),
    text: null,
    textAvailable: false,
    note: options.ocr ? "OCR requires the optional local tesseract executable." : null,
  };
}
async function convertImage(buffer, options = {}) {
  assertBuffer(buffer);
  const format = String(options.format || "png").toLowerCase();
  const allowed = new Set(["png", "jpeg", "jpg", "webp", "avif"]);
  if (!allowed.has(format)) throw new Error(`Unsupported image output format: ${format}`);
  let pipeline = sharp(buffer, { failOn: "none" });
  if (options.width || options.height) pipeline = pipeline.resize({ width: options.width ? Number(options.width) : undefined, height: options.height ? Number(options.height) : undefined, fit: options.fit || "inside", withoutEnlargement: true });
  const output = await pipeline.toFormat(format === "jpg" ? "jpeg" : format).toBuffer();
  return { success: true, kind: "image", buffer: output, bytes: output.length, format: format === "jpg" ? "jpeg" : format, sha256: digest(output) };
}
async function transcodeMedia(buffer, options = {}) {
  assertBuffer(buffer);
  const ffmpeg = commandPath("ffmpeg");
  if (!ffmpeg) return { success: false, verified: false, error: "Local FFmpeg is unavailable." };
  const dir = await fs.promises.mkdtemp(path.join(TEMP_ROOT, "transcode-"));
  const input = path.join(dir, "input");
  const output = path.join(dir, `output.${String(options.extension || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4"}`);
  try {
    await fs.promises.writeFile(input, buffer, { mode: 0o600 });
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", input];
    if (options.audioCodec) args.push("-c:a", String(options.audioCodec));
    if (options.videoCodec) args.push("-c:v", String(options.videoCodec));
    if (options.audioOnly) args.push("-vn");
    if (options.videoOnly) args.push("-an");
    if (options.duration) args.push("-t", String(Math.min(Number(options.duration), 600)));
    args.push(output);
    await execFileAsync(ffmpeg, args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    const result = await fs.promises.readFile(output);
    return { success: true, verified: result.length > 0, kind: options.audioOnly ? "audio" : "video", buffer: result, bytes: result.length, sha256: digest(result), extension: path.extname(output).slice(1) };
  } catch (error) {
    return { success: false, verified: false, error: String(error.message || error).slice(0, 400) };
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
async function textToSpeechLocal(text, options = {}) {
  const value = String(text || "").trim();
  if (!value) return { success: false, verified: false, error: "Speech text is empty." };
  const command = commandPath("espeak-ng") || commandPath("espeak");
  if (!command) return { success: false, verified: false, error: "No local speech synthesizer is installed." };
  const output = path.join(TEMP_ROOT, `speech-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.wav`);
  try {
    const args = ["-w", output];
    if (options.voice) args.push("-v", String(options.voice));
    args.push(value.slice(0, 5000));
    await execFileAsync(command, args, { timeout: 30000 });
    const buffer = await fs.promises.readFile(output);
    return { success: true, verified: buffer.length > 44, provider: "local", mimetype: "audio/wav", buffer, bytes: buffer.length, sha256: digest(buffer) };
  } catch (error) { return { success: false, verified: false, error: String(error.message || error).slice(0, 300) }; }
  finally { await fs.promises.rm(output, { force: true }).catch(() => {}); }
}
module.exports = { inspectLocalRuntimes, inspectImage, convertImage, transcodeMedia, textToSpeechLocal, _test: { digest, commandPath, MAX_INPUT_BYTES } };
