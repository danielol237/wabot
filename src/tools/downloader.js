const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const TEMP_DIR = path.join(__dirname, "../../temp");

async function downloadMedia(url, chatId, sock) {
  const id = uuidv4();
  const outputPath = path.join(TEMP_DIR, `${id}.%(ext)s`);

  return new Promise((resolve) => {
    // yt-dlp command — works for YouTube, TikTok, Instagram, Twitter/X, Facebook, etc.
    const cmd = `yt-dlp -f "best[filesize<50M]/best" --max-filesize 50M -o "${outputPath}" "${url}"`;

    exec(cmd, { timeout: 60000 }, async (err, stdout, stderr) => {
      if (err) {
        console.error("yt-dlp error:", stderr);
        return resolve({ success: false, error: "Download failed. Make sure the URL is valid and public." });
      }

      // Find the downloaded file
      const files = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(id));
      if (files.length === 0) {
        return resolve({ success: false, error: "File not found after download." });
      }

      const filePath = path.join(TEMP_DIR, files[0]);
      const ext = path.extname(files[0]).toLowerCase();

      try {
        const buffer = fs.readFileSync(filePath);
        const isVideo = [".mp4", ".webm", ".mkv"].includes(ext);
        const isAudio = [".mp3", ".m4a", ".opus"].includes(ext);
        const isDoc = [".zip", ".pdf"].includes(ext);

        if (isVideo) {
          await sock.sendMessage(chatId, { video: buffer, caption: "📥 Downloaded successfully" });
        } else if (isAudio) {
          await sock.sendMessage(chatId, { audio: buffer, mimetype: "audio/mp4" });
        } else if (isDoc) {
          await sock.sendMessage(chatId, { document: buffer, fileName: files[0], caption: "📥 Downloaded successfully" });
        } else {
          await sock.sendMessage(chatId, { document: buffer, fileName: files[0], caption: "📥 Downloaded successfully" });
        }

        fs.unlinkSync(filePath);
        resolve({ success: true });
      } catch (sendErr) {
        console.error("Send error:", sendErr.message);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        resolve({ success: false, error: "File downloaded but couldn't send it." });
      }
    });
  });
}

module.exports = { downloadMedia };
