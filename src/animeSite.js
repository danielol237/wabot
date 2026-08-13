// ── ARIA Anime — standalone public site ──────────────────────────
// A separate, public anime streaming/download site. NOT part of the dashboard.
// Mounted at /anime (public, no auth). Reuses the same animeService +
// sourceResolver engine the WhatsApp commands use, but with its own clean,
// professional design and its own watch-online + download flow.
//
// Routes:
//   /anime                 → home (trending + latest)
//   /anime/search?q=       → search results
//   /anime/browse          → browse/filter
//   /anime/title/:id       → detail + episodes
//   /anime/watch/:id?ep=N  → embedded stream player (HLS via /anime/proxy)
//   /anime/dl/:id          → download job page
//   /anime/proxy           → HLS relay (referer-gated streams)

const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const router = express.Router();
const service = require("./tools/animeService");
const { resolveEpisode } = require("./tools/sourceResolver");
const { enqueueAnimeJob, snapshot, retryJob, getJob } = require("./tools/animeJobManager");

router.use(express.urlencoded({ extended: true }));

// ── helpers ─────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const PROVIDER_LABEL = { jikan: "MAL", anilist: "AniList", consumet: "Consumet", animepahe: "AnimePahe", gogoanime: "Gogoanime" };

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
function detailsFast(entry) {
  return withTimeout(service.getDetails(entry), 5000, { id: entry.id, provider: entry.provider, title: entry.title || "Anime" });
}

