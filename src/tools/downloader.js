const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { validateOutboundUrl } = require("../utils/outboundUrlPolicy");
const { ytBaseFlags } = require("./mediaTools");
const { resolveYtDlp, commandArgs } = require("../utils/mediaRuntime");

const TEMP_DIR = path.join(__dirname, "../../temp");

// Validate that a URL is an http(s) URL and not something that could inject
// shell arguments (yt-dlp is run via execFile so args are never interpreted
// by a shell, but we still sanity-check the scheme).
function validateUrl(url) {
  if (!url) return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  // Reject strings containing newlines or quotes which could confuse parsing
  if (/[\r\n"']/.test(trimmed)) return null;
  return trimmed;
}

async function downloadFromUrl(rawUrl) {
  const url = validateUrl(rawUrl);
  if (!url) {
    return { text: "❌ Invalid URL. Must be a public http(s) link." };
  }
  const target = await validateOutboundUrl(url);
  if (!target.ok) {
    return { text: "❌ Download blocked: the URL is not a reachable public destination." };
  }

  const id = uuidv4();
  const outputPath = path.join(TEMP_DIR, `${id}.%(ext)s`);

  return new Promise((resolve) => {
    // yt-dlp via execFile — args passed as an array so nothing is shell-interpreted.
    const args = [
      ...ytBaseFlags(),
      "-f", "best[filesize<50M]/best",
      "--max-filesize", "50M",
      "-o", outputPath,
      target.url.toString(),
    ];

    const command = resolveYtDlp();
    if (!command) return resolve({ text: "❌ Download unavailable: the media runtime is not installed on this server." });
    execFile(command.file, commandArgs(command, args), { env: command.env, timeout: 60000 }, async (err, stdout, stderr) => {
      if (err) {
        console.error("yt-dlp error:", stderr);
        return resolve({ text: "❌ Download failed. Make sure the URL is valid and public." });
      }

      // Find the downloaded file
      let files;
      try {
        files = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(id));
      } catch (readErr) {
        return resolve({ text: "❌ Download failed: " + readErr.message });
      }
      if (files.length === 0) {
        return resolve({ text: "❌ File not found after download." });
      }

      const filePath = path.join(TEMP_DIR, files[0]);
      const ext = path.extname(files[0]).toLowerCase();

      try {
        const buffer = fs.readFileSync(filePath);
        fs.unlinkSync(filePath);
        resolve({ buffer, mimetype: inferMimetype(ext), filename: files[0] });
      } catch (sendErr) {
        console.error("Read error:", sendErr.message);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        resolve({ text: "❌ File downloaded but couldn't be read." });
      }
    });
  });
}

function inferMimetype(ext) {
  const map = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".opus": "audio/ogg",
    ".zip": "application/zip",
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  return map[ext] || "application/octet-stream";
}

module.exports = { downloadFromUrl, downloadMedia: downloadFromUrl };
