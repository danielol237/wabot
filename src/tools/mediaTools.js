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

const TEMP_DIR = path.join(os.tmpdir(), "aria-media");
try { fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch (_) {}

function exec(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

// Build the base yt-dlp flags shared by all operations.
//  - Deno as the JS runtime (YouTube extraction now needs one; deno is what
//    yt-dlp prefers). Falls back to node if deno isn't on PATH.
//  - Cookies from the YT_COOKIES env var (a Netscape-format cookies.txt pasted
//    into Render env) to get past YouTube's 2026 bot wall.
function whichBin(name) {
  try {
    const out = require("child_process").execSync(`which ${name}`, { stdio: "ignore" });
    return out ? String(out).trim() : "";
  } catch (_) { return ""; }
}

function ytBaseFlags() {
  const flags = [];
  const runtime = whichBin("deno") || whichBin("node");
  if (runtime) flags.push("--js-runtimes", runtime);
  const cookies = process.env.YT_COOKIES;
  if (cookies && cookies.trim()) {
    const f = path.join(TEMP_DIR, "yt_cookies.txt");
    try { fs.writeFileSync(f, cookies); flags.push("--cookies", f); } catch (_) {}
  }
  return flags;
}

// yt-dlp search: query -> { title, id, url } best match.
// Uses flat extraction (--flat-playlist --print) so search works without needing
// a resolvable format. The old -J approach made yt-dlp try to resolve formats and
// failed with "Requested format is not available" -> search always returned null.
async function searchYt(query) {
  const r = await exec("yt-dlp", [
    ...ytBaseFlags(),
    "--flat-playlist",
    "--no-warnings",
    "--print", "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s",
    "ytsearch1:" + query,
  ], 45000);
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
    const proc = spawn("yt-dlp", args, { timeout: 300000 });
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
      "-f", "bv*+ba/b",
      "--merge-output-format", "mp4",
      "--max-filesize", `${maxMB}M`,
      "-o", outBase + ".%(ext)s",
      "--no-playlist",
    ];
    args.push(sourceUrl);
    const proc = spawn("yt-dlp", args, { timeout: 600000 });
    proc.on("error", () => resolve({ success: false, error: "yt-dlp unavailable" }));
    proc.on("close", (code) => {
      const file = fs.readdirSync(TEMP_DIR).find((f) => f.startsWith(path.basename(outBase)));
      if (code === 0 && file) {
        const fp = path.join(TEMP_DIR, file);
        return resolve({ success: true, filePath: fp, size: fs.statSync(fp).size, title: "" });
      }
      resolve({ success: false, error: code !== 0 ? "yt-dlp exited " + code : "no video produced" });
    });
  });
}

module.exports = { searchYt, downloadAudio, downloadVideo, TEMP_DIR };
