const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { MessageMedia } = require("whatsapp-web.js");
const { v4: uuidv4 } = require("uuid");

const TEMP_DIR = path.join(__dirname, "../../temp");

async function downloadMedia(url, chatId, client) {
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
        const media = MessageMedia.fromFilePath(filePath);
        await client.sendMessage(chatId, media, {
          caption: `📥 Downloaded successfully`,
          sendMediaAsDocument: [".zip", ".pdf", ".mp3"].includes(ext),
        });

        // Cleanup
        fs.unlinkSync(filePath);
        resolve({ success: true });
      } catch (sendErr) {
        console.error("Send error:", sendErr.message);
        fs.unlinkSync(filePath);
        resolve({ success: false, error: "File downloaded but couldn't send it." });
      }
    });
  });
}

module.exports = { downloadMedia };