function layout(title, inner) {
  return `<!DOCTYPE html><html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · ARIA Anime</title>
<style>
:root{--bg:#0b0e14;--panel:#121722;--panel2:#0e131d;--line:#1d2534;--text:#e7ecf5;--muted:#93a0b8;--faint:#5d6b88;
--brand:#6d5ef8;--brand2:#8b5cf6;--accent:#a5b4fc;--green:#34d399;--amber:#fbbf24;--red:#f87171;--radius:14px;
--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.3)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI','Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}
.top{position:sticky;top:0;z-index:30;background:rgba(11,14,20,.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.top-in{max-width:1200px;margin:0 auto;padding:14px 22px;display:flex;align-items:center;gap:18px}
.logo{font-weight:800;font-size:18px;letter-spacing:-.02em;display:flex;align-items:center;gap:9px;color:var(--text)}
.logo .mark{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--brand),var(--brand2));display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px}
.logo span{color:var(--brand);}
.search{flex:1;display:flex;gap:8px;max-width:480px;margin-left:auto}
.search input{flex:1;background:var(--panel);border:1px solid var(--line);color:var(--text);padding:10px 14px;border-radius:10px;outline:none;font-size:14px}
.search input:focus{border-color:var(--brand)}
.search button{background:linear-gradient(90deg,var(--brand),var(--brand2));color:#fff;border:none;border-radius:10px;padding:0 18px;font-weight:700;cursor:pointer}
.nav{display:flex;gap:4px}
.nav a{color:var(--muted);font-size:13px;font-weight:600;padding:8px 12px;border-radius:9px;text-decoration:none}
.nav a:hover{color:var(--text);background:var(--panel)}
.main{max-width:1200px;margin:0 auto;padding:30px 22px 70px}
.hero{background:linear-gradient(135deg,rgba(109,94,248,.12),transparent 60%),var(--panel);border:1px solid var(--line);border-radius:20px;padding:34px;margin-bottom:34px}
.hero h1{font-size:34px;font-weight:800;letter-spacing:-.03em}
.hero p{color:var(--muted);font-size:14px;margin-top:8px;max-width:520px}
.hero .badge{display:inline-block;margin-top:16px;padding:6px 14px;border-radius:99px;background:var(--brand);color:#fff;font-size:12px;font-weight:700}
.sec-h{font-size:18px;font-weight:800;margin:34px 0 16px;display:flex;align-items:center;gap:9px}
.sec-h::before{content:"";width:4px;height:18px;border-radius:2px;background:var(--brand)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;transition:.15s;text-decoration:none;color:inherit}
.card:hover{transform:translateY(-4px);border-color:var(--brand);box-shadow:var(--shadow)}
.card .cover{width:100%;aspect-ratio:2/3;object-fit:cover;background:var(--panel2);display:block}
.card .body{padding:11px 12px}
.card .t{font-size:13px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .meta{color:var(--muted);font-size:11px;margin-top:5px;display:flex;gap:8px;align-items:center}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700}
.b-prov{background:rgba(109,94,248,.15);color:var(--accent)}
.b-score{background:rgba(251,191,36,.14);color:var(--amber)}
.empty{color:var(--faint);padding:40px;text-align:center;font-size:13px}
.detail{display:flex;gap:28px;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:26px;margin-bottom:30px}
.detail .poster{width:230px;aspect-ratio:2/3;object-fit:cover;border-radius:14px;background:var(--panel2);flex-shrink:0}
.detail h1{font-size:28px;font-weight:800;letter-spacing:-.02em}
.detail .metaline{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0;font-size:12px;color:var(--muted)}
.detail .desc{color:var(--text);font-size:14px;margin-top:6px;max-width:720px;line-height:1.6}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.tag{background:var(--panel2);border:1px solid var(--line);padding:3px 10px;border-radius:99px;font-size:11px;color:var(--muted)}
.epgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px;margin-top:14px}
.ep{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center}
.ep .n{font-weight:800;font-size:15px}
.ep .e{color:var(--muted);font-size:11px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 14px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;border:none;text-decoration:none}
.btn-watch{background:linear-gradient(90deg,var(--brand),var(--brand2));color:#fff;flex:1}
.btn-dl{background:var(--panel2);border:1px solid var(--line);color:var(--text);flex:1}
.eprow{display:flex;gap:8px;margin-top:9px}
.player{background:#000;border:1px solid var(--line);border-radius:16px;overflow:hidden;max-width:960px;aspect-ratio:16/9;margin:16px 0}
.player video{width:100%;height:100%;display:block}
.job{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}.manual{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}.manual input{width:130px;background:var(--panel2);border:1px solid var(--line);color:var(--text);padding:9px 11px;border-radius:10px}.manual .btn{flex:0 0 auto}
.job .row{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:4px 0}
.job .k{color:var(--muted)}
.footer{border-top:1px solid var(--line);padding:24px;text-align:center;color:var(--faint);font-size:12px}
@media(max-width:760px){.detail{flex-direction:column}.detail .poster{width:100%;max-width:230px}.nav a{padding:6px 8px;font-size:12px}}
</style></head>
<body>
<header class="top"><div class="top-in">
  <a class="logo" href="/anime"><div class="mark">▶</div>ARIA<span>Anime</span></a>
  <nav class="nav"><a href="/anime/browse">Browse</a><a href="/anime/trending">Trending</a><a href="/anime/latest">Latest</a></nav>
  <form class="search" action="/anime/search" method="get"><input name="q" placeholder="Search anime..." /><button>Search</button></form>
</div></header>
<div class="main">${inner}</div>
<footer class="footer">ARIA Anime — watch online &amp; download. Streams resolved on demand from public sources.</footer>
</body></html>`;
}

function cardGrid(items) {
  if (!items || !items.length) return `<div class="empty">Nothing here yet.</div>`;
  return `<div class="grid">${items.map((a) => `
    <a class="card" href="/anime/title/${encodeURIComponent(a.id)}?prov=${encodeURIComponent(a.provider || "anilist")}">
      ${a.cover ? `<img class="cover" src="${esc(a.cover)}" onerror="this.style.visibility='hidden'" loading="lazy" />` : `<div class="cover"></div>`}
      <div class="body"><div class="t">${esc(a.title)}</div>
        <div class="meta"><span class="badge b-prov">${esc(PROVIDER_LABEL[a.provider] || a.provider || "AniList")}</span>${a.rating ? `<span class="badge b-score">★ ${esc(a.rating)}</span>` : ""}</div>
      </div>
    </a>`).join("")}</div>`;
}

