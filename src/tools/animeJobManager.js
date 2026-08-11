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

const TEMP_DIR = path.join(__dirname, "../../temp");
const QUEUE_FILE = path.join(__dirname, "../../data/animeQueue.json");

// yt-dlp is an external binary (not an npm dep). Verify it's present and
// report clearly so a deploy without it fails loudly instead of silently
// breaking every download at the yt-dlp step.
function checkYtDlp() {
  return new Promise((resolve) => {
    execFile("yt-dlp", ["--version"], { timeout: 8000 }, (err, stdout) => {
      if (err) {
        error("yt-dlp binary NOT available — anime downloads will fail at the download step. Install yt-dlp on the host (e.g. pip install yt-dlp) or add it to the deployment.");
        return resolve(false);
      }
      log(`[anime] yt-dlp ${String(stdout).trim()} ready`);
      resolve(true);
    });
  });
}

// Probe a single external binary and report availability. Used by the dashboard
// health endpoint so missing runtime deps (yt-dlp/ffmpeg/docker/python) are
// visible before a download or code-exec is attempted, not discovered after.
function checkBinary(cmd, versionArgs = ["--version"]) {
  return new Promise((resolve) => {
    execFile(cmd, versionArgs, { timeout: 8000 }, (err) => {
      resolve(!err);
    });
  });
}

async function getRuntimeDeps() {
  const [ytDlp, ffmpeg, ffprobe, python, docker] = await Promise.all([
    checkBinary("yt-dlp"),
    checkBinary("ffmpeg", ["-version"]),
    checkBinary("ffprobe", ["-version"]),
    checkBinary("python3", ["--version"]),
    checkBinary("docker", ["--version"]),
  ]);
  return { ytDlp, ffmpeg, ffprobe, python3: python, docker };
}

// ── Configuration ─────────────────────────────────────────────────
const MAX_CONCURRENT_DOWNLOADS = Number(process.env.ANIME_MAX_CONCURRENT || 2);
// yt-dlp size cap for a single file (keeps the bot from ballooning).
const MAX_DOWNLOAD_MB = Number(process.env.ANIME_MAX_MB || 1500);
// Hard WhatsApp media ceiling. Above this we refuse to upload and say why.
const WHATSAPP_MAX_MB = Number(process.env.ANIME_WHATSAPP_MAX_MB || 60);

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

// Structured error factory.
function jobError(code, provider, stage, message, retryable = true) {
  return { code, provider, stage, message, retryable, timestamp: new Date().toISOString() };
}

// ── Provider adapters ─────────────────────────────────────────────
// Each adapter is fully self-contained: its own search() returns anime
// results tagged with the provider, and resolve() only ever consumes that
// provider's own IDs. Never cross IDs between providers.

