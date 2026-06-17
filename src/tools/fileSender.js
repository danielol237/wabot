const fs = require("fs");
const path = require("path");
const { MessageMedia } = require("whatsapp-web.js");
const { v4: uuidv4 } = require("uuid");
const { uploadToGofile } = require("./gofileUpload");

const TEMP_DIR = path.join(__dirname, "../../temp");
const MAX_DIRECT_SEND_BYTES = 15 * 1024 * 1024; // 15MB — above this, use Gofile link instead

// Supported file types the bot can create and send
const FILE_TYPES = {
  // Code
  js: { ext: "js", mime: "application/javascript", label: "JavaScript" },
  ts: { ext: "ts", mime: "application/typescript", label: "TypeScript" },
  py: { ext: "py", mime: "text/x-python", label: "Python" },
  html: { ext: "html", mime: "text/html", label: "HTML" },
  css: { ext: "css", mime: "text/css", label: "CSS" },
  json: { ext: "json", mime: "application/json", label: "JSON" },
  sh: { ext: "sh", mime: "text/x-sh", label: "Shell Script" },
  sql: { ext: "sql", mime: "text/x-sql", label: "SQL" },
  xml: { ext: "xml", mime: "text/xml", label: "XML" },
  yaml: { ext: "yaml", mime: "text/yaml", label: "YAML" },
  env: { ext: "env", mime: "text/plain", label: "ENV file" },
  // Docs
  txt: { ext: "txt", mime: "text/plain", label: "Text file" },
  md: { ext: "md", mime: "text/markdown", label: "Markdown" },
  csv: { ext: "csv", mime: "text/csv", label: "CSV" },
  // Default fallback
  default: { ext: "txt", mime: "text/plain", label: "File" },
};

async function sendFile(client, chatId, filename, content, caption = "") {
  try {
    const ext = filename.split(".").pop().toLowerCase();
    const type = FILE_TYPES[ext] || FILE_TYPES.default;
    const id = uuidv4();
    const filePath = path.join(TEMP_DIR, `${id}.${type.ext}`);

    fs.writeFileSync(filePath, content, "utf8");
    const stats = fs.statSync(filePath);

    // Big file — upload to Gofile and send a link instead of failing
    if (stats.size > MAX_DIRECT_SEND_BYTES) {
      const result = await uploadToGofile(filePath, filename);
      fs.unlinkSync(filePath);
      if (result.success) {
        await client.sendMessage(chatId, `📄 *${filename}* (too big to send directly)\n${result.downloadPage}`);
        return { success: true, viaLink: true };
      }
      return { success: false, error: result.error };
    }

    const media = MessageMedia.fromFilePath(filePath);
    media.filename = filename;
    media.mimetype = type.mime;

    try {
      await client.sendMessage(chatId, media, {
        caption: caption || `📎 *${filename}*`,
        sendMediaAsDocument: true,
      });
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (sendErr) {
      // Direct send failed (e.g. WhatsApp rejected it) — fall back to Gofile link
      console.error("Direct send failed, trying Gofile:", sendErr.message);
      const result = await uploadToGofile(filePath, filename);
      fs.unlinkSync(filePath);
      if (result.success) {
        await client.sendMessage(chatId, `📄 *${filename}*\n${result.downloadPage}`);
        return { success: true, viaLink: true };
      }
      return { success: false, error: sendErr.message };
    }
  } catch (err) {
    console.error("File send error:", err.message);
    return { success: false, error: err.message };
  }
}

// Detect if AI response contains a code block that should be sent as a file
function extractCodeBlock(text) {
  // Match ```lang\ncode\n``` blocks
  const match = text.match(/```(\w+)?\n([\s\S]+?)```/);
  if (!match) return null;

  const lang = (match[1] || "txt").toLowerCase();
  const code = match[2].trim();

  // Only extract if code is substantial enough to be a file
  if (code.split("\n").length < 5) return null;

  const type = FILE_TYPES[lang] || FILE_TYPES.default;
  return { lang, code, ext: type.ext, label: type.label };
}

module.exports = { sendFile, extractCodeBlock, FILE_TYPES };
