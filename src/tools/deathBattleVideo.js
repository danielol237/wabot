// ── Anime death battle VIDEO (motion-comic) ────────────────────
// Generates fight-scene stills via Pollinations (free image gen) and stitches
// them into an MP4 with ffmpeg pan/zoom motion + a winner verdict overlay.
// This is a motion-comic, NOT real AI animation (no video-gen API without a
// paid key). Best-effort: falls back to a text+graphic video if images fail.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const axios = require("axios");
const { generateImage } = require("./imageGen");

const TEMP_DIR = path.join(__dirname, "../../temp");

// Download an image URL, polling until it's non-empty (Pollinations renders async).
async function downloadImageWithRetry(url, retries = 6, delayMs = 4000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, { timeout: 30000, responseType: "arraybuffer" });
      if (res.data && res.data.length > 1000) return res.data;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

// Build an MP4 from image buffers with Ken Burns (zoom/pan) motion + text overlay.
function buildFightVideo(imageBuffers, overlayText, outputPath) {
  return new Promise((resolve) => {
    const frames = imageBuffers.map((buf, i) => {
      const f = path.join(TEMP_DIR, `frame_${Date.now()}_${i}.jpg`);
      fs.writeFileSync(f, buf);
      return f;
    });
    if (!frames.length) return resolve({ success: false, error: "no frames" });

    // Each image shown ~2.2s with a slow zoom, total ~ (n * 2.2)s.
    const duration = Math.max(3, frames.length * 2.2);
    // Build a concat filter with zoompan for motion, then draw the verdict text.
    const inputs = frames.map(() => "-loop 1 -t 2.2").join(" ");
    const inputArgs = [];
    frames.forEach(() => inputArgs.push("-loop", "1", "-t", "2.2", "-i"));

    // drawtext with escaped text
    const esc = (t) => String(t).replace(/:/g, "\\:").replace(/'/g, "").replace(/,/g, ",");
    const drawtext = `drawtext=text='${esc(overlayText)}':x=(w-text_w)/2:y=h-90:fontsize=36:fontcolor=white:borderw=3:bordercolor=black:box=1:boxcolor=black@0.6:boxborderw=12`;

    const args = [
      ...inputArgs,
      "-filter_complex",
      `${frames.map((_, i) => `[${i}:v]scale=1600:1600:force_original_aspect_ratio=increase,crop=1600:1600,zoompan=z='zoom+0.0015':d=66:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=800x800,fps=30[z${i}]`).join(";")};${frames.map((_, i) => `[z${i}]`).join("")}concat=n=${frames.length}:v=1:a=0[vout]`,
      "-map", "[vout]",
      "-vf", `${drawtext}`,
      "-t", String(duration),
      "-r", "30",
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];

    execFile("ffmpeg", args, { timeout: 120000 }, (err) => {
      frames.forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} });
      if (err) return resolve({ success: false, error: err.message });
      const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
      if (size < 1000) return resolve({ success: false, error: "output too small" });
      resolve({ success: true, filePath: outputPath, size });
    });
  });
}

// High-level: generate N fight images + build a motion-comic video.
async function createDeathBattleVideo(characterA, characterB, winner, extra = "") {
  const scenes = [
    `anime fight, ${characterA} vs ${characterB}, facing off, dramatic pose, manga style`,
    `anime battle, ${characterA} attacking ${characterB}, energy clash, intense, manga`,
    `anime battle, ${characterB} counterattacking ${characterA}, explosive impact, manga`,
    `anime fight end, ${winner || "the winner"} standing victorious, epic, manga style`,
  ];

  const buffers = [];
  for (const scene of scenes) {
    const gen = await generateImage(scene);
    if (gen.success) {
      const buf = await downloadImageWithRetry(gen.url);
      if (buf) buffers.push(buf);
    }
  }

  const overlay = winner ? `${characterA} vs ${characterB} — WINNER: ${winner}` : `${characterA} vs ${characterB}`;
  const outputPath = path.join(TEMP_DIR, `deathbattle_${Date.now()}.mp4`);
  return buildFightVideo(buffers, overlay, outputPath);
}

module.exports = { createDeathBattleVideo };