const adapters = {
  // OmniSave — direct MP4, self-contained (subjectId + detailPath).
  omnisave: {
    name: "omnisave",
    priority: 1,
    async search(query) {
      const { searchOmniSave } = require("./animeDownload");
      const list = await searchOmniSave(query);
      return list.map((r) => ({ ...r, provider: "omnisave" }));
    },
    async resolve(anime, episode) {
      const { getOmniSaveDownload, searchOmniSaveById } = require("./animeDownload");
      let detailPath = anime.detailPath || "";
      if (!detailPath) {
        const d = await searchOmniSaveById(anime.subjectId);
        detailPath = d?.detailPath || "";
      }
      if (!detailPath) {
        throw jobError("SOURCE_NOT_FOUND", "omnisave", "extract", "no detailPath for subject", true);
      }
      const dl = await getOmniSaveDownload(anime.subjectId, detailPath, 1, episode || 1);
      const url = dl?.downloads?.find((d) => d?.url)?.url || dl?.downloads?.[0]?.url;
      if (!url) {
        throw jobError("SOURCE_NOT_FOUND", "omnisave", "extract", "no usable download URL (VIP-locked or empty)", true);
      }
      return {
        provider: "omnisave",
        url,
        type: /\.m3u8/i.test(url) ? "hls" : "mp4",
        quality: anime.quality || "unknown",
        headers: { ...DEFAULT_HEADERS },
        title: anime.title || "",
      };
    },
  },

  // Gogoanime / Anitaku — slug id -> m3u8 via encrypt-ajax. Needs referer.
  gogoanime: {
    name: "gogoanime",
    priority: 2,
    async search(query) {
      const { searchGogo, HOSTS } = require("./animeGogo");
      const list = await searchGogo(query);
      return list.map((r) => ({ ...r, provider: "gogoanime", _hosts: HOSTS }));
    },
    async resolve(anime, episode) {
      const { gogoAnimeStream, HOSTS } = require("./animeGogo");
      const slug = String(anime.id || "").replace(/^category\//, "").replace(/\/$/, "");
      if (!slug) throw jobError("ANIME_NOT_FOUND", "gogoanime", "search", "no gogo slug", true);
      const gogo = await gogoAnimeStream(slug, episode);
      if (!gogo.m3u8) {
        throw jobError("SOURCE_NOT_FOUND", "gogoanime", "extract", gogo.error || "no m3u8", true);
      }
      const referer = (Array.isArray(HOSTS) && HOSTS[0]) || "https://gogoanime3.net/";
      return {
        provider: "gogoanime",
        url: gogo.m3u8,
        type: "hls",
        quality: "unknown",
        headers: { ...DEFAULT_HEADERS, Referer: referer, Origin: referer.replace(/\/$/, "") },
        title: gogo.title || anime.title || "",
      };
    },
  },

  // Consumet maintained providers (Hianime / AnimePahe / AnimeKai / AnimeUnity).
  // consumetSearch already returns the winning provider + its own id; we keep
  // them paired so resolve() uses the exact same provider.
  consumet: {
    name: "consumet",
    priority: 3,
    async search(query) {
      const { consumetSearch } = require("./animeConsumet");
      const c = await consumetSearch(query);
      if (!c.results?.length) return [];
      return c.results.map((r) => ({ ...r, provider: "consumet", _consumetSource: c.source }));
    },
    async resolve(anime, episode) {
      const { consumetEpisodeStream } = require("./animeConsumet");
      const providerName = anime._consumetSource;
      if (!providerName) {
        throw jobError("SEARCH_FAILED", "consumet", "search", "no consumet provider resolved", true);
      }
      const got = await consumetEpisodeStream(anime.id, episode, providerName);
      if (!got?.url) {
        throw jobError("SOURCE_NOT_FOUND", "consumet/" + providerName, "extract", got?.error || "no stream source", true);
      }
      // Per-provider referer needed for protected HLS streams.
      const refererMap = {
        Hianime: "https://hianime.to/",
        AnimePahe: "https://animepahe.ru/",
        AnimeKai: "https://animekai.to/",
        AnimeUnity: "https://animeunity.so/",
      };
      const referer = refererMap[providerName] || "";
      return {
        provider: "consumet/" + providerName,
        url: got.url,
        type: "hls",
        quality: "unknown",
        headers: { ...DEFAULT_HEADERS, ...(referer ? { Referer: referer } : {}) },
        title: got.title || anime.title || "",
      };
    },
  },

  // AnimePahe hand-rolled scraper — works only for MD5 ids from its own search.
  animepahe: {
    name: "animepahe",
    priority: 4,
    async search(query) {
      const { searchAnimePahe } = require("./animeDownload");
      const list = await searchAnimePahe(query);
      return list.map((r) => ({ ...r, provider: "animepahe" }));
    },
    async resolve(anime, episode) {
      const { animepaheGetStreamUrl } = require("./animeDownload");
      if (!/^[a-f0-9]{32}$/i.test(String(anime.id || ""))) {
        throw jobError("ANIME_NOT_FOUND", "animepahe", "search", "id is not an AnimePahe MD5", true);
      }
      const pahe = await animepaheGetStreamUrl(anime.id, episode);
      if (!pahe.m3u8) {
        throw jobError("SOURCE_NOT_FOUND", "animepahe", "extract", pahe.error || "no m3u8", true);
      }
      return {
        provider: "animepahe",
        url: pahe.m3u8,
        type: "hls",
        quality: "unknown",
        headers: { ...DEFAULT_HEADERS, Referer: "https://animepahetv.to/", Origin: "https://animepahetv.to" },
        title: pahe.title || anime.title || "",
      };
    },
  },
};

const PROVIDER_ORDER = Object.values(adapters).sort((a, b) => a.priority - b.priority).map((a) => a);

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
    const out = queue
      .map((id) => jobs.get(id))
      .filter(Boolean)
      .map((j) => ({
        id: j.id,
        name: j.name,
        episode: j.episode,
        preferred: j.preferred,
        quality: j.quality,
        chatId: j.chatId,
        createdAt: j.createdAt,
      }));
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(out));
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

    const proc = spawn("yt-dlp", args, { timeout: 600000 });
    let errTail = "";
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
      cleanup();
      resolve({ success: false, error: err.message });
    });

    proc.on("close", async (code) => {
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
      resolve({ success: false, error: (code !== 0 ? "yt-dlp exited " + code + ": " : "") + (errTail.trim().split("\n").pop() || "Download failed.") });
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
    send(`⏬ *${job.name}* — Ep ${job.episode}\nResolving a source…`);

    // Honor a preferred provider (from the browser) by trying it first.
    const ordered = job.preferred
      ? [...PROVIDER_ORDER].sort((a, b) => (a.name === job.preferred ? -1 : b.name === job.preferred ? 1 : a.priority - b.priority))
      : PROVIDER_ORDER;

    for (const ad of ordered) {
      // 1. Provider search
      let results = [];
      try {
        step(`${ad.name || "provider"}`, "search", true, "looking up");
        results = await ad.search(job.name);
      } catch (e) {
        step(`${ad.name || "provider"}`, "search", false, e.message);
        job.failures.push(jobError("SEARCH_FAILED", ad.name || "provider", "search", e.message, true));
        continue;
      }
      if (!results.length) {
        step(`${ad.name || "provider"}`, "search", false, "no results");
        job.failures.push(jobError("ANIME_NOT_FOUND", ad.name || "provider", "search", "no results for title", true));
        continue;
      }
      step(`${ad.name || "provider"}`, "anime_id", true, results[0].title || "found");
      const anime = results[0];

      // 2. Resolve episode source
      let src = null;
      try {
        src = await ad.resolve(anime, job.episode);
      } catch (e) {
        const fe = e?.code ? e : jobError("SOURCE_NOT_FOUND", ad.name || "provider", "extract", e?.message || "resolve failed", true);
        step(`${ad.name || "provider"}`, "extract", false, fe.message);
        job.failures.push(fe);
        continue;
      }
      if (!src?.url) {
        const fe = jobError("SOURCE_NOT_FOUND", ad.name || "provider", "extract", "no source returned", true);
        step(`${ad.name || "provider"}`, "extract", false, fe.message);
        job.failures.push(fe);
        continue;
      }
      step(`${src.provider}`, "episode_id", true, `ep ${job.episode}`);

      // 3. Validate the URL before downloading.
      if (!/^https?:\/\//i.test(src.url)) {
        const fe = jobError("SOURCE_EXPIRED", src.provider, "validate", "malformed URL", true);
        step(src.provider, "validate", false, fe.message);
        job.failures.push(fe);
        continue;
      }
      step(src.provider, "source", true, src.type + (src.quality !== "unknown" ? " · " + src.quality : ""));

      // 4. Download with provider headers preserved. For WhatsApp jobs, cap the
      // download at the WhatsApp ceiling UPFRONT (--max-filesize) so yt-dlp
      // aborts early instead of fetching a 1.5 GB file we'll then refuse to
      // send. Browser jobs keep the larger MAX_DOWNLOAD_MB ceiling.
      const isWhatsAppJob = !!(job.sock && job.chatId);
      const dlCap = isWhatsAppJob ? WHATSAPP_MAX_MB : MAX_DOWNLOAD_MB;
      step(src.provider, "download", true, `fetching${job.quality && job.quality !== "best" ? " (" + job.quality + "p)" : ""}…`);
      const dl = await downloadStream(job, src.url, src.headers, dlCap, job.quality || "best", onProgress);
      job.progress = null;
      if (!dl.success) {
        const fe = jobError("DOWNLOAD_FAILED", src.provider, "download", dl.error || "yt-dlp failed", true);
        step(src.provider, "download", false, fe.message);
        job.failures.push(fe);
        continue;
      }
      step(src.provider, "validate", true, `${(dl.size / 1024 / 1024).toFixed(1)} MB`);

      job.result = {
        filePath: dl.filePath,
        size: dl.size,
        url: src.url,
        provider: src.provider,
        type: src.type,
        quality: src.quality,
        title: src.title || job.name,
      };

      // Browser-initiated job: keep the file so the web UI can serve it.
      if (!job.sock || !job.chatId) {
        job.source = "browser";
        step(src.provider, "save", true, `${(dl.size / 1024 / 1024).toFixed(1)} MB ready`);
      } else {
        // WhatsApp job: size-aware upload, then clean up.
        if (dl.size > WHATSAPP_MAX_MB * 1024 * 1024) {
          const fe = jobError("MEDIA_TOO_LARGE", src.provider, "send", `file is ${(dl.size / 1024 / 1024).toFixed(1)} MB, WhatsApp ceiling is ${WHATSAPP_MAX_MB} MB`, false);
          step(src.provider, "send", false, fe.message);
          job.failures.push(fe);
          fs.unlinkSync(dl.filePath);
          continue;
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
          step(src.provider, "send", false, e?.message || "upload failed");
          job.failures.push(jobError("UPLOAD_FAILED", src.provider, "send", e?.message || "upload failed", true));
        } finally {
          try { fs.unlinkSync(dl.filePath); } catch (_) {}
        }
      }

      job.status = "done";
      job.finishedAt = Date.now();
      emit(job);
      return job;
    }

    // All providers exhausted. WhatsApp gets a CONCISE message listing the
    // providers actually tried and why; the full per-step trace stays in
    // job.steps for the dashboard.
    job.status = "failed";
    job.finishedAt = Date.now();
    job.error = job.failures[job.failures.length - 1] || jobError("SOURCE_NOT_FOUND", "all", "extract", "no provider produced a source", true);
    // Map: provider -> last failure message, deduped, only failed providers.
    const failedByProvider = {};
    for (const f of job.failures) {
      const key = f.provider || "unknown";
      if (!failedByProvider[key]) failedByProvider[key] = f.message || "failed";
    }
    const tried = Object.entries(failedByProvider)
      .map(([p, m]) => `• ${p} — ${m}`)
      .join("\n");
    send(`❌ Couldn't download *${job.name}* Ep ${job.episode} (\`${job.id}\`).\n\nSources tried:\n${tried || "• none viable"}\n\n_${job.error.code}. Try again or choose another quality._`);
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
function enqueueAnimeJob({ name, episode, sock, chatId, quotedMsg, preferred, quality }) {
  const job = {
    id: "ANIME-" + uuidv4().slice(0, 8).toUpperCase(),
    name,
    episode,
    preferred: preferred || null,
    quality: quality || "best",
    sock,
    chatId,
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
  pump();
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
  });
  return fresh;
}

function getJob(id) { return jobs.get(id) || null; }

function emit(job) {
  emitter.emit("update", job);
}

module.exports = {
  enqueueAnimeJob,
  retryJob,
  getJob,
  snapshot,
  emitter,
  getRuntimeDeps,
};

// Recover any jobs that were queued before a restart, and check yt-dlp.
loadQueue();
checkYtDlp();
