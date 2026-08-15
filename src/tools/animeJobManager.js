// ── Anime Job Manager ──────────────────────────────────────────────
// Replaces the monolithic search-then-hope downloader with a proper
// provider-adapter pipeline. The core fix: every provider keeps its OWN
// identifier through search -> anime ID -> episode ID -> source. We never
// hand one provider's ID to another provider's resolver (that was the root
// cause of "Consumet: no source").
//
// Architecture:
//   WhatsApp ──> enqueue() ──> job queue ──> worker ──> provider A/B/C
//                                                    └─> validated media
//                                                       └─> WhatsApp sender
//
// Every provider normalizes to the same object:
//   { title, episode, quality, url, type, headers, provider }
// and every failure is a structured error:
//   { code, provider, stage, message, retryable, timestamp, jobId }

const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");
const { log, error, warn } = require("../utils/logger");
const { resolveYtDlp, commandArgs, inspectYtDlp } = require("../utils/mediaRuntime");

const TEMP_DIR = path.join(__dirname, "../../temp");
const QUEUE_FILE = path.join(__dirname, "../../data/animeQueue.json");

// yt-dlp is an external binary (not an npm dep). Cache the check so every
// queued job fails quickly and consistently when deployment dependencies are missing.
let ytDlpCheck = null;
function checkYtDlp({ force = false } = {}) {
  if (force) ytDlpCheck = null;
  if (ytDlpCheck) return ytDlpCheck;
  ytDlpCheck = new Promise((resolve) => {
    const command = resolveYtDlp();
    if (!command) {
      error("yt-dlp is not available in the project-local or configured media runtime.");
      return resolve(false);
    }
    execFile(command.file, commandArgs(command, ["--version"]), { env: command.env, timeout: 8000 }, (err, stdout) => {
      if (err) {
        error(`yt-dlp runtime check failed using ${command.display}: ${err.message}`);
        return resolve(false);
      }
      log(`[anime] yt-dlp ${String(stdout).trim()} ready via ${command.display}`);
      resolve(true);
    });
  });
  return ytDlpCheck;
}

function resetRuntimeChecks() {
  ytDlpCheck = null;
}

// Probe a single external binary and report availability. Used by the dashboard
// health endpoint so missing runtime deps (yt-dlp/ffmpeg/docker/python) are
// visible before a download or code-exec is attempted, not discovered after.
function checkBinary(cmd, versionArgs = ["--version"]) {
  if (cmd === "yt-dlp") return checkYtDlp();
  return new Promise((resolve) => {
    execFile(cmd, versionArgs, { timeout: 8000 }, (err) => {
      resolve(!err);
    });
  });
}

async function getRuntimeDeps({ refresh = false } = {}) {
  if (refresh) resetRuntimeChecks();
  const yt = inspectYtDlp();
  const [ffmpeg, ffprobe, python, docker] = await Promise.all([
    checkBinary("ffmpeg", ["-version"]),
    checkBinary("ffprobe", ["-version"]),
    checkBinary("python3", ["--version"]),
    checkBinary("docker", ["--version"]),
  ]);
  return {
    ytDlp: yt.available,
    ytDlpCommand: yt.command,
    ytDlpVersion: yt.version,
    ytDlpError: yt.error,
    ffmpeg,
    ffprobe,
    python3: python,
    docker,
  };
}

// ── Configuration ─────────────────────────────────────────────────
const MAX_CONCURRENT_DOWNLOADS = Number(process.env.ANIME_MAX_CONCURRENT || 2);
// yt-dlp size cap for a single file (keeps the bot from ballooning).
const MAX_DOWNLOAD_MB = Number(process.env.ANIME_MAX_MB || 1500);
// Hard WhatsApp media ceiling. Above this we refuse to upload and say why.
const WHATSAPP_MAX_MB = Number(process.env.ANIME_WHATSAPP_MAX_MB || 150);
const MEDIA_RETENTION_MS = Math.max(10 * 60 * 1000, Number(process.env.ANIME_MEDIA_RETENTION_MS || 6 * 60 * 60 * 1000));
const ORPHAN_RETENTION_MS = Math.max(MEDIA_RETENTION_MS, Number(process.env.ANIME_ORPHAN_RETENTION_MS || 24 * 60 * 60 * 1000));
const DOWNLOAD_TIMEOUT_MS = Math.max(60 * 1000, Number(process.env.ANIME_DOWNLOAD_TIMEOUT_MS || 8 * 60 * 1000));

