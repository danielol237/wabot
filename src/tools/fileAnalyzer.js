const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getAIResponse } = require("./ai");

const TEMP_DIR = path.join(__dirname, "../../temp");

async function analyzeFile(media, question) {
  if (!media || !media.data) return "❌ No file data received.";
  const { mimetype, data, filename } = media;
  const mime = mimetype || "";
  const ext = (filename?.split(".").pop() || mime.split("/")[1] || "bin").toLowerCase();
  const id = uuidv4();
  const filePath = path.join(TEMP_DIR, `${id}.${ext}`);

  try {
    // Write file to disk. `data` may be a Buffer already (from baileys download)
    // or a base64 string — handle both so we never corrupt a raw Buffer.
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "base64");
    fs.writeFileSync(filePath, buffer);

    let content = "";

    // PDF
    if (mimetype === "application/pdf" || ext === "pdf") {
      const pdfParse = require("pdf-parse");
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(buffer);
      content = parsed.text.slice(0, 4000);
    }

    // Word docs
    else if (ext === "docx" || mimetype.includes("word")) {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ path: filePath });
      content = result.value.slice(0, 4000);
    }

    // CSV
    else if (ext === "csv" || mimetype === "text/csv") {
      content = fs.readFileSync(filePath, "utf8").slice(0, 4000);
    }

    // Plain text
    else if (mimetype.startsWith("text/") || ext === "txt" || ext === "json" || ext === "md") {
      content = fs.readFileSync(filePath, "utf8").slice(0, 4000);
    }

    // Image — use vision model to actually see and describe it
    else if (mime.startsWith("image/")) {
      const { analyzeImage } = require("./visionAI");
      const result = await analyzeImage(buffer.toString("base64"), mime, question);
      return result;
    }

    // Unsupported
    else {
      return `❌ I can't read *${ext}* files yet. Supported: PDF, DOCX, CSV, TXT, JSON, images.`;
    }

    if (!content.trim()) return "❌ The file appears to be empty or unreadable.";

    const prompt = `The user sent a file. Here's its content:\n\n${content}\n\nUser's question/request: "${question}"\n\nRespond helpfully.`;
    const response = await getAIResponse(prompt, "User", []);
    return response;
  } catch (err) {
    console.error("File analyze error:", err.message);
    return `❌ Failed to read file: ${err.message}`;
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

module.exports = { analyzeFile };
