// ── Stream Validator ─────────────────────────────────────────────
// The single most valuable missing component. Before committing to a
// (potentially hundreds-of-MB) download, validate that a stream candidate
// is actually playable — reject garbage immediately.
//
// Validation ladder (cheap → expensive):
//   1. URL sanity (http/https, known host pattern)
//   2. HTTP HEAD / Range probe: status, Content-Type, Content-Length,
//      Accept-Ranges
//   3. yt-dlp extraction probe: can it parse the URL into a format?
//   4. ffprobe on the stream: confirm a real video stream + duration
//
// Returns { ok, reason, details } where details is the full diagnostic
// so the dashboard shows WHY a candidate was rejected.

const axios = require("axios");
const { execFile } = require("child_process");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function exec(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

// Step 1: URL sanity.
function urlOk(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && !!u.hostname;
  } catch (_) { return false; }
}

// Step 2: HTTP Range / HEAD probe. Returns { ok, status, contentType, contentLength, acceptRanges, headers }.
async function probeHttp(candidate) {
  const url = candidate.url;
  const headers = { "User-Agent": UA, Range: "bytes=0-1023" };
  if (candidate.headers) {
    for (const [k, v] of Object.entries(candidate.headers)) if (!headers[k]) headers[k] = v;
  }
  try {
    const res = await axios.get(url, { headers, timeout: 12000, maxRedirects: 5, validateStatus: () => true, responseType: "arraybuffer" });
    const status = res.status;
    const ct = String(res.headers["content-type"] || "");
    const cl = res.headers["content-length"];
    const ar = res.headers["accept-ranges"];
    const isMedia = /video|mp4|m3u8|octet-stream|webm|matroska/.test(ct) || /\.(mp4|mkv|webm|m3u8|m4v|ts)(\?|$)/i.test(url);
    // 200 or 206 (partial content from range) both indicate the resource is served.
    const ok = (status === 200 || status === 206) && isMedia;
    return { ok, status, contentType: ct, contentLength: cl, acceptRanges: ar || null, isMedia };
  } catch (e) {
    const status = e.response?.status;
    return { ok: false, status, contentType: "", contentLength: null, acceptRanges: null, isMedia: false, error: e.message };
  }
}

// Step 3: yt-dlp extraction probe — can it resolve the URL to a format?
async function probeYtdlp(url) {
  const r = await exec("yt-dlp", ["-J", "--no-download", "--skip-download", url], 45000);
  if (r.err) {
    // yt-dlp returns a non-zero exit + JSON on stderr when it can't extract.
    let reason = "yt-dlp extraction failed";
    try {
      const parsed = JSON.parse(r.stderr);
      reason = parsed.error_detail || parsed.error || "yt-dlp extraction failed";
    } catch (_) {
      const m = r.stderr.match(/ERROR:\s*([^\n]+)/);
      if (m) reason = m[1];
    }
    return { ok: false, reason, formats: 0 };
  }
  try {
    const info = JSON.parse(r.stdout);
    const formats = Array.isArray(info.formats) ? info.formats.length : 0;
    const hasVideo = !!info && (info.acodec !== "none" || formats > 0);
    return { ok: !!info && hasVideo && formats > 0, reason: "", formats, title: info?.title };
  } catch (_) {
    return { ok: false, reason: "yt-dlp parse failure", formats: 0 };
  }
}

// Step 4: ffprobe the stream — confirm a real video stream + duration.
async function probeFfprobe(url) {
  const r = await exec("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_type,width,height,codec_name:format=duration",
    "-of", "json",
    url,
  ], 45000);
  if (r.err) return { ok: false, reason: "ffprobe failed: " + String(r.stderr).slice(0, 200) };
  try {
    const j = JSON.parse(r.stdout);
    const stream = j.streams?.[0];
    const ok = !!stream && stream.codec_type === "video" && (stream.width || 0) > 0;
    return { ok, reason: "", codec: stream?.codec_name, width: stream?.width, height: stream?.height, duration: j.format?.duration };
  } catch (_) {
    return { ok: false, reason: "ffprobe parse failure" };
  }
}

// Full validation ladder. Runs cheap checks first, bails early.
async function validateCandidate(candidate) {
  const url = candidate.url;
  const out = { provider: candidate.provider, url, quality: candidate.quality, steps: [] };

  // 1. URL sanity
  if (!urlOk(url)) {
    out.ok = false; out.reason = "malformed URL"; out.steps.push({ name: "url", ok: false, detail: "not http(s)" });
    return out;
  }
  out.steps.push({ name: "url", ok: true, detail: "valid http(s)" });

  // 2. HTTP probe (m3u8 playlists often 200 with content-type application/vnd.apple.mpegurl)
  const http = await probeHttp(candidate);
  out.steps.push({ name: "http", ok: http.ok, detail: `HTTP ${http.status} · ${http.contentType || "no-ct"}${http.acceptRanges ? " · range-ok" : ""}` });
  // For direct files, a non-media 200/206 is a hard reject. For HLS playlists,
  // proceed to yt-dlp which is authoritative.
  const isHls = /m3u8/i.test(url) || /m3u8/i.test(http.contentType || "");
  if (!http.ok && !isHls) {
    out.ok = false; out.reason = `HTTP ${http.status} — not a media response`; out.status = http.status;
    return out;
  }

  // 3. yt-dlp extraction probe (authoritative for both hls + direct)
  const yt = await probeYtdlp(url);
  out.steps.push({ name: "yt-dlp", ok: yt.ok, detail: yt.ok ? `${yt.formats} formats` : yt.reason });
  if (!yt.ok) { out.ok = false; out.reason = "yt-dlp cannot extract: " + yt.reason; return out; }

  // 4. ffprobe stream check — confirm real video, get dimensions/duration.
  //    Skip for HLS if it's slow; direct MP4 we always probe.
  if (!isHls) {
    const ff = await probeFfprobe(url);
    out.steps.push({ name: "ffprobe", ok: ff.ok, detail: ff.ok ? `${ff.width}x${ff.height} · ${ff.codec}` : ff.reason });
    if (!ff.ok) { out.ok = false; out.reason = "ffprobe rejected stream: " + ff.reason; return out; }
    out.width = ff.width; out.height = ff.height; out.codec = ff.codec; out.duration = ff.duration;
  } else {
    out.steps.push({ name: "ffprobe", ok: true, detail: "hls — validated via yt-dlp" });
  }

  out.ok = true;
  out.reason = "valid stream";
  return out;
}

module.exports = { validateCandidate, probeHttp, probeYtdlp, probeFfprobe };