function cleanupTempFiles(now = Date.now()) {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const protectedPaths = new Set([...jobs.values()].map((j) => j.result?.filePath).filter(Boolean));
    for (const file of fs.readdirSync(TEMP_DIR)) {
      if (file === ".gitkeep") continue;
      const full = path.join(TEMP_DIR, file);
      const stat = fs.statSync(full);
      if (!stat.isFile() || protectedPaths.has(full)) continue;
      const age = now - stat.mtimeMs;
      const limit = /\.part$|\.ytdl$/i.test(file) ? ORPHAN_RETENTION_MS : MEDIA_RETENTION_MS;
      if (age > limit) fs.unlinkSync(full);
    }
  } catch (_) {}
}

// Structured error factory.
function jobError(code, provider, stage, message, retryable = true) {
  return { code, provider, stage, message, retryable, timestamp: new Date().toISOString() };
}

// The active provider race, validation ladder, and reputation circuit breaker
// live in sourceResolver.js. Keeping this worker focused on job orchestration
// prevents a second adapter map from drifting away from the canonical resolver.

// ── Job store ─────────────────────────────────────────────────────
const emitter = new EventEmitter();
const jobs = new Map();       // id -> job
const queue = [];             // ids awaiting a free worker
let running = 0;

// ── Queue persistence ─────────────────────────────────────────────
// Jobs hold a live WhatsApp `sock` that can't be serialized, so we persist
// only the recoverable metadata of *queued* (not yet started) jobs. On boot,
// these are re-enqueued as download-to-disk jobs (sock=null) and surface in
// the dashboard Downloads panel instead of silently vanishing on restart.
function persistQueue() {
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
    const out = queue
      .map((id) => jobs.get(id))
      .filter(Boolean)
      .slice(0, 100)
      .map((j) => ({
        id: j.id,
        name: j.name,
        episode: j.episode,
        preferred: j.preferred,
        quality: j.quality,
        chatId: j.chatId,
        ownerId: j.ownerId || null,
        sessionId: j.sessionId || null,
        createdBy: j.createdBy || null,
        createdAt: j.createdAt,
      }));
    const tmp = `${QUEUE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (_) {}
}

function loadQueue() {
  let saved = [];
  try { saved = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8")); } catch (_) {}
  if (!Array.isArray(saved)) return;
  for (const rec of saved) {
    if (!rec || !rec.name || !rec.episode) continue;
    if (jobs.has(rec.id)) continue;
    const job = {
      id: rec.id,
      name: rec.name,
      episode: rec.episode,
      preferred: rec.preferred || null,
      quality: rec.quality || "best",
      sock: null, // no live socket after restart -> download-to-disk
      chatId: rec.chatId || null,
      ownerId: rec.ownerId || null,
      sessionId: rec.sessionId || null,
      createdBy: rec.createdBy || null,
      quotedMsg: null,
      source: "recovered",
      status: "queued",
      steps: [],
      failures: [],
      current: null,
      result: null,
      error: null,
      createdAt: rec.createdAt || Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    jobs.set(job.id, job);
    queue.push(job.id);
  }
  // Clean the queue file once recovered so we don't double-recover.
  try { fs.writeFileSync(QUEUE_FILE, "[]"); } catch (_) {}
  if (saved.length) log(`[anime] recovered ${saved.length} queued job(s) from disk`);
}

function snapshot() {
  return {
    current: [...jobs.values()].filter((j) => j.status === "running"),
    queued: queue.map((id) => jobs.get(id)).filter(Boolean),
    recent: [...jobs.values()]
      .filter((j) => j.status === "done" || j.status === "failed")
      .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
      .slice(0, 20),
    counts: {
      queued: queue.length,
      running,
      done: [...jobs.values()].filter((j) => j.status === "done").length,
      failed: [...jobs.values()].filter((j) => j.status === "failed").length,
    },
  };
}

// Quality -> yt-dlp format selector (height-bounded "best").
const QUALITY_FORMATS = {
  "360": "best[height<=360][ext=mp4]/best[height<=360]/best[ext=mp4]/best",
  "480": "best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best",
  "720": "best[height<=720][ext=mp4]/best[height<=720]/best[ext=mp4]/best",
  "1080": "best[height<=1080][ext=mp4]/best[height<=1080]/best[ext=mp4]/best",
  "best": "best[ext=mp4]/best[ext=m4a]/best",
};

// Parse a yt-dlp `--newline` progress line into { percent, speed, eta }.
function parseProgress(line) {
  // [download]  45.3% of 312.00MiB at  4.80MiB/s ETA 00:41
  const m = line.match(/([\d.]+)%\s+of\s+([\d.]+)(\w+)(?:\s+at\s+([\d.]+)(\w+\/s))?(?:\s+ETA\s+([\d:]+))?/);
  if (!m) return null;
  return {
    percent: parseFloat(m[1]),
    total: m[2] + m[3],
    speed: m[4] ? m[4] + m[5] : null,
    eta: m[6] || null,
  };
}

// ── Download helper (yt-dlp with header preservation + validation) ──
// Uses spawn so we can read `--newline` progress live and feed it to
// onProgress (drives the real-time %/speed/ETA updates in WhatsApp + UI).
function downloadStream(job, url, headers, maxMB, quality = "best", onProgress) {
  const id = uuidv4();
  const outputPath = path.join(TEMP_DIR, `${id}.%(ext)s`);
  const format = QUALITY_FORMATS[quality] || QUALITY_FORMATS["best"];
  return new Promise((resolve) => {
    const args = [
      "-f", format,
      "--merge-output-format", "mp4",
      "--max-filesize", `${maxMB}M`,
      "--newline",
      "--progress",
      "-o", outputPath,
    ];
    // Preserve the provider's referer/origin/UA into yt-dlp so protected
    // .m3u8 streams actually resolve (yt-dlp supports these natively).
    if (headers) {
      if (headers.Referer) args.push("--referer", headers.Referer);
      if (headers.Origin) args.push("--add-header", `Origin:${headers.Origin}`);
      if (headers["User-Agent"]) args.push("--add-header", `User-Agent:${headers["User-Agent"]}`);
      for (const [k, v] of Object.entries(headers)) {
        if (["Referer", "Origin", "User-Agent"].includes(k)) continue;
        args.push("--add-header", `${k}:${v}`);
      }
    }
    args.push(url);

    const command = resolveYtDlp();
    if (!command) return resolve({ success: false, error: "yt-dlp runtime is unavailable" });
    const proc = spawn(command.file, commandArgs(command, args), { env: command.env, timeout: DOWNLOAD_TIMEOUT_MS });
    let errTail = "";
    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      errTail = (errTail + "\nDownload timed out while waiting for the media source.").slice(-800);
      try { proc.kill("SIGKILL"); } catch (_) {}
    }, DOWNLOAD_TIMEOUT_MS);
    killTimer.unref?.();
    const onLine = (line) => {
      if (!line) return;
      const p = parseProgress(line);
      if (p) {
        job.progress = p;
        try { onProgress && onProgress(p); } catch (_) {}
      } else {
        errTail = (errTail + "\n" + line).slice(-800);
      }
    };
    proc.stdout.on("data", (d) => String(d).split(/\r?\n/).forEach(onLine));
    proc.stderr.on("data", (d) => String(d).split(/\r?\n/).forEach(onLine));

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      cleanup();
      resolve({ success: false, error: err.message });
    });

    proc.on("close", async (code) => {
      clearTimeout(killTimer);
      const files = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(id));
      const fp = files.length ? path.join(TEMP_DIR, files[0]) : null;
      if (fp) {
        try {
          const stats = fs.statSync(fp);
          // #37/#38: only treat as success if yt-dlp exited cleanly (0), the
          // file is non-trivial, and ffprobe confirms a real video stream. A
          // non-zero exit with a partial file is NOT a successful download.
          if (code === 0 && stats.size > 64 * 1024) {
            const ok = /\.(mp4|mkv|webm|m4v)$/i.test(fp) || isLikelyMedia(fp);
            if (ok && await ffprobeOk(fp)) return resolve({ success: true, filePath: fp, size: stats.size });
          }
          fs.unlinkSync(fp); // too small / bad container — clean it up
        } catch (_) {}
      }
      cleanup();
      resolve({ success: false, error: (timedOut ? "yt-dlp timed out while waiting for the media source." : (code !== 0 ? "yt-dlp exited " + code + ": " : "")) + (timedOut ? "" : (errTail.trim().split("\n").pop() || "Download failed.")) });
    });

    function cleanup() {
      for (const f of fs.readdirSync(TEMP_DIR)) {
        if (f.startsWith(id)) { try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch (_) {} }
      }
    }
  });
}

// Real media validation via ffprobe: confirms the file is a playable media
// container with a real video stream — not just a partial/corrupt blob that
// happens to have an .mp4 extension or an ftyp atom.
function ffprobeOk(fp) {
  return new Promise((resolve) => {
    execFile("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", fp], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(String(stdout).trim().toLowerCase().startsWith("video"));
    });
  });
}

// Cheap container sniff: an m3u8->mp4 remux should start with an MP4 box,
// or contain an ftyp atom within the first bytes.
function isLikelyMedia(fp) {
  try {
    const fd = fs.openSync(fp, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.toString("latin1", 0, n);
    return head.includes("ftyp") || head.includes("moov") || head.includes("matroska") || head.includes("webm");
  } catch (_) { return false; }
}

// ── Worker ────────────────────────────────────────────────────────
async function runJob(job) {
  running++;
  job.status = "running";
  job.startedAt = Date.now();
  emit(job);

  const send = (text) => {
    try {
      if (job.sock && job.chatId) {
        job.sock.sendMessage(job.chatId, { text }, { quoted: job.quotedMsg }).catch(() => {});
      }
    } catch (_) {}
  };

  const step = (provider, stage, ok, message) => {
    job.steps.push({ provider, stage, ok, message, at: new Date().toISOString() });
    job.current = { provider, stage, detail: message };
    log(`[anime:${job.id}] ${provider} ${stage} ${ok ? "OK" : "FAIL"} ${message}`);
    send(`• ${ok ? "✓" : "✗"} ${provider} ${stage}${message ? ": " + message : ""}`);
    emit(job);
  };

  // Live download progress — throttled so we don't spam WhatsApp on every
  // yt-dlp tick. Emits every update (drives the dashboard) but only sends a
  // WhatsApp update at most once per ~8 seconds or on every 10% step.
  let lastProgressSent = 0;
  let lastPct = -1;
  const onProgress = (p) => {
    const now = Date.now();
    const pctStep = Math.floor((p.percent || 0) / 10) * 10;
    if (now - lastProgressSent > 8000 || pctStep !== lastPct) {
      lastProgressSent = now;
      lastPct = pctStep;
      const bar = "█".repeat(Math.round((p.percent || 0) / 5)) + "░".repeat(20 - Math.round((p.percent || 0) / 5));
      send(`⬇️ *${job.name}* Ep ${job.episode} — ${Math.round(p.percent || 0)}%\n${bar}\n${p.speed ? "Speed: " + p.speed : ""}${p.speed && p.eta ? " · " : ""}${p.eta ? "ETA: " + p.eta : ""}${p.total ? " · " + p.total : ""}`.trim());
    }
    emit(job);
  };

  try {
    const [ytReady, ffprobeReady, ffmpegReady] = await Promise.all([
      checkYtDlp(),
      checkBinary("ffprobe", ["-version"]),
      checkBinary("ffmpeg", ["-version"]),
    ]);
    if (!ytReady || !ffprobeReady || !ffmpegReady) {
      const missing = [!ytReady ? "yt-dlp" : null, !ffprobeReady ? "ffprobe" : null, !ffmpegReady ? "ffmpeg" : null].filter(Boolean).join(", ");
      const message = `Anime downloads are unavailable because ${missing} ${missing.includes(",") ? "are" : "is"} not installed. Ask the operator to install the media runtime and retry.`;
      job.status = "failed";
      job.finishedAt = Date.now();
      job.error = jobError("DEPENDENCY_MISSING", "runtime", "preflight", message, false);
      step("runtime", "preflight", false, message);
      return job;
    }
    send(`⏬ *${job.name}* — Ep ${job.episode}\nResolving a playable source…`);

    // ── SOURCE RESOLUTION ENGINE ──
    // Resolve canonical identity → discover candidates concurrently across
    // providers → validate every candidate → quality-route to the best
    // healthy stream. The downloader never picks a provider; it consumes a
    // validated candidate. Broken providers are auto-suppressed by the
    // reputation/circuit-breaker store.
    const resolver = require("./sourceResolver");
    const report = await resolver.resolveEpisode(job.name, job.episode, {
      preference: job.preferred,
      quality: job.quality,
    });

    // Canonical + confidence diagnostic (metadata ≠ downloadable).
    if (report.canonical) {
      const canonicalTitle = report.canonical?.identity?.title || report.canonical?.title || job.name;
      const canonicalId = report.canonical?.identity?.id || report.canonical?.id || "?";
      step("resolver", "canonical", report.canonical.status === "ok", `${canonicalTitle} (id ${canonicalId}${report.confidence?.title != null ? `, title match ${report.confidence.title}%` : ""})`);
    } else {
      step("resolver", "canonical", false, report.error || "no canonical match");
    }

    // Provider discovery diagnostics (all independent attempts).
    for (const d of report.diagnostics || []) {
      step(d.provider, "discover", d.candidateCount > 0, d.candidateCount > 0 ? `${d.candidateCount} candidate(s) · ${d.latencyMs}ms` : (d.error || "no candidate"));
      if (d.candidateCount === 0) {
        job.failures.push(jobError(d.error || "no candidate", d.provider, "discover", d.error || "no results", true));
      }
    }

    // Validation results per candidate.
    for (const [url, v] of Object.entries(report.validation || {})) {
      const prov = report.candidates?.find((c) => c.url === url)?.provider || "?";
      step(prov, "validate", v.ok, v.ok ? "stream OK" : v.reason || "rejected");
      if (!v.ok) job.failures.push(jobError(v.reason || "invalid stream", prov, "validate", v.reason || "invalid", true));
    }

    if (!report.selected) {
      const err = report.error || "no validated source";
      job.status = "failed";
      job.finishedAt = Date.now();
      job.error = jobError("SOURCE_NOT_FOUND", "all", "resolve", err, true);
      const tried = (report.diagnostics || [])
        .map((d) => `• ${d.provider} — ${d.candidateCount > 0 ? `${d.candidateCount} candidate(s)` : (d.error || "no results")}`)
        .join("\n");
      send(`❌ Couldn't resolve *${job.name}* Ep ${job.episode} (\`${job.id}\`).\n\n${report.canonical ? `✓ Found: ${report.canonical.title} (title match ${report.confidence?.title || "?"}%)\n` : ""}Sources tried:\n${tried || "• none viable"}\n\n_${err}_`);
      emit(job);
      return job;
    }

    const src = report.selected;
    const retryOrder = (report.ranked && report.ranked.length) ? report.ranked : [src];
    step("resolver", "selected", true, `${src.provider} · ${src.type}${src.height ? ` · ${src.height}p` : ""}${src.codec ? ` · ${src.codec}` : ""}${src.duration ? ` · ${Number(src.duration).toFixed(0)}s` : ""} · score ${src.score} · ${retryOrder.length} validated fallback(s)`);
    // Persist the last resolver report on the job for the dashboard Sources pane.
    job.resolver = {
      canonical: report.canonical,
      confidence: report.confidence,
      candidates: (report.candidates || []).map((c) => ({ provider: c.provider, type: c.type, quality: c.quality, url: c.url })),
      diagnostics: report.diagnostics,
      validation: report.validation,
      selected: { provider: src.provider, type: src.type, height: src.height, codec: src.codec, duration: src.duration, score: src.score },
    };

    // ── DOWNLOAD the validated candidate ──
    const isWhatsAppJob = !!(job.sock && job.chatId);
    const dlCap = isWhatsAppJob ? WHATSAPP_MAX_MB : MAX_DOWNLOAD_MB;

    // Try each validated candidate in rank order. If the top download fails,
    // fall through to the next validated candidate instead of giving up.
    let dl = null;
    let lastDlError = null;
    let dlCandidate = null;
    for (let i = 0; i < retryOrder.length; i++) {
      const cand = retryOrder[i];
      const isFirst = i === 0;
      if (!isFirst) {
        step(cand.provider, "retry", true, `falling back to validated candidate #${i + 1} (rank ${cand.score})`);
        send(`🔄 *${job.name}* Ep ${job.episode} — top source failed, retrying validated ${cand.provider}…`);
      }
      step(cand.provider, "download", true, `fetching${job.quality && job.quality !== "best" ? " (" + job.quality + "p)" : ""}${cand.height ? ` · ${cand.height}p` : ""}…`);
      dl = await downloadStream(job, cand.url, cand.headers, dlCap, job.quality || "best", onProgress);
      job.progress = null;
      if (dl.success) {
        dlCandidate = cand;
        step(cand.provider, "validate", true, `${(dl.size / 1024 / 1024).toFixed(1)} MB`);
        break;
      }
      lastDlError = dl.error || "yt-dlp failed";
      const fe = jobError("DOWNLOAD_FAILED", cand.provider, "download", lastDlError, true);
      step(cand.provider, "download", false, fe.message);
      job.failures.push(fe);
      // Reputation: mark this candidate's provider for the failed download.
      try { require("./sourceReputation").record(cand.provider, "download", false, { error: lastDlError }); } catch (_) {}
      dl = null;
    }

    if (!dl) {
      const fe = jobError("DOWNLOAD_FAILED", retryOrder[0]?.provider || src.provider, "download", lastDlError || "all validated sources failed", true);
      job.status = "failed";
      job.finishedAt = Date.now();
      job.error = fe;
      emit(job);
      send(`❌ Download failed for *${job.name}* Ep ${job.episode} after trying all ${retryOrder.length} validated source(s): ${lastDlError || "unknown"}`);
      return job;
    }
    // The successful candidate may differ from the initially-selected one.
    const dlProvider = dlCandidate?.provider || src.provider;

    job.result = {
      filePath: dl.filePath,
      size: dl.size,
      url: dlCandidate?.url || src.url,
      provider: dlProvider,
      type: dlCandidate?.type || src.type,
      quality: dlCandidate?.quality || src.quality,
      title: dlCandidate?.title || src.title || job.name,
    };

    if (!job.sock || !job.chatId) {
      job.source = "browser";
      step(src.provider, "save", true, `${(dl.size / 1024 / 1024).toFixed(1)} MB ready`);
    } else {
      if (dl.size > WHATSAPP_MAX_MB * 1024 * 1024) {
        const fe = jobError("MEDIA_TOO_LARGE", src.provider, "send", `file is ${(dl.size / 1024 / 1024).toFixed(1)} MB, WhatsApp ceiling is ${WHATSAPP_MAX_MB} MB`, false);
        step(src.provider, "send", false, fe.message);
        job.failures.push(fe);
        fs.unlinkSync(dl.filePath);
        job.status = "failed";
        job.finishedAt = Date.now();
        job.error = fe;
        emit(job);
        return job;
      }
      step(src.provider, "send", true, "uploading to WhatsApp…");
      try {
        const buffer = fs.readFileSync(dl.filePath);
        await job.sock.sendMessage(job.chatId, {
          video: buffer,
          mimetype: "video/mp4",
          caption: `🎬 ${job.result.title || job.name} — Ep ${job.episode} · ${src.provider}`,
        }, { quoted: job.quotedMsg });
        step(src.provider, "send", true, "delivered ✓");
      } catch (e) {
        const uploadError = e?.message || "upload failed";
        const failure = jobError("UPLOAD_FAILED", src.provider, "send", uploadError, true);
        step(src.provider, "send", false, uploadError);
        job.failures.push(failure);
        job.status = "failed";
        job.finishedAt = Date.now();
        job.error = failure;
        send(`❌ WhatsApp could not receive *${job.name}* Ep ${job.episode}. The download was cleaned up; retry when the connection is stable.`);
        emit(job);
        return job;
      } finally {
        try { fs.unlinkSync(dl.filePath); } catch (_) {}
      }
    }

    job.status = "done";
    job.finishedAt = Date.now();
    emit(job);
    return job;
  } catch (e) {
    job.status = "failed";
    job.finishedAt = Date.now();
    job.error = jobError("UNKNOWN", "pipeline", "run", e?.message || "unexpected error", true);
    send(`❌ Download error: ${e?.message || "unexpected"}`);
    emit(job);
    return job;
  } finally {
    running--;
    pump();
  }
}

