// ── Media Tools: music + video download via yt-dlp/ffmpeg ─────
// Provides yt-dlp-backed helpers for:
//   • music search + audio download (!play)
//   • YouTube / TikTok / Instagram / generic video download (!yt !tiktok !ig)
// Falls back gracefully (returns success:false) if yt-dlp is unavailable or the
// source rejects the request — never throws into the caller.

const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const axios = require("axios");
const { resolveYtDlp, commandArgs } = require("../utils/mediaRuntime");

const TEMP_DIR = path.join(os.tmpdir(), "aria-media");
try { fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch (_) {}

function mediaDownloadEnabled() {
  return String(process.env.MEDIA_DOWNLOAD_ENABLED || "1").trim() !== "0";
}

function mediaDownloadMaxMb() {
  const configured = Number.parseInt(process.env.MEDIA_DOWNLOAD_MAX_MB || "50", 10);
  if (!Number.isFinite(configured)) return 50;
  return Math.min(100, Math.max(1, configured));
}

function exec(cmd, args, timeoutMs = 120000, env = process.env) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

// Build the base yt-dlp flags shared by all operations.
//  - Prefer Deno for yt-dlp's JavaScript challenge solver. If Deno is not
//    installed, use the Node 22 runtime by name (not its absolute path).
//  - Cookies from the YT_COOKIES env var (a Netscape-format cookies.txt pasted
//    into Render env) to get past YouTube's bot wall.
function whichBin(name) {
  try {
    const out = require("child_process").execSync(`which ${name}`, { stdio: "ignore" });
    return out ? String(out).trim() : "";
  } catch (_) { return ""; }
}

function ytBaseFlags() {
  const flags = [];
  const runtime = whichBin("deno") ? "deno" : (whichBin("node") ? "node" : "");
  if (runtime) flags.push("--js-runtimes", runtime);
  const cookies = process.env.YT_COOKIES;
  if (cookies && cookies.trim()) {
    const f = path.join(TEMP_DIR, "yt_cookies.txt");
    try { fs.writeFileSync(f, cookies); flags.push("--cookies", f); } catch (_) {}
  }
  return flags;
}

function summarizeYtError(stderr, code) {
  const lines = String(stderr || "")
    .replace(/https?:\/\/[^\s]+/g, "[url]")
    .replace(/--cookies\s+[^\s]+/g, "--cookies [redacted]")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\[debug\]/i.test(line));
  const useful = lines.slice(-1)[0] || `yt-dlp exited ${code}`;
  return useful.slice(0, 360);
}

// yt-dlp search: query -> { title, id, url } best match.
// Uses flat extraction (--flat-playlist --print) so search works without needing
// a resolvable format. The old -J approach made yt-dlp try to resolve formats and
// failed with "Requested format is not available" -> search always returned null.
async function searchYt(query) {
  const command = resolveYtDlp();
  if (!command) return null;
  const r = await exec(command.file, commandArgs(command, [
    ...ytBaseFlags(),
    "--flat-playlist",
    "--no-warnings",
    "--print", "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s",
    "ytsearch1:" + query,
  ]), 45000, command.env);
  if (r.err) return null;
  const line = String(r.stdout).split("\n").find((l) => l.includes("\t"));
  if (!line) return null;
  const [id, title, duration, uploader] = line.split("\t");
  if (!id) return null;
  return {
    title: title || query,
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    duration: duration ? Number(duration) || 0 : undefined,
    uploader,
  };
}

// Download audio (mp3) from a yt-dlp-able source. Returns { success, filePath, size, title }.
async function downloadAudio(sourceUrl, title = "") {
  const outBase = path.join(TEMP_DIR, `aria_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
  return new Promise((resolve) => {
    const args = [
      ...ytBaseFlags(),
      "-f", "bestaudio/best",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "--max-filesize", "50M",
      "-o", outBase + ".%(ext)s",
      "--no-playlist",
    ];
    args.push(sourceUrl);
    const command = resolveYtDlp();
    if (!command) return resolve({ success: false, error: "yt-dlp unavailable" });
    const proc = spawn(command.file, commandArgs(command, args), { env: command.env, timeout: 300000 });
    proc.on("error", () => resolve({ success: false, error: "yt-dlp unavailable" }));
    proc.on("close", (code) => {
      const file = fs.readdirSync(TEMP_DIR).find((f) => f.startsWith(path.basename(outBase)));
      if (code === 0 && file) {
        const fp = path.join(TEMP_DIR, file);
        return resolve({ success: true, filePath: fp, size: fs.statSync(fp).size, title });
      }
      resolve({ success: false, error: code !== 0 ? "yt-dlp exited " + code : "no audio produced" });
    });
  });
}

// Download video (mp4) from a yt-dlp-able source. Returns { success, filePath, size, title }.
async function downloadVideo(sourceUrl, maxMB = 50) {
  const outBase = path.join(TEMP_DIR, `aria_v_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
  return new Promise((resolve) => {
    const args = [
      ...ytBaseFlags(),
      // Prefer a single MP4 so public Facebook/TikTok share URLs work even
      // when the VPS has no ffmpeg stream-merging binary.
      "-f", "best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "--max-filesize", `${maxMB}M`,
      "--retries", "2",
      "--extractor-retries", "2",
      "-o", outBase + ".%(ext)s",
      "--no-playlist",
    ];
    args.push(sourceUrl);
    const command = resolveYtDlp();
    if (!command) return resolve({ success: false, error: "yt-dlp unavailable" });
    const proc = spawn(command.file, commandArgs(command, args), { env: command.env, timeout: 600000 });
    proc.on("error", () => resolve({ success: false, error: "yt-dlp unavailable" }));
    let stderr = "";
    proc.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    proc.on("close", (code) => {
      const file = fs.readdirSync(TEMP_DIR).find((f) => f.startsWith(path.basename(outBase)));
      if (code === 0 && file) {
        const fp = path.join(TEMP_DIR, file);
        return resolve({ success: true, filePath: fp, size: fs.statSync(fp).size, title: "" });
      }
      resolve({ success: false, error: code !== 0 ? summarizeYtError(stderr, code) : "no video produced" });
    });
  });
}

module.exports = { searchYt, downloadAudio, downloadVideo, mediaDownloadEnabled, mediaDownloadMaxMb, TEMP_DIR, ytBaseFlags };