// ── pages ───────────────────────────────────────────────────────
async function homePage() {
  const trending = await service.getTrending().catch(() => []);
  const latest = await service.getLatest().catch(() => []);
  const hero = trending[0];
  const heroHtml = hero ? `
    <div class="hero">
      <h1>${esc(hero.title)}</h1>
      <p>${esc(hero.overview || hero.description || "Watch the latest episodes and download in HD.")}</p>
      <a class="badge" href="/anime/title/${encodeURIComponent(hero.id)}?prov=${encodeURIComponent(hero.provider || "anilist")}">▶ Watch now</a>
    </div>` : "";
  return layout("Home", `${heroHtml}
    <div class="sec-h">Trending</div>${cardGrid(trending.slice(0, 20))}
    <div class="sec-h">Recently Updated</div>${cardGrid(latest.slice(0, 20))}`);
}

async function searchPage(q) {
  const results = q ? await service.searchAnime(q).catch(() => []) : [];
  const title = q ? `Search: ${q}` : "Search";
  const sub = q ? (results.length ? `${results.length} results for “${esc(q)}”` : `No results for “${esc(q)}”`) : "Try a title — e.g. “solo leveling”";
  return layout(title, `<div class="sec-h">${esc(sub)}</div>${cardGrid(results)}`);
}

async function trendingPage() {
  const items = await service.getTrending().catch(() => []);
  return layout("Trending", `<div class="sec-h">Trending</div>${cardGrid(items)}`);
}

async function latestPage() {
  const items = await service.getLatest().catch(() => []);
  return layout("Latest", `<div class="sec-h">Recently Updated</div>${cardGrid(items)}`);
}

async function browsePage(req) {
  const genre = req.query.genre || "";
  const year = req.query.year || "";
  const type = req.query.type || "";
  const items = await service.browseAnime({ genre, year, type, perPage: 24 }).catch(() => []);
  const genreOpts = ["Action","Adventure","Comedy","Drama","Fantasy","Horror","Mystery","Romance","Sci-Fi","Slice of Life","Sports","Thriller"];
  const html = `
    <form method="get" action="/anime/browse" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px">
      <select name="genre" style="background:var(--panel);border:1px solid var(--line);color:var(--text);padding:9px 12px;border-radius:10px;font-size:13px">
        <option value="">All genres</option>${genreOpts.map((g) => `<option value="${g}" ${g === genre ? "selected" : ""}>${g}</option>`).join("")}
      </select>
      <select name="year" style="background:var(--panel);border:1px solid var(--line);color:var(--text);padding:9px 12px;border-radius:10px;font-size:13px">
        <option value="">All years</option>${[2025,2024,2023,2022,2021,2020].map((y) => `<option value="${y}" ${String(y) === String(year) ? "selected" : ""}>${y}</option>`).join("")}
      </select>
      <button class="btn btn-watch" style="flex:0">Filter</button>
    </form>
    <div class="sec-h">Browse</div>${cardGrid(items)}`;
  return layout("Browse", html);
}

