// ARIA Anime — public catalog, watch, and authorized download routes.
const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const router = express.Router();
const service = require("./tools/animeService");
const { resolveEpisode } = require("./tools/sourceResolver");
const { enqueueAnimeJob, retryJob, getJob } = require("./tools/animeJobManager");
const { issueMediaToken, verifyMediaToken, issueFileToken, verifyFileToken, validateMediaTarget } = require("./utils/mediaAccess");
const { error: logError } = require("./utils/logger");

function safePageError(res, scope, err) {
  logError(`[${scope}]`, err?.stack || err?.message || err);
  return res.status(500).send("This page is temporarily unavailable. Please try again.");
}

router.use(express.urlencoded({ extended: true }));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PROVIDER_LABEL = { jikan: "MAL", anilist: "AniList", consumet: "Consumet", animepahe: "AnimePahe", gogoanime: "Gogoanime", omnisave: "OmniSave" };

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function detailsFast(entry) {
  return withTimeout(service.getDetails(entry), 10000, { id: entry.id, provider: entry.provider, title: entry.title || "Anime" });
}

function providerLabel(provider) {
  return PROVIDER_LABEL[provider] || provider || "Catalog";
}

function titleHref(item) {
  return `/anime/title/${encodeURIComponent(item.id)}?prov=${encodeURIComponent(item.provider || "anilist")}`;
}

function button(href, label, tone = "primary", extra = "") {
  return `<a class="btn btn-${tone}" href="${esc(href)}" ${extra}>${esc(label)}</a>`;
}

