// Handles sending files back to WhatsApp chat from build/project results
// Extracted from the monolithic messageHandler.js handleResponseWithFile function

const path = require("path");
const fs = require("fs");

async function handleResponseWithFile(sock, msg, result) {
  const { reply, react, sleep } = require("../utils/baileysHelpers");
  const { log, error, warn } = require("../utils/logger");
  const chatId = msg.key.remoteJid;

  if (!result.files || result.files.length === 0) return;

  await react(sock, msg, "📁");

  // If only one file, send it directly
  if (result.files.length === 1) {
    const file = result.files[0];
    try {
      if (file.buffer) {
        const filename = file.filename || "output.txt";
        const ext = path.extname(filename).toLowerCase();
        const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

        if (imageExts.includes(ext)) {
          await sock.sendMessage(chatId, { image: file.buffer, caption: `📁 ${filename}` });
        } else {
          await sock.sendMessage(chatId, {
            document: file.buffer,
            mimetype: file.mimetype || "application/octet-stream",
            fileName: filename,
          });
        }
      } else if (file.text) {
        await reply(sock, msg, `📁 *${file.filename}*\n\`\`\`${file.text.substring(0, 3900)}\`\`\``);
        if (file.text.length > 3900) {
          await reply(sock, msg, `_(File truncated. ${file.text.length} chars total)_`);
        }
      }
    } catch (err) {
      error("File send error:", err.message);
    }
    return;
  }

  // Multiple files — send a summary with file list
  const summary = result.files.map((f, i) => `${i + 1}. ${f.filename || "file" + i}`).join("\n");
  const preview = `📁 *Build complete — ${result.files.length} files*\n\n${summary}`;
  await reply(sock, msg, preview);

  // Send each file individually
  for (const file of result.files) {
    try {
      await sleep(500);
      if (file.buffer) {
        const filename = file.filename || "output.txt";
        const ext = path.extname(filename).toLowerCase();
        const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
        if (imageExts.includes(ext)) {
          await sock.sendMessage(chatId, { image: file.buffer, caption: `📁 ${filename}` });
        } else {
          await sock.sendMessage(chatId, {
            document: file.buffer,
            mimetype: file.mimetype || "application/octet-stream",
            fileName: filename,
          });
        }
      }
    } catch (err) {
      error("File send error:", err.message);
    }
  }
}

module.exports = { handleResponseWithFile };