async function titlePage(req) {
  const id = req.params.id;
  const provider = req.query.prov || "anilist";
  const entry = { id, provider, title: "" };
  const [d, eps] = await Promise.all([
    detailsFast(entry),
    withTimeout(service.getEpisodes(entry), 7000, []),
  ]);
  const html = `
    <div class="detail">
      ${d.cover ? `<img class="poster" src="${esc(d.cover)}" onerror="this.style.visibility='hidden'" />` : `<div class="poster"></div>`}
      <div style="flex:1">
        <h1>${esc(d.title || "Untitled")}</h1>
        <div class="metaline">
          ${d.rating ? `<span>★ ${esc(d.rating)}</span>` : ""}
          ${d.type ? `<span>${esc(d.type)}</span>` : ""}
          ${d.year ? `<span>${esc(d.year)}</span>` : ""}
          ${d.episodes ? `<span>${esc(d.episodes)} eps</span>` : ""}
          ${d.status ? `<span class="badge b-prov">${esc(d.status)}</span>` : ""}
          <span class="badge b-prov">${esc(PROVIDER_LABEL[provider] || provider)}</span>
        </div>
        ${d.genres?.length ? `<div class="tags">${d.genres.slice(0, 8).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>` : ""}
        ${d.description ? `<div class="desc">${esc(d.description.slice(0, 700))}</div>` : ""}
      </div>
    </div>
    <div class="sec-h">Episodes${d.episodes ? ` (${esc(d.episodes)})` : eps.length ? ` (${eps.length})` : ""}</div>
    ${eps.length ? `<div class="epgrid">${eps.map((ep) => `
      <div class="ep">
        <div class="n">Ep ${ep.number}</div>
        <div class="e">${esc(ep.title)}</div>
        <div class="eprow">
          <a class="btn btn-watch" href="/anime/watch/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${ep.number}">▶ Watch</a>
          <a class="btn btn-dl" href="/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${ep.number}">DL</a>
        </div>
      </div>`).join("")}</div>` : `<div class="empty">Episode list is not available from this provider. You can still enter an episode number below and ARIA will resolve it on demand.<div class="manual"><input id="manual-ep" type="number" min="1" value="1" aria-label="Episode number"><a id="manual-watch" class="btn btn-watch" href="/anime/watch/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=1">▶ Watch</a><a id="manual-dl" class="btn btn-dl" href="/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=1">Download</a></div></div>`}`;
  const withManualScript = html.includes("manual-ep") ? `${html}<script>(function(){var i=document.getElementById('manual-ep'),w=document.getElementById('manual-watch'),d=document.getElementById('manual-dl');function sync(){var n=Math.max(1,parseInt(i.value||'1',10));w.href='/anime/watch/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep='+n;d.href='/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep='+n;}i.addEventListener('input',sync);})();</script>` : html;
  return layout(d.title || "Anime", withManualScript);
}

async function watchPage(req) {
  const id = req.params.id;
  const provider = req.query.prov || "anilist";
  const ep = Number(req.query.ep) || 1;
  const entry = { id, provider, title: "" };
  const d = await detailsFast(entry);
  // Resolve the stream with a hard timeout so a slow/hung provider can't freeze
  // the watch page — the page always renders (player or a retry message).
  const report = await Promise.race([
    resolveEpisode(d.title || id, ep, { preference: provider === "jikan" ? null : provider }),
    new Promise((r) => setTimeout(() => r(null), 8000)),
  ]);
  const src = report?.selected;
  if (!src || !src.url) {
    return layout("Watch", `<div class="sec-h">${esc(d.title || "Anime")} — Ep ${ep}</div><div class="empty">Couldn't resolve a stream. ${esc(report?.error || "no source")}</div>`);
  }
  const proxied = `/anime/proxy?u=${encodeURIComponent(src.url)}&r=${encodeURIComponent(src.headers?.Referer || src.headers?.referer || "")}`;
  return layout("Watch", `
    <div class="sec-h">${esc(d.title || "Anime")} — Ep ${ep}</div>
    <div class="sub" style="color:var(--muted);font-size:13px;margin-bottom:10px">${esc(PROVIDER_LABEL[src.provider] || src.provider)}${src.height ? " · " + src.height + "p" : ""}</div>
    <div class="player"><video id="v" controls autoplay></video></div>
    <div style="display:flex;gap:10px">
      <a class="btn btn-watch" href="/anime/watch/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${ep + 1}" style="flex:0">Next ep ▶</a>
      <a class="btn btn-dl" href="/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}" style="flex:0">← Episodes</a>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script>
    <script>var u=${JSON.stringify(proxied)},v=document.getElementById('v');if(Hls.isSupported()){var h=new Hls();h.loadSource(u);h.attachMedia(v)}else if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=u}</script>`);
}

async function dlPage(req, res) {
  const id = req.params.id;
  const provider = req.query.prov || "anilist";
  const ep = Number(req.query.ep) || 1;
  const entry = { id, provider, title: "" };
  const d = await detailsFast(entry);
  const title = d.title || `Anime ${id}`;
  let job = req.query.job ? getJob(String(req.query.job)) : null;
  if (req.query.retry === "1" && job?.status === "failed") {
    job = retryJob(job.id) || job;
    return res.redirect(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${ep}&job=${encodeURIComponent(job.id)}`);
  }
  if (!job) {
    job = enqueueAnimeJob({ name: title, episode: ep, preferred: provider === "jikan" ? null : provider, quality: "best", sock: null, chatId: null, quotedMsg: null });
    return res.redirect(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${ep}&job=${encodeURIComponent(job.id)}`);
  }
  const status = job.status === "done" ? "Ready" : job.status === "failed" ? "Download failed" : job.status === "running" ? "Downloading" : "Queued";
  const progress = job.progress?.percent != null ? `<div class="row"><span class="k">Progress</span><span>${Math.round(job.progress.percent)}%${job.progress.speed ? ` · ${esc(job.progress.speed)}` : ""}</span></div>` : "";
  const result = job.status === "done" && job.result?.filePath && fs.existsSync(job.result.filePath)
    ? `<a class="btn btn-watch" href="/anime/file/${encodeURIComponent(job.id)}" style="margin-top:12px">Download ${esc(title)} — episode ${ep}</a>`
    : "";
  const error = job.status === "failed" ? `<div class="empty" style="color:var(--red)">${esc(job.error?.code || "DOWNLOAD_FAILED")}: ${esc(job.error?.message || "The download could not be completed.")}<br><a class="btn btn-dl" href="/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${ep}&job=${encodeURIComponent(job.id)}&retry=1" style="margin-top:12px">Retry</a></div>` : "";
  const refresh = ["queued", "running"].includes(job.status) ? `<script>setTimeout(()=>location.reload(),4000)</script>` : "";
  return layout("Download", `<div class="sec-h">Download — ${esc(title)} · episode ${ep}</div><div class="job"><div class="row"><span class="k">Status</span><strong>${status}</strong></div><div class="row"><span class="k">Job</span><span>${esc(job.id)}</span></div><div class="row"><span class="k">Quality</span><span>best</span></div>${progress}</div>${result}${error}${!result && !error ? `<div class="empty">This page updates automatically while the source is resolved and the file is prepared.</div>` : ""}${refresh}`);
}

// HLS relay for protected streams (referer-gated).
router.get("/proxy", (req, res) => {
  const target = req.query.u;
  const referer = req.query.r || "";
  if (!target || !/^https?:\/\//i.test(target)) return res.status(400).send("bad url");
  const lib = target.startsWith("https:") ? https : http;
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" };
  if (referer) headers.Referer = referer;
  const p = lib.get(target, { headers }, (up) => {
    res.status(up.statusCode || 200);
    res.setHeader("Content-Type", up.headers["content-type"] || "application/vnd.apple.mpegurl");
    if (up.headers["content-length"]) res.setHeader("Content-Length", up.headers["content-length"]);
    res.setHeader("Access-Control-Allow-Origin", "*");
    up.pipe(res);
  });
  p.on("error", (e) => { if (!res.headersSent) res.status(502).send("proxy error"); else res.end(); });
});

// ── routes ──────────────────────────────────────────────────────
router.get("/", async (req, res) => { try { res.send(await homePage()); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/search", async (req, res) => { try { res.send(await searchPage(req.query.q || "")); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/trending", async (req, res) => { try { res.send(await trendingPage()); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/latest", async (req, res) => { try { res.send(await latestPage()); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/browse", async (req, res) => { try { res.send(await browsePage(req)); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/title/:id", async (req, res) => { try { res.send(await titlePage(req)); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/watch/:id", async (req, res) => { try { res.send(await watchPage(req)); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/dl/:id", async (req, res) => { try { const page = await dlPage(req, res); if (!res.headersSent && page) res.send(page); } catch (e) { if (!res.headersSent) res.status(500).send(esc(e.message)); } });
router.get("/file/:id", (req, res) => {
  try {
    const job = getJob(String(req.params.id));
    const fp = job?.result?.filePath;
    if (!job || job.status !== "done" || !fp || !fs.existsSync(fp)) return res.status(404).send("File not found or no longer available.");
    const safe = `${job.name || "anime"}-ep${job.episode || ""}.mp4`.replace(/[^a-z0-9._-]+/gi, "_");
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
    res.setHeader("Content-Length", String(job.result.size || fs.statSync(fp).size));
    fs.createReadStream(fp).pipe(res);
  } catch (e) { res.status(500).send(esc(e.message)); }
});

module.exports = router;
