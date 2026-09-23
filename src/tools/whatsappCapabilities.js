const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { isSafeUrl } = require("./webBrowser");

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "../..");
const TEMP_DIR = path.join(ROOT, "temp");
const MAX_DOWNLOAD = 15 * 1024 * 1024;

function clean(value, max = 400) {
  return String(value || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function extractUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;!?]+$/, "") : null;
}

function safeName(value, fallback = "aria-file") {
  const name = path.basename(String(value || "")).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return name || fallback;
}

async function zipDirectory(source, output, excludes = []) {
  const patterns = excludes.map((item) => `-x`).flat();
  const args = ["-qr", output, "."];
  for (const item of excludes) args.push("-x", item);
  await execFileAsync("zip", args, { cwd: source, timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  return output;
}

async function createRepositoryArchive(repositoryPath = ROOT) {
  const root = path.resolve(repositoryPath);
  if (!fs.existsSync(path.join(root, "package.json"))) throw new Error("The local ARIA repository was not found in the running workspace.");
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const output = path.join(TEMP_DIR, `aria-repository-${Date.now()}.zip`);
  await zipDirectory(root, output, ["node_modules/*", "data/*", "temp/*", ".git/*", "sessions/*", "auth_info_baileys/*"]);
  return { path: output, fileName: "aria-wabot-source.zip", size: fs.statSync(output).size };
}

async function downloadPublicAsset(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: MAX_DOWNLOAD,
    headers: { "User-Agent": "Mozilla/5.0 ARIA/1.0", Accept: "*/*" },
  });
  return { buffer: Buffer.from(response.data), contentType: String(response.headers?.["content-type"] || "application/octet-stream").split(";")[0] };
}

async function snapshotWebsite(url) {
  if (!url || !(await isSafeUrl(url))) throw new Error("Only public HTTP(S) websites can be copied.");
  const response = await axios.get(url, { timeout: 30000, maxContentLength: 8 * 1024 * 1024, headers: { "User-Agent": "Mozilla/5.0 ARIA/1.0" } });
  const base = new URL(url);
  const $ = cheerio.load(String(response.data || ""), { decodeEntities: false });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-site-copy-"));
  const assets = path.join(root, "assets");
  fs.mkdirSync(assets, { recursive: true });
  const saved = [];

  async function saveResource(raw, prefix) {
    try {
      const absolute = new URL(raw, base).toString();
      const resourceUrl = new URL(absolute);
      if (resourceUrl.origin !== base.origin || !(await isSafeUrl(absolute))) return null;
      const asset = await downloadPublicAsset(absolute);
      const ext = path.extname(resourceUrl.pathname).split("?")[0] || (asset.contentType.includes("css") ? ".css" : ".bin");
      const filename = `${prefix}-${saved.length}${ext.slice(0, 8)}`;
      fs.writeFileSync(path.join(assets, filename), asset.buffer);
      saved.push(filename);
      return `assets/${filename}`;
    } catch (_) { return null; }
  }

  for (const element of $("link[rel='stylesheet'][href]").toArray()) {
    const replacement = await saveResource($(element).attr("href"), "style");
    if (replacement) $(element).attr("href", replacement);
  }
  for (const element of $("img[src]").toArray()) {
    const replacement = await saveResource($(element).attr("src"), "image");
    if (replacement) $(element).attr("src", replacement);
  }
  $("script[src]").each((_, element) => {
    const src = $(element).attr("src");
    if (src) $(element).attr("data-original-src", new URL(src, base).toString());
  });
  fs.writeFileSync(path.join(root, "index.html"), $.html(), "utf8");
  fs.writeFileSync(path.join(root, "README.md"), `# ARIA website snapshot\n\nSource: ${url}\n\nThis is a local snapshot of publicly accessible HTML and same-origin assets. Interactive server features, authentication, and private content are not copied.\n`, "utf8");
  const output = path.join(TEMP_DIR, `aria-website-snapshot-${Date.now()}.zip`);
  await zipDirectory(root, output);
  fs.rmSync(root, { recursive: true, force: true });
  return { path: output, fileName: `${safeName(base.hostname, "website")}-snapshot.zip`, size: fs.statSync(output).size, source: url, assets: saved.length };
}

async function sendDocument(sock, chatId, file, quoted) {
  const data = fs.readFileSync(file.path);
  await sock.sendMessage(chatId, { document: data, fileName: file.fileName || safeName(file.path), mimetype: "application/zip", caption: file.caption || "ARIA file delivery" }, { quoted });
  try { fs.unlinkSync(file.path); } catch (_) {}
  return { success: true, fileName: file.fileName, size: data.length };
}

async function publishStatus(sock, media, caption = "") {
  const statusJid = "status@broadcast";
  const payload = media.kind === "text"
    ? { text: caption }
    : media.kind === "video"
      ? { video: media.buffer, mimetype: media.mimeType || "video/mp4", caption }
      : { image: media.buffer, mimetype: media.mimeType || "image/jpeg", caption };
  await sock.sendMessage(statusJid, payload);
  return { success: true, kind: media.kind };
}

async function leaveGroup(sock, chatId) {
  if (!String(chatId || "").endsWith("@g.us")) throw new Error("This request is not inside a WhatsApp group.");
  await sock.groupLeave(chatId);
  return { success: true, chatId };
}

module.exports = { extractUrl, createRepositoryArchive, snapshotWebsite, downloadPublicAsset, sendDocument, publishStatus, leaveGroup, safeName, _test: { clean } };

void clean;
void os;