function layout(title, inner) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0d12"><meta name="description" content="ARIA Anime — a clean catalog for authorized viewing and downloads.">
<title>${esc(title)} · ARIA Anime</title>
<style>
:root{--bg:#0b0d12;--surface:#131720;--surface-2:#181d28;--surface-3:#202735;--line:#2a3240;--text:#f4f6fa;--muted:#9ba6b8;--subtle:#697386;--accent:#ff5d6c;--accent-2:#ff8a5b;--ok:#42d6a2;--warn:#f5c451;--danger:#ff7b8a;--radius:16px;--shadow:0 18px 48px rgba(0,0,0,.25)}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}a{color:inherit}.top{position:sticky;top:0;z-index:20;background:rgba(11,13,18,.96);border-bottom:1px solid var(--line)}.top-in{width:min(1180px,100%);margin:auto;padding:12px 20px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px}.brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;white-space:nowrap}.brand-mark{position:relative;display:block;width:34px;height:34px;overflow:hidden;border:1px solid #596273;border-radius:10px;background:#202735}.brand-mark:before,.brand-mark:after{content:"";position:absolute;display:block;width:6px;border-radius:4px;transform:skewX(-22deg)}.brand-mark:before{height:21px;left:10px;top:6px;background:var(--accent)}.brand-mark:after{height:15px;left:18px;top:12px;background:var(--ok)}.brand-name{font-size:15px;font-weight:800;letter-spacing:.02em}.brand-name b{color:var(--accent);font-weight:800}.nav{display:flex;gap:3px;align-items:center}.nav a,.account-link{padding:8px 10px;border-radius:9px;color:var(--muted);font-size:12px;font-weight:700;text-decoration:none}.nav a:hover,.account-link:hover{background:var(--surface);color:var(--text)}.search{display:flex;gap:8px;min-width:0}.search input{width:100%;min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:10px 12px;font:inherit;font-size:13px;outline:0}.search input:focus{border-color:var(--accent)}.search button{border:0;border-radius:9px;background:var(--accent);color:#1b0d11;padding:0 16px;font-weight:850;cursor:pointer}.account-link{border:1px solid var(--line);white-space:nowrap}.main{width:min(1180px,100%);margin:auto;padding:28px 20px 64px}.hero{position:relative;isolation:isolate;min-height:360px;overflow:hidden;border:1px solid var(--line);border-radius:22px;background:var(--surface);box-shadow:var(--shadow);padding:34px;display:flex;align-items:flex-end}.hero-art{position:absolute;inset:0 0 0 35%;z-index:-2;background:var(--surface-2)}.hero-art img{width:100%;height:100%;display:block;object-fit:cover;opacity:.62}.hero-art:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,var(--surface) 0%,rgba(19,23,32,.94) 28%,rgba(19,23,32,.3) 75%,rgba(19,23,32,.08))}.hero-copy{max-width:600px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--accent);font-size:10px;font-weight:850}.hero h1{margin:12px 0 0;font-size:clamp(30px,5vw,58px);line-height:1.02;letter-spacing:-.045em}.hero p{max-width:540px;color:var(--muted);font-size:14px;margin:12px 0 0;line-height:1.65}.hero-meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:16px}.meta-pill,.badge{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;background:rgba(32,39,53,.82);color:var(--muted);padding:4px 9px;font-size:11px;font-weight:700}.meta-pill.score,.badge.score{color:var(--warn)}.hero-actions,.detail-actions,.download-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border-radius:9px;border:1px solid transparent;padding:9px 14px;text-decoration:none;font-size:12px;font-weight:850;cursor:pointer}.btn-primary{background:var(--accent);color:#1e0e11}.btn-secondary{background:var(--surface-2);border-color:var(--line);color:var(--text)}.btn-secondary:hover{border-color:var(--accent)}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin:34px 0 14px}.section-title{font-size:20px;line-height:1.1;font-weight:850;letter-spacing:-.02em}.section-title:before{content:"";display:inline-block;width:4px;height:18px;margin-right:9px;vertical-align:-2px;border-radius:9px;background:var(--accent)}.section-sub{color:var(--subtle);font-size:12px}.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px}.card{min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--surface);text-decoration:none;transition:border-color .15s,transform .15s}.card:hover{border-color:#6b7484;transform:translateY(-2px)}.cover{display:block;width:100%;aspect-ratio:2/3;object-fit:cover;background:var(--surface-2)}.card-body{padding:11px}.card-title{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;min-height:34px;font-size:12px;font-weight:800;line-height:1.4}.card-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.badge.provider{background:#202735;color:#b5bfce}.empty{padding:32px;border:1px dashed var(--line);border-radius:14px;color:var(--muted);text-align:center;font-size:13px}.detail{display:grid;grid-template-columns:220px minmax(0,1fr);gap:26px;padding:24px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}.poster{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:12px;background:var(--surface-2)}.detail h1{margin:0;font-size:clamp(25px,4vw,40px);line-height:1.05;letter-spacing:-.04em}.metaline{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;color:var(--muted);font-size:12px}.desc{max-width:760px;margin-top:15px;color:#c7ced9;font-size:14px;line-height:1.7}.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.tag{border:1px solid var(--line);border-radius:999px;padding:4px 9px;color:var(--muted);font-size:11px}.episode-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.episode{min-width:0;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.episode-number{font-weight:850}.episode-name{overflow:hidden;margin-top:3px;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.episode-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:11px}.episode-actions .btn{min-height:34px;padding:7px 6px;font-size:11px}.manual{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}.manual input{width:120px;background:var(--surface-2);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:10px;font:inherit}.source-note{margin-top:14px;color:var(--subtle);font-size:11px;line-height:1.6}.player-shell{overflow:hidden;border:1px solid var(--line);border-radius:16px;background:#000;box-shadow:var(--shadow)}.player-shell video{display:block;width:100%;max-height:72vh;background:#000}.watch-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:14px}.watch-head h1{margin:0;font-size:clamp(20px,4vw,32px);letter-spacing:-.035em}.watch-head p{margin:4px 0 0;color:var(--muted);font-size:12px}.job{max-width:760px;padding:20px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}.job-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:13px}.job-label{color:var(--muted)}.status{display:inline-flex;padding:4px 9px;border-radius:999px;background:#18352f;color:var(--ok);font-size:11px;font-weight:850}.status.failed{background:#3b2028;color:var(--danger)}.status.pending{background:#3b321c;color:var(--warn)}.progress-track{height:8px;margin-top:8px;overflow:hidden;border-radius:999px;background:var(--surface-2)}.progress-bar{height:100%;border-radius:inherit;background:var(--accent)}.filter-bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}.filter-bar select{background:var(--surface);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:10px 12px;font:inherit;font-size:12px}.footer{padding:22px 20px;border-top:1px solid var(--line);color:var(--subtle);text-align:center;font-size:11px}
@media(max-width:1050px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}.episode-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.top-in{grid-template-columns:auto 1fr auto}.nav{display:none}}
@media(max-width:680px){.top-in{grid-template-columns:auto auto;gap:10px;padding:10px 14px}.brand-name{font-size:14px}.account-link{margin-left:auto}.search{grid-column:1/-1;grid-row:2}.search button{padding:0 13px}.main{padding:18px 14px 48px}.hero{min-height:440px;padding:22px;border-radius:16px;align-items:flex-end}.hero-art{inset:0 0 42% 0}.hero-art:after{background:linear-gradient(0deg,var(--surface) 7%,rgba(19,23,32,.7) 55%,rgba(19,23,32,.05))}.hero h1{font-size:36px}.hero p{font-size:13px}.hero-actions .btn{flex:1}.section-head{margin-top:28px}.section-title{font-size:18px}.section-sub{display:none}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card-body{padding:10px}.detail{grid-template-columns:96px minmax(0,1fr);gap:14px;padding:14px;border-radius:14px}.detail h1{font-size:22px}.detail .desc{grid-column:1/-1;font-size:13px;margin-top:0}.detail-actions{grid-column:1/-1;margin-top:0}.detail-actions .btn{flex:1}.episode-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.episode{padding:10px}.watch-head{align-items:flex-start;flex-direction:column}.download-actions .btn{flex:1}.footer{padding-bottom:30px}}
@media(max-width:360px){.brand-name{font-size:12px}.account-link{font-size:11px;padding:7px}.hero{min-height:420px;padding:18px}.hero-actions{display:grid;grid-template-columns:1fr}.detail{grid-template-columns:82px minmax(0,1fr)}}
</style></head><body>
<header class="top"><div class="top-in">
<a class="brand" href="/anime" aria-label="ARIA Anime home"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">ARIA <b>ANIME</b></span></a>
<nav class="nav" aria-label="Primary"><a href="/anime/browse">Browse</a><a href="/anime/trending">Trending</a><a href="/anime/latest">Latest</a></nav>
<form class="search" action="/anime/search" method="get"><input name="q" aria-label="Search anime" placeholder="Search anime…" autocomplete="off"><button type="submit">Search</button></form>
<a class="account-link" href="/portal/login">Learner sign in</a>
</div></header><main class="main">${inner}</main><footer class="footer">ARIA Anime · catalog metadata and media delivery are limited to configured authorized sources.</footer></body></html>`;
}

function cardGrid(items) {
  if (!items?.length) return `<div class="empty">No titles matched this view.</div>`;
  return `<div class="grid">${items.map((a) => `<a class="card" href="${esc(titleHref(a))}">
    ${a.cover ? `<img class="cover" src="${esc(a.cover)}" alt="" loading="lazy" onerror="this.remove()">` : `<div class="cover"></div>`}
    <div class="card-body"><div class="card-title">${esc(a.title)}</div><div class="card-meta"><span class="badge provider">${esc(providerLabel(a.provider))}</span>${a.rating ? `<span class="badge score">★ ${esc(a.rating)}</span>` : ""}</div></div>
  </a>`).join("")}</div>`;
}

async function homePage() {
  const [trending, latest] = await Promise.all([
    service.getTrending().catch(() => []),
    service.getLatest().catch(() => []),
  ]);
  const hero = trending[0];
  const heroHtml = hero ? `<section class="hero"><div class="hero-art">${hero.cover ? `<img src="${esc(hero.cover)}" alt="" loading="eager">` : ""}</div><div class="hero-copy"><div class="eyebrow">Featured this week · ${esc(providerLabel(hero.provider))}</div><h1>${esc(hero.title)}</h1><p>${esc(hero.overview || hero.description || "Open a title to see available episodes and authorized media options.")}</p><div class="hero-meta"><span class="meta-pill score">${hero.rating ? `★ ${esc(hero.rating)}` : "Featured"}</span>${hero.year ? `<span class="meta-pill">${esc(hero.year)}</span>` : ""}${hero.type ? `<span class="meta-pill">${esc(hero.type)}</span>` : ""}</div><div class="hero-actions">${button(titleHref(hero), "Open title", "primary")}${button("/anime/browse", "Browse catalog", "secondary")}</div></div></section>` : `<section class="hero"><div class="hero-copy"><div class="eyebrow">ARIA Anime</div><h1>Find your next series.</h1><p>Search the catalog or browse the latest metadata.</p></div></section>`;
  return layout("Home", `${heroHtml}<div class="section-head"><h2 class="section-title">Trending</h2><span class="section-sub">Popular titles</span></div>${cardGrid(trending.slice(0, 18))}<div class="section-head"><h2 class="section-title">Recently updated</h2><span class="section-sub">New catalog entries</span></div>${cardGrid(latest.slice(0, 18))}`);
}

async function searchPage(query) {
  const results = query ? await service.searchAnime(query).catch(() => []) : [];
  return layout(query ? `Search: ${query}` : "Search", `<div class="section-head"><h1 class="section-title">${esc(query ? `Results for “${query}”` : "Search anime")}</h1><span class="section-sub">${results.length ? `${results.length} safe results` : "Try a title, season, or character"}</span></div>${cardGrid(results)}`);
}

async function trendingPage() {
  return layout("Trending", `<div class="section-head"><h1 class="section-title">Trending</h1></div>${cardGrid(await service.getTrending().catch(() => []))}`);
}

async function latestPage() {
  return layout("Latest", `<div class="section-head"><h1 class="section-title">Recently updated</h1></div>${cardGrid(await service.getLatest().catch(() => []))}`);
}

async function browsePage(req) {
  const genre = String(req.query.genre || "");
  const year = String(req.query.year || "");
  const type = String(req.query.type || "");
  const items = await service.browseAnime({ genre, year, type, perPage: 24 }).catch(() => []);
  const genres = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Thriller"];
  const years = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
  return layout("Browse", `<form class="filter-bar" method="get" action="/anime/browse"><select name="genre"><option value="">All genres</option>${genres.map((g) => `<option value="${esc(g)}" ${g === genre ? "selected" : ""}>${esc(g)}</option>`).join("")}</select><select name="year"><option value="">All years</option>${years.map((y) => `<option value="${y}" ${String(y) === year ? "selected" : ""}>${y}</option>`).join("")}</select><button class="btn btn-primary" type="submit">Apply filters</button></form><div class="section-head"><h1 class="section-title">Browse catalog</h1><span class="section-sub">Public metadata · safe titles only</span></div>${cardGrid(items)}`);
}

async function titlePage(req) {
  const id = String(req.params.id);
  const provider = String(req.query.prov || "anilist");
  const entry = { id, provider, title: "" };
  const [details, episodes] = await Promise.all([detailsFast(entry), withTimeout(service.getEpisodes(entry), 10000, [])]);
  if (!service.isCatalogSafe(details) || details.blocked) return layout("Title unavailable", `<div class="empty"><h1>Title unavailable</h1><p>This title is not included in the public catalog.</p>${button("/anime", "Back to home", "primary")}</div>`);
  const episodeHtml = episodes.length ? `<div class="episode-grid">${episodes.map((ep) => `<div class="episode"><div class="episode-number">Episode ${esc(ep.number)}</div><div class="episode-name">${esc(ep.title)}</div><div class="episode-actions">${button(`/anime/watch/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${encodeURIComponent(ep.number)}`, "Watch", "primary")}${button(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${encodeURIComponent(ep.number)}`, "Download", "secondary")}</div></div>`).join("")}</div>` : `<div class="empty">Episode metadata is unavailable for this provider. Enter an episode number to try the configured authorized resolver.<div class="manual"><input id="manual-ep" type="number" min="1" value="1" aria-label="Episode number">${button(`/anime/watch/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=1`, "Watch", "primary", 'id="manual-watch"')}${button(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=1`, "Download", "secondary", 'id="manual-dl"')}</div></div>`;
  const script = episodes.length ? "" : `<script>(function(){const i=document.getElementById('manual-ep'),w=document.getElementById('manual-watch'),d=document.getElementById('manual-dl');function sync(){const n=Math.max(1,parseInt(i.value||'1',10));w.href=w.href.replace(/ep=\\d+/, 'ep='+n);d.href=d.href.replace(/ep=\\d+/, 'ep='+n)}i.addEventListener('input',sync)})();</script>`;
  return layout(details.title || "Anime", `<section class="detail">${details.cover ? `<img class="poster" src="${esc(details.cover)}" alt="" onerror="this.remove()">` : `<div class="poster"></div>`}<div><div class="eyebrow">${esc(providerLabel(provider))}</div><h1>${esc(details.title || "Untitled")}</h1><div class="metaline">${details.rating ? `<span>★ ${esc(details.rating)}</span>` : ""}${details.type ? `<span>${esc(details.type)}</span>` : ""}${details.year ? `<span>${esc(details.year)}</span>` : ""}${details.status ? `<span>${esc(details.status)}</span>` : ""}</div>${details.genres?.length ? `<div class="tags">${details.genres.slice(0, 8).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>` : ""}<p class="desc">${esc(details.description || "Episode availability depends on the configured authorized source.")}</p><div class="detail-actions">${button("/anime/browse", "Back to catalog", "secondary")}</div></div></section><div class="section-head"><h2 class="section-title">Episodes${details.episodes ? ` · ${esc(details.episodes)}` : ""}</h2></div>${episodeHtml}${script}`);
}

async function watchPage(req) {
  const id = String(req.params.id);
  const provider = String(req.query.prov || "anilist");
  const episode = Math.max(1, Number(req.query.ep) || 1);
  const details = await detailsFast({ id, provider, title: "" });
  const report = await withTimeout(resolveEpisode(details.title || id, episode, { preference: provider === "anilist" ? null : provider }), 30000, null);
  const source = report?.selected;
  if (!source?.url) return layout("Watch unavailable", `<div class="empty"><h1>${esc(details.title || "Anime")} · episode ${episode}</h1><p>There is no validated playable source for this episode right now. Try again later or choose another title.</p>${button(`/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}`, "Back to episodes", "secondary")}</div>`);
  const mediaToken = issueMediaToken({ url: source.url, headers: source.headers, provider: source.provider });
  if (!mediaToken) return layout("Watch unavailable", `<div class="empty"><h1>Playback is not configured</h1><p>The operator must set a media signing secret before playback can be served securely.</p>${button(`/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}`, "Back to episodes", "secondary")}</div>`);
  const mediaUrl = `/anime/proxy?t=${encodeURIComponent(mediaToken)}`;
  const isHls = source.type === "hls" || /\.m3u8(?:\?|$)/i.test(source.url);
  const playerScript = isHls ? `<script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script><script>const v=document.getElementById('player'),u=${JSON.stringify(mediaUrl)};if(window.Hls&&Hls.isSupported()){const h=new Hls({enableWorker:true});h.loadSource(u);h.attachMedia(v)}else if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=u}else{v.outerHTML='<div class="empty">This browser cannot play this HLS stream.</div>'}</script>` : `<script>document.getElementById('player').src=${JSON.stringify(mediaUrl)};</script>`;
  return layout("Watch", `<div class="watch-head"><div><div class="eyebrow">Now playing</div><h1>${esc(details.title || source.title || "Anime")} · episode ${episode}</h1><p>${esc(providerLabel(source.provider))}${source.height ? ` · ${esc(source.height)}p` : ""}</p></div>${button(`/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}`, "Episodes", "secondary")}</div><div class="player-shell"><video id="player" controls playsinline preload="metadata"></video></div>${playerScript}`);
}

async function downloadPage(req, res) {
  const id = String(req.params.id);
  const provider = String(req.query.prov || "anilist");
  const episode = Math.max(1, Number(req.query.ep) || 1);
  const details = await detailsFast({ id, provider, title: "" });
  let job = req.query.job ? getJob(String(req.query.job)) : null;
  if (req.query.retry === "1" && job?.status === "failed") {
    job = retryJob(job.id) || job;
    return res.redirect(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${episode}&job=${encodeURIComponent(job.id)}`);
  }
  if (!job) {
    job = enqueueAnimeJob({ name: details.title || `Anime ${id}`, episode, preferred: provider === "anilist" ? null : provider, quality: "best", sock: null, chatId: null, quotedMsg: null });
    return res.redirect(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${episode}&job=${encodeURIComponent(job.id)}`);
  }
  const isFailed = job.status === "failed";
  const isDone = job.status === "done";
  const isPending = !isFailed && !isDone;
  const status = isFailed ? "Download failed" : isDone ? "Ready" : job.status === "running" ? "Downloading" : "Queued";
  const statusClass = isFailed ? "failed" : isPending ? "pending" : "";
  const percent = job.progress?.percent == null ? null : Math.max(0, Math.min(100, Math.round(job.progress.percent)));
  const progress = percent == null ? "" : `<div class="job-row"><span class="job-label">Progress</span><span>${percent}%</span></div><div class="progress-track"><div class="progress-bar" style="width:${percent}%"></div></div>`;
  const fileReady = isDone && job.result?.filePath && fs.existsSync(job.result.filePath);
  const fileToken = fileReady ? issueFileToken(job.id) : null;
  const result = fileReady && fileToken ? `<div class="download-actions">${button(`/anime/file/${encodeURIComponent(job.id)}?t=${encodeURIComponent(fileToken)}`, "Download file", "primary")}${button(`/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}`, "Back to episodes", "secondary")}</div>` : "";
  const error = isFailed ? `<div class="empty"><p>${esc(job.error?.code || "DOWNLOAD_FAILED")}: ${esc(job.error?.message || "The source could not be downloaded.")}</p>${button(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${episode}&job=${encodeURIComponent(job.id)}&retry=1`, "Retry", "primary")}</div>` : "";
  const refresh = isPending ? `<script>setTimeout(()=>location.reload(),5000)</script>` : "";
  return layout("Download", `<div class="job"><div class="eyebrow">Episode delivery</div><h1>${esc(details.title || "Anime")} · episode ${episode}</h1><div class="job-row"><span class="job-label">Status</span><span class="status ${statusClass}">${esc(status)}</span></div><div class="job-row"><span class="job-label">Job</span><span>${esc(job.id)}</span></div>${progress}</div>${result}${error}${!result && !error ? `<div class="empty">This page refreshes while a validated authorized source is prepared.</div>` : ""}${refresh}`);
}

router.get("/proxy", async (req, res) => {
  const payload = verifyMediaToken(req.query.t);
  if (!payload) return res.status(401).send("This playback link has expired. Open the episode again.");
  const target = await validateMediaTarget(payload.url);
  if (!target.ok) return res.status(403).send("This media source is not authorized.");
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36", ...(payload.headers || {}) };
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = https.get(target.url, { headers, lookup: (_hostname, _options, callback) => callback(null, target.address, target.family) }, (response) => {
    res.status(response.statusCode || 200);
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) if (response.headers[key]) res.setHeader(key, response.headers[key]);
    res.setHeader("Cache-Control", "private, max-age=60");
    response.pipe(res);
  });
  const closeUpstream = () => { if (!upstream.destroyed) upstream.destroy(); };
  req.once("aborted", closeUpstream);
  res.once("close", closeUpstream);
  upstream.setTimeout(20000, () => upstream.destroy(new Error("upstream timeout")));
  upstream.on("error", () => { if (!res.headersSent) res.status(502).send("Media source is temporarily unavailable."); else res.end(); });
});

router.get("/", async (req, res) => { try { res.send(await homePage()); } catch (e) { safePageError(res, "anime-home", e); } });
router.get("/search", async (req, res) => { try { res.send(await searchPage(req.query.q || "")); } catch (e) { safePageError(res, "anime-search", e); } });
router.get("/trending", async (req, res) => { try { res.send(await trendingPage()); } catch (e) { safePageError(res, "anime-trending", e); } });
router.get("/latest", async (req, res) => { try { res.send(await latestPage()); } catch (e) { safePageError(res, "anime-latest", e); } });
router.get("/browse", async (req, res) => { try { res.send(await browsePage(req)); } catch (e) { safePageError(res, "anime-browse", e); } });
router.get("/title/:id", async (req, res) => { try { res.send(await titlePage(req)); } catch (e) { safePageError(res, "anime-title", e); } });
router.get("/watch/:id", async (req, res) => { try { res.send(await watchPage(req)); } catch (e) { safePageError(res, "anime-watch", e); } });
router.get("/dl/:id", async (req, res) => { try { const page = await downloadPage(req, res); if (!res.headersSent && page) res.send(page); } catch (e) { if (!res.headersSent) safePageError(res, "anime-download", e); } });
router.get("/file/:id", (req, res) => {
  try {
    const jobId = String(req.params.id);
    if (!verifyFileToken(req.query.t, jobId)) return res.status(401).send("This download link has expired. Return to the episode and try again.");
    const job = getJob(jobId);
    const filePath = job?.result?.filePath;
    if (!job || job.status !== "done" || !filePath || !fs.existsSync(filePath)) return res.status(404).send("File not found or no longer available.");
    const safe = `${job.name || "anime"}-ep${job.episode || ""}.mp4`.replace(/[^a-z0-9._-]+/gi, "_");
    res.download(filePath, safe, { headers: { "Content-Type": "video/mp4" } });
  } catch (e) { safePageError(res, "anime-file", e); }
});

module.exports = router;