function pump() {
  while (running < MAX_CONCURRENT_DOWNLOADS && queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (job) runJob(job).catch(() => {});
  }
  persistQueue();
}

// ── Public API ────────────────────────────────────────────────────
function enqueueAnimeJob({ name, episode, sock, chatId, quotedMsg, preferred, quality, ownerId, sessionId, createdBy }) {
  const boundOwner = ownerId || chatId || null;
  const job = {
    id: "ANIME-" + uuidv4().toUpperCase(),
    name,
    episode,
    preferred: preferred || null,
    quality: quality || "best",
    sock,
    chatId,
    ownerId: boundOwner ? String(boundOwner) : null,
    sessionId: sessionId ? String(sessionId) : null,
    createdBy: createdBy ? String(createdBy) : null,
    quotedMsg,
    status: "queued",
    steps: [],
    failures: [],
    current: null,
    result: null,
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  persistQueue();
  emit(job);
  if (process.env.ANIME_DISABLE_WORKER !== "1") pump();
  return job;
}

function retryJob(id) {
  const old = jobs.get(id);
  if (!old || !old.name) return null;
  const fresh = enqueueAnimeJob({
    name: old.name,
    episode: old.episode,
    preferred: old.preferred,
    quality: old.quality,
    sock: old.sock,
    chatId: old.chatId,
    quotedMsg: old.quotedMsg,
    ownerId: old.ownerId,
    sessionId: old.sessionId,
    createdBy: old.createdBy,
  });
  return fresh;
}

function getJob(id) { return jobs.get(id) || null; }

function getOwnerStats(ownerId) {
  const key = ownerId ? String(ownerId) : null;
  const active = [...jobs.values()].filter((job) => (job.status === "queued" || job.status === "running") && (!key || job.ownerId === key));
  return { active: active.length, queued: active.filter((job) => job.status === "queued").length, running: active.filter((job) => job.status === "running").length };
}

function findActiveJob({ ownerId, name, episode, preferred, quality } = {}) {
  const key = ownerId ? String(ownerId) : null;
  const title = String(name || "").trim().toLowerCase();
  const ep = Number(episode) || 1;
  const pref = preferred || null;
  return [...jobs.values()].find((job) => (job.status === "queued" || job.status === "running") &&
    job.ownerId === key && String(job.name || "").trim().toLowerCase() === title && Number(job.episode) === ep && (job.preferred || null) === pref && (quality == null || String(job.quality || "best") === String(quality))) || null;
}

function emit(job) {
  emitter.emit("update", job);
}

module.exports = {
  enqueueAnimeJob,
  retryJob,
  getJob,
  getOwnerStats,
  findActiveJob,
  snapshot,
  emitter,
  getRuntimeDeps,
  resetRuntimeChecks,
};

// Recover queued jobs and warm the media runtime only in production. Tests can
// still create job records, but must not inherit or execute live downloads.
if (process.env.ANIME_DISABLE_WORKER !== "1") {
  loadQueue();
  // Recovery populates the queue before the worker loop starts. Pump now so
  // queued website/WhatsApp downloads do not remain stranded after a restart.
  pump();
  cleanupTempFiles();
  setInterval(() => cleanupTempFiles(), 15 * 60 * 1000).unref();
  checkYtDlp();
}
