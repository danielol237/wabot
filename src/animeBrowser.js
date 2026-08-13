// ── ARIA Anime Browser — a first-class web section ───────────────
// Mounted at /dashboard/anime (behind the same session auth as the
// dashboard). Server-rendered. Reuses the normalized anime service for
// search/details/episodes and the anime job manager for downloads, so the
// web browser and WhatsApp commands share one engine.

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const router = express.Router();
const service = require("./tools/animeService");
const { enqueueAnimeJob, retryJob, snapshot } = require("./tools/animeJobManager");
const { resolveEpisode } = require("./tools/sourceResolver");

router.use(express.urlencoded({ extended: true }));

// Cookie reader (mirrors the dashboard's lightweight approach).
router.use((req, res, next) => {
  const raw = req.headers.cookie || "";
  req.cookies = {};
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) req.cookies[k] = decodeURIComponent(v.join("=") || "");
  }
  next();
});

// ── CSRF protection (stateless, derived from the session cookie) ──
const CSRF_SECRET = process.env.DASHBOARD_CSRF_SECRET || process.env.DASHBOARD_PASSWORD || "aria-csrf";
function csrfFor(req) {
  const token = req.cookies?.["aria_session"] || "";
  return crypto.createHmac("sha256", CSRF_SECRET).update(token).digest("hex").slice(0, 32);
}
function csrfField(req) {
  return `<input type="hidden" name="_csrf" value="${csrfFor(req)}" />`;
}
function csrfOk(req) {
  const given = req.body?._csrf || req.query?._csrf || "";
  return !!given && given === csrfFor(req);
}
// Guard every state-changing POST route.
router.post("*", (req, res, next) => {
  if (req.path === "/download" || req.path === "/retry" || req.path === "/watchlist/toggle" || req.path === "/watchlist/remove") {
    if (!csrfOk(req)) return res.status(403).send("Invalid or missing CSRF token.");
  }
  next();
});

const QUALITY_OPTIONS = ["360", "480", "720", "1080", "best"];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PROVIDER_LABEL = {
  jikan: "MAL", anilist: "AniList", omnisave: "OmniSave", consumet: "Consumet",
  animepahe: "AnimePahe", gogoanime: "Gogoanime",
};

function layout(title, inner) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · ARIA Anime</title>
<style>
:root{--bg:#0a0e1a;--panel:#111827;--panel2:#1a2234;--line:#243049;--text:#e8ecf7;--muted:#9aa6c0;--faint:#5b6780;
--accent:#8b7cf6;--accent2:#5b8cff;--cyan:#22d3ee;--green:#34d399;--amber:#fbbf24;--red:#f87171}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.55;min-height:100vh}
a{color:inherit;text-decoration:none}
.top{position:sticky;top:0;z-index:20;background:rgba(10,14,26,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top-in{max-width:1150px;margin:0 auto;padding:14px 22px;display:flex;align-items:center;gap:16px}
.brand{font-weight:800;font-size:17px}.brand span{color:var(--accent)}
.search{flex:1;display:flex;gap:8px}
.search input{flex:1;background:var(--panel);border:1px solid var(--line);color:var(--text);padding:10px 14px;border-radius:10px;outline:none;font-size:14px}
.search input:focus{border-color:var(--accent)}
.search button{background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;border:none;border-radius:10px;padding:0 18px;font-weight:700;cursor:pointer}
.nav-links{display:flex;gap:14px;font-size:13px;color:var(--muted);font-weight:600}
.nav-links a:hover{color:var(--text)}
.main{max-width:1150px;margin:0 auto;padding:28px 22px 60px}
h1{font-size:26px;font-weight:900;margin-bottom:4px}
.sub{color:var(--muted);font-size:13px;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;transition:.15s}
.card:hover{transform:translateY(-3px);border-color:var(--accent);box-shadow:0 10px 30px rgba(139,124,246,.15)}
.card .cover{width:100%;aspect-ratio:2/3;object-fit:cover;background:var(--panel2);display:block}
.card .body{padding:11px 12px}
.card .t{font-size:13px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .meta{color:var(--muted);font-size:11px;margin-top:5px;display:flex;gap:8px;align-items:center}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700}
.b-prov{background:rgba(139,124,246,.15);color:var(--accent)}
.b-score{background:rgba(251,191,36,.14);color:var(--amber)}
.b-status{background:rgba(52,211,153,.14);color:var(--green)}
.section-h{font-size:15px;font-weight:800;margin:26px 0 12px;display:flex;align-items:center;gap:8px}
.section-h::before{content:"";width:4px;height:16px;border-radius:2px;background:var(--accent)}
.empty{color:var(--faint);padding:30px;text-align:center;font-size:13px}
.detail{display:flex;gap:26px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px}
.detail .poster{width:230px;aspect-ratio:2/3;object-fit:cover;border-radius:12px;background:var(--panel2);flex-shrink:0}
.detail h1{font-size:26px}
.detail .metaline{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0;font-size:12px;color:var(--muted)}
.detail .desc{color:var(--text);font-size:13.5px;margin-top:6px;max-width:760px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.tag{background:var(--panel2);border:1px solid var(--line);padding:3px 10px;border-radius:99px;font-size:11px;color:var(--muted)}
.watch{display:inline-flex;align-items:center;gap:8px;margin-top:16px;background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;padding:10px 18px;border-radius:10px;font-weight:700;font-size:14px;border:none;cursor:pointer}
.epgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:14px}
.ep{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center;cursor:pointer;transition:.15s}
.ep:hover{border-color:var(--accent);background:var(--panel2)}
.ep .n{font-weight:800;font-size:15px}
.ep .e{color:var(--muted);font-size:11px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.job{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px}
.job .row{display:flex;justify-content:space-between;gap:10px;font-size:13px}
.job .k{color:var(--muted)}
.job .v{font-weight:600}
.job .steps{margin-top:10px;font-size:12px;color:var(--muted)}
.job .steps div{padding:2px 0}
.step-ok{color:var(--green)}.step-no{color:var(--red)}
.fab{position:fixed;bottom:24px;right:24px;background:var(--accent);color:#fff;border:none;border-radius:99px;padding:12px 16px;font-weight:800;cursor:pointer;box-shadow:0 8px 24px rgba(139,124,246,.4)}
@media(max-width:720px){
  .detail{flex-direction:column}.detail .poster{width:100%;max-width:200px}
  .nav-links{display:none}
}
</style></head><body>
<div class="top"><div class="top-in">
  <a class="brand" href="/dashboard/anime">ARIA <span>Anime</span></a>
  <form class="search" method="get" action="/dashboard/anime/search">
    <input type="text" name="q" placeholder="Search anime…" value="${esc(typeof inner._q !== "undefined" ? inner._q : "")}" autofocus />
    <button type="submit">Search</button>
  </form>
  <nav class="nav-links">
    <a href="/dashboard/anime">Home</a>
    <a href="/dashboard/anime/browse">Browse</a>
    <a href="/dashboard/anime/trending">Trending</a>
    <a href="/dashboard/anime/latest">Latest</a>
    <a href="/dashboard/anime/schedule">Schedule</a>
    <a href="/dashboard/anime/watchlist">Watchlist</a>
    <a href="/dashboard/anime/downloads">Downloads</a>
    <a href="/dashboard">← Dashboard</a>
  </nav>
</div></div>
<main class="main">${inner.html}</main>
</body></html>`;
}

function cardGrid(items) {
  if (!items.length) return `<div class="empty">Nothing here yet.</div>`;
  return `<div class="grid">${items.map((a) => `
    <a class="card" href="/dashboard/anime/${encodeURIComponent(a.provider)}/${encodeURIComponent(a.id)}">
      ${a.cover ? `<img class="cover" src="${esc(a.cover)}" loading="lazy" onerror="this.style.visibility='hidden'" />` : `<div class="cover"></div>`}
      <div class="body">
        <div class="t">${esc(a.title)}</div>
        <div class="meta">
          <span class="badge b-prov">${esc(PROVIDER_LABEL[a.provider] || a.provider)}</span>
          ${a.rating ? `<span class="badge b-score">★ ${a.rating}</span>` : ""}
        </div>
      </div>
    </a>`).join("")}</div>`;
}

// ── Pages ────────────────────────────────────────────────────────

// Continue Watching row — resumes from tracked progress with a quality badge.
function continueGrid(items) {
  if (!items.length) return `<div class="empty">Nothing in progress. Pick a title and start watching.</div>`;
  return `<div class="grid">${items.map((a) => `
    <a class="card" href="/dashboard/anime/${encodeURIComponent(a.provider)}/${encodeURIComponent(a.id)}">
      ${a.cover ? `<img class="cover" src="${esc(a.cover)}" loading="lazy" onerror="this.style.visibility='hidden'" />` : `<div class="cover"></div>`}
      <div class="body">
        <div class="t">${esc(a.title)}</div>
        <div class="meta">
          <span class="badge b-prov">${esc(PROVIDER_LABEL[a.provider] || a.provider)}</span>
          ${a.quality && a.quality !== "best" ? `<span class="badge b-score">${esc(a.quality)}p</span>` : ""}
        </div>
        <div class="meta">Ep ${esc(a.episode)} ${a.status === "watching" ? "· ▶ continue" : ""}</div>
      </div>
    </a>`).join("")}</div>`;
}

async function homePage(req) {
  const [trending, latest] = await Promise.all([service.getTrending(), service.getLatest()]);
  const watchlist = service.loadWatchlist();
  const continuing = service.getContinueWatching(8);
  let html = "";
  if (continuing.length) html += `<div class="section-h">▶ Continue Watching</div>${continueGrid(continuing)}`;
  html += `<div class="section-h">🔥 Trending</div>${cardGrid(trending)}`;
  html += `<div class="section-h">🆕 Recently Updated</div>${cardGrid(latest)}`;
  if (watchlist.length) {
    html += `<div class="section-h">❤️ My List</div>${cardGrid(watchlist)}`;
  }
  return layout("Home", { html });
}

const GENRES = ["Action", "Adventure", "Comedy", "Romance", "Fantasy", "Horror", "Sci-Fi", "Drama", "Mystery", "Slice of Life", "Sports", "Thriller"];
const STATUSES = [["", "Any"], ["RELEASING", "Airing"], ["COMPLETED", "Completed"], ["NOT_YET_RELEASED", "Upcoming"]];
const TYPES = [["", "Any"], ["TV", "TV"], ["MOVIE", "Movie"], ["OVA", "OVA"], ["ONA", "ONA"]];
const YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];

async function browsePage(req) {
  const { genre = "", status = "", year = "", type = "" } = req.query || {};
  const items = await service.browseAnime({ genre, status, year, type, perPage: 24 }).catch(() => []);
  const options = (vals, current) => vals.map(([v, label]) => `<option value="${v}" ${String(v) === String(current) ? "selected" : ""}>${label}</option>`).join("");
  let html = `<h1>Browse</h1><div class="sub">Filter by genre, status, year and type</div>`;
  html += `<form method="get" action="/dashboard/anime/browse" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
    <select name="genre" style="background:var(--panel);border:1px solid var(--line);color:var(--text);padding:9px 12px;border-radius:10px">${options([["", "All genres"], ...GENRES.map((g) => [g, g])], genre)}</select>
    <select name="status" style="background:var(--panel);border:1px solid var(--line);color:var(--text);padding:9px 12px;border-radius:10px">${options(STATUSES, status)}</select>
    <select name="year" style="background:var(--panel);border:1px solid var(--line);color:var(--text);padding:9px 12px;border-radius:10px">${options([["", "Any year"], ...YEARS.map((y) => [String(y), String(y)])], year)}</select>
    <select name="type" style="background:var(--panel);border:1px solid var(--line);color:var(--text);padding:9px 12px;border-radius:10px">${options(TYPES, type)}</select>
    <button class="watch" style="margin-top:0">Filter</button>
    <a class="watch" style="margin-top:0;text-decoration:none" href="/dashboard/anime/browse">Reset</a>
  </form>`;
  html += cardGrid(items);
  return layout("Browse", { html });
}

async function schedulePage(day = new Date().getDay()) {
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const items = await service.getSchedule(day).catch(() => []);
  let html = `<h1>Schedule — ${DAYS[Number(day)]}</h1><div class="sub">Airings for the next 7 days on this weekday</div>`;
  html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px">${DAYS.map((d, i) => `<a href="/dashboard/anime/schedule?day=${i}" style="background:${i === Number(day) ? "var(--accent)" : "var(--panel)"};color:${i === Number(day) ? "#fff" : "var(--muted)"};border:1px solid var(--line);padding:7px 12px;border-radius:9px;font-size:12px;text-decoration:none">${d}</a>`).join("")}</div>`;
  html += items.length ? `<div class="feed">${items.map((a) => `
    <a href="/dashboard/anime/anilist/${esc(a.id)}" style="display:flex;align-items:center;gap:14px;padding:9px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit">
      ${a.cover ? `<img src="${esc(a.cover)}" style="width:44px;height:62px;object-fit:cover;border-radius:8px" onerror="this.style.visibility='hidden'" />` : `<div style="width:44px;height:62px;background:var(--panel2);border-radius:8px"></div>`}
      <div style="flex:1"><div style="font-weight:700">${esc(a.title)}</div><div style="color:var(--muted);font-size:12px">Ep ${a.episode}${a.rating ? " · ★" + a.rating : ""}</div></div>
      <span style="color:var(--muted);font-size:13px">${esc(a.time)}</span>
    </a>`).join("")}</div>` : `<div class="empty">No scheduled airings for this day in the next week.</div>`;
  return layout("Schedule", { html });
}

async function searchPage(q) {
  const results = q ? await service.searchAnime(q) : [];
  let html = `<h1>Search</h1><div class="sub">${results.length ? `${results.length} results for “${esc(q)}”` : "Try a title — e.g. “solo leveling”."}</div>`;
  html += cardGrid(results);
  return layout("Search", { html, _q: q });
}

async function trendingPage() {
  const items = await service.getTrending();
  return layout("Trending", { html: `<h1>Trending</h1><div class="sub">Popular right now</div>` + cardGrid(items) });
}

async function latestPage() {
  const items = await service.getLatest();
  return layout("Latest", { html: `<h1>Recently Updated</h1><div class="sub">New episodes</div>` + cardGrid(items) });
}

async function watchlistPage(req) {
  const list = service.loadWatchlist();
  let html = `<h1>Watchlist</h1><div class="sub">${list.length ? "Saved titles" : "Add titles from any anime page."}</div>`;
  html += list.length
    ? `<div class="grid">${list.map((a) => `
        <div class="card" style="position:relative">
          <a href="/dashboard/anime/${encodeURIComponent(a.provider)}/${encodeURIComponent(a.id)}">
            ${a.cover ? `<img class="cover" src="${esc(a.cover)}" onerror="this.style.visibility='hidden'" />` : `<div class="cover"></div>`}
            <div class="body"><div class="t">${esc(a.title)}</div><div class="meta"><span class="badge b-prov">${esc(PROVIDER_LABEL[a.provider] || a.provider)}</span></div></div>
          </a>
          <form method="post" action="/dashboard/anime/watchlist/remove" style="position:absolute;top:8px;right:8px">
            ${csrfField(req)}
            <input type="hidden" name="id" value="${esc(a.id)}" /><input type="hidden" name="provider" value="${esc(a.provider)}" />
            <button class="badge" style="background:var(--red);color:#fff;border:none;cursor:pointer">✕</button>
          </form>
        </div>`).join("")}</div>`
    : `<div class="empty">Your list is empty.</div>`;
  return layout("Watchlist", { html });
}

async function downloadsPage(req) {
  const snap = snapshot();
  const jobCard = (j) => `
    <div class="job">
      <div class="row"><span class="v">${esc(j.name)} — Ep ${j.episode}</span><span class="badge b-${j.status === "done" ? "status" : j.status === "failed" ? "score" : "prov"}">${esc(j.status)}</span></div>
      ${j.quality && j.quality !== "best" ? `<div class="row" style="margin-top:4px"><span class="k">quality</span><span class="v">${esc(j.quality)}p</span></div>` : ""}
      ${j.progress ? `<div style="margin-top:8px"><div style="background:var(--panel2);border-radius:6px;height:10px;overflow:hidden"><div style="background:linear-gradient(90deg,var(--accent),var(--accent2));height:100%;width:${Math.min(100, Math.round(j.progress.percent||0))}%"></div></div><div style="color:var(--muted);font-size:11px;margin-top:4px">${Math.round(j.progress.percent||0)}% ${j.progress.speed?"· "+esc(j.progress.speed):""}${j.progress.eta?" · ETA "+esc(j.progress.eta):""}</div></div>` : ""}
      ${j.current ? `<div class="row" style="margin-top:4px"><span class="k">stage</span><span class="v">${esc(j.current.provider)} · ${esc(j.current.stage)}</span></div>` : ""}
      ${j.result ? `<div class="row" style="margin-top:4px"><span class="k">result</span><span class="v">${(j.result.size / 1048576).toFixed(1)} MB · ${esc(j.result.provider)}</span></div>` : ""}
      ${j.result && j.source === "browser" ? `<a class="watch" style="margin-top:10px" href="/dashboard/anime/file/${esc(j.id)}">⬇️ Download file</a>` : ""}
      ${j.error ? `<div class="row" style="margin-top:4px"><span class="k" style="color:var(--red)">error</span><span class="v" style="color:var(--red)">${esc(j.error.code)}: ${esc(j.error.message)}</span></div>` : ""}
      ${j.steps.length ? `<div class="steps">${j.steps.slice(-10).map((s) => `<div class="${s.ok ? "step-ok" : "step-no"}">${s.ok ? "✓" : "✗"} ${esc(s.provider)} ${esc(s.stage)} — ${esc(s.message)}</div>`).join("")}</div>` : ""}
      ${j.status === "failed" ? `<form method="post" action="/dashboard/anime/retry" style="margin-top:10px">${csrfField(req)}<input type="hidden" name="id" value="${esc(j.id)}" /><button class="watch">↻ Retry</button></form>` : ""}
    </div>`;
  const active = [...snap.current, ...snap.queued];
  let html = `<h1>Downloads</h1><div class="sub">Live anime pipeline · active ${active.length} · done ${snap.counts.done} · failed ${snap.counts.failed}</div>`;
  html += active.length ? active.map(jobCard).join("") : `<div class="empty">No active downloads.</div>`;
  if (snap.recent.length) { html += `<div class="section-h">Recent</div>` + snap.recent.slice(0, 8).map(jobCard).join(""); }
  // Auto-refresh only while jobs are active, so progress/speed update live.
  if (active.length) { html += `<script>setTimeout(()=>location.reload(),4000)</script>`; }
  return layout("Downloads", { html });
}

async function detailPage(provider, id, req) {
  const entry = { provider, id, title: "" };
  // Try to enrich from the watchlist (may have metadata).
  const wl = service.loadWatchlist().find((e) => e.id === id && e.provider === provider);
  Object.assign(entry, wl || {});
  const d = await service.getDetails(entry);
  const eps = await service.getEpisodes(entry);
  const inWl = wl ? true : false;
  // Remember the last quality picked for this title.
  const prog = service.getContinueWatching(50).find((e) => e.id === id && e.provider === provider);
  const defaultQuality = prog?.quality || "best";

  const qualitySelect = `<select name="quality" style="background:var(--panel2);border:1px solid var(--line);color:var(--text);padding:4px 8px;border-radius:8px;font-size:12px;margin-top:6px">
    ${QUALITY_OPTIONS.map((q) => `<option value="${q}" ${String(q) === String(defaultQuality) ? "selected" : ""}>${q === "best" ? "Auto (best)" : q + "p"}</option>`).join("")}
  </select>`;

  let html = `<div class="detail">
    ${d.cover ? `<img class="poster" src="${esc(d.cover)}" onerror="this.style.visibility='hidden'" />` : `<div class="poster"></div>`}
    <div style="flex:1">
      <h1>${esc(d.title)}</h1>
      <div class="metaline">
        ${d.rating ? `<span>★ ${d.rating}</span>` : ""}
        ${d.type ? `<span>${esc(d.type)}</span>` : ""}
        ${d.year ? `<span>${esc(d.year)}</span>` : ""}
        ${d.episodes ? `<span>${d.episodes} eps</span>` : ""}
        ${d.status ? `<span class="badge b-status">${esc(d.status)}</span>` : ""}
        ${d.studios?.length ? `<span>${esc(d.studios.slice(0, 2).join(", "))}</span>` : ""}
        <span class="badge b-prov">${esc(PROVIDER_LABEL[d.provider] || d.provider)}</span>
      </div>
      ${d.genres?.length ? `<div class="tags">${d.genres.slice(0, 8).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>` : ""}
      ${d.description ? `<div class="desc">${esc(d.description.slice(0, 800))}</div>` : ""}
      <form method="post" action="/dashboard/anime/watchlist/toggle" style="margin-top:14px">
        ${csrfField(req)}
        <input type="hidden" name="provider" value="${esc(d.provider)}" />
        <input type="hidden" name="id" value="${esc(d.id)}" />
        <input type="hidden" name="title" value="${esc(d.title)}" />
        <input type="hidden" name="cover" value="${esc(d.cover || "")}" />
        <input type="hidden" name="rating" value="${esc(d.rating || "")}" />
        <input type="hidden" name="episodes" value="${esc(d.episodes || "")}" />
        <input type="hidden" name="redirect" value="/dashboard/anime/${esc(d.provider)}/${encodeURIComponent(d.id)}" />
        <button class="watch">${inWl ? "❤️ In your list" : "🤍 Add to watchlist"}</button>
      </form>
    </div>
  </div>`;

  html += `<div class="section-h">📺 Episodes${eps.length ? ` (${eps.length})` : ""}</div>`;
  if (eps.length) {
    html += `<div class="epgrid">${eps.map((ep) => `
      <div class="ep" style="display:flex;flex-direction:column">
        <a class="n" style="display:block;text-align:center;font-weight:800;font-size:15px" href="/dashboard/anime/watch/${esc(d.provider)}/${encodeURIComponent(d.id)}?ep=${ep.number}&quality=${encodeURIComponent(defaultQuality)}">▶ ${ep.number}</a>
        <div class="e" style="margin-top:3px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ep.title)}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <a class="watch" style="flex:1;justify-content:center;padding:6px 4px;font-size:11px;text-decoration:none" href="/dashboard/anime/watch/${esc(d.provider)}/${encodeURIComponent(d.id)}?ep=${ep.number}&quality=${encodeURIComponent(defaultQuality)}">Watch</a>
          <form method="post" action="/dashboard/anime/download" style="flex:1;display:flex">
            ${csrfField(req)}
            <input type="hidden" name="provider" value="${esc(d.provider)}" />
            <input type="hidden" name="id" value="${esc(d.id)}" />
            <input type="hidden" name="title" value="${esc(d.title)}" />
            <input type="hidden" name="episode" value="${ep.number}" />
            ${qualitySelect}
            <button type="submit" class="watch" style="flex:1;justify-content:center;padding:6px 4px;font-size:11px">DL</button>
          </form>
        </div>
      </div>`).join("")}</div>`;
  } else {
    html += `<div class="empty">Couldn't load episodes for this provider. Try another entry.</div>`;
  }
  return layout(d.title, { html });
}

// ── Routes ────────────────────────────────────────────────────────

router.get("/", async (req, res) => { try { res.send(await homePage(req)); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/search", async (req, res) => { try { res.send(await searchPage(req.query.q || "")); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/trending", async (req, res) => { try { res.send(await trendingPage()); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/latest", async (req, res) => { try { res.send(await latestPage()); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/watchlist", async (req, res) => { try { res.send(await watchlistPage(req)); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/downloads", async (req, res) => { try { res.send(await downloadsPage(req)); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/browse", async (req, res) => { try { res.send(await browsePage(req)); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/schedule", async (req, res) => { try { res.send(await schedulePage(req.query.day ?? new Date().getDay())); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/random", async (req, res) => {
  try {
    const a = await service.getRandom();
    if (!a) return res.redirect("/dashboard/anime/browse?random=failed");
    return res.redirect(`/dashboard/anime/${encodeURIComponent(a.provider)}/${encodeURIComponent(a.id)}`);
  } catch (e) { res.status(500).send(esc(e.message)); }
});

// Serve a finished browser-job file.
router.get("/file/:id", (req, res) => {
  try {
    const job = snapshot().recent.find((j) => j.id === req.params.id) || (() => { try { return require("./tools/animeJobManager").getJob(req.params.id); } catch (_) { return null; } })();
    if (!job?.result?.filePath || !job.result.size) return res.status(404).send("File not found or not ready.");
    const fs = require("fs");
    if (!fs.existsSync(job.result.filePath)) return res.status(404).send("File no longer on disk.");
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", job.result.size);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent((job.name || "anime") + "-ep" + (job.episode || "") + ".mp4")}"`);
    fs.createReadStream(job.result.filePath).pipe(res);
  } catch (e) { res.status(500).send(esc(e.message)); }
});

// ── Watch online (stream) ────────────────────────────────────────
// Resolves the episode's HLS m3u8 via the same engine WhatsApp uses, then shows
// an embedded player. `/proxy` relays the m3u8 + segments so protected streams
// (referer/UA-gated) actually play in the browser.
async function watchPage(provider, id, req) {
  const entry = { provider, id, title: "" };
  const wl = service.loadWatchlist().find((e) => e.id === id && e.provider === provider);
  Object.assign(entry, wl || {});
  const d = await service.getDetails(entry);
  const ep = Number(req.query.ep) || 1;
  const quality = req.query.quality || "best";

  const report = await resolveEpisode(d.title, ep, { preference: provider === "jikan" ? null : provider, quality });
  const src = report?.selected;

  if (!src || !src.url) {
    const why = report?.error || "no stream found";
    return layout("Watch", { html: `<h1>${esc(d.title)}</h1><div class="empty">Couldn't resolve a stream for ep ${ep}. ${esc(why)}</div>` });
  }

  // Proxy URL that adds the right headers + CORS so hls.js can fetch it.
  const proxied = `/dashboard/anime/proxy?u=${encodeURIComponent(src.url)}&r=${encodeURIComponent(src.headers?.Referer || src.headers?.referer || "")}`;

  return layout("Watch", { html: `
    <h1>${esc(d.title)} — Ep ${ep}</h1>
    <div class="sub">Streaming via ${esc(PROVIDER_LABEL[src.provider] || src.provider)} · ${esc(src.quality || "auto")}${src.height ? " · " + src.height + "p" : ""}</div>
    <div style="background:#000;border:1px solid var(--line);border-radius:14px;overflow:hidden;max-width:900px;aspect-ratio:16/9;margin-top:14px">
      <video id="v" controls autoplay style="width:100%;height:100%;display:block"></video>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <a class="watch" href="/dashboard/anime/${esc(provider)}/${encodeURIComponent(id)}">← Episodes</a>
      <a class="watch" style="text-decoration:none" href="/dashboard/anime/watch/${esc(provider)}/${encodeURIComponent(id)}?ep=${ep + 1}&quality=${esc(quality)}">Next ep ▶</a>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script>
    <script>
      var url = ${JSON.stringify(proxied)};
      var v = document.getElementById('v');
      if (Hls.isSupported()) { var h = new Hls(); h.loadSource(url); h.attachMedia(v); }
      else if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; }
    </script>` });
}

// Relay an m3u8/segment, preserving the provider's required headers (referer).
router.get("/proxy", (req, res) => {
  const target = req.query.u;
  const referer = req.query.r || "";
  if (!target || !/^https?:\/\//i.test(target)) return res.status(400).send("bad url");
  const lib = target.startsWith("https:") ? https : http;
  const headers = {};
  if (referer) headers.Referer = referer;
  headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
  const p = lib.get(target, { headers }, (up) => {
    res.status(up.statusCode || 200);
    res.setHeader("Content-Type", up.headers["content-type"] || "application/vnd.apple.mpegurl");
    if (up.headers["content-length"]) res.setHeader("Content-Length", up.headers["content-length"]);
    res.setHeader("Access-Control-Allow-Origin", "*");
    up.pipe(res);
  });
  p.on("error", (e) => { if (!res.headersSent) res.status(502).send("proxy error: " + e.message); else res.end(); });
});

router.get("/watch/:provider/:id", async (req, res) => {
  try { res.send(await watchPage(req.params.provider, req.params.id, req)); }
  catch (e) { res.status(500).send(esc(e.message)); }
});

router.get("/:provider/:id", async (req, res) => {
  try { res.send(await detailPage(req.params.provider, req.params.id, req)); }
  catch (e) { res.status(500).send(esc(e.message)); }
});

// Enqueue a download job (same engine as WhatsApp).
router.post("/download", async (req, res) => {
  try {
    const { provider, id, title, episode, quality } = req.body || {};
    if (!title || !episode) return res.redirect("/dashboard/anime?err=missing");
    const q = QUALITY_OPTIONS.includes(quality) ? quality : "best";
    const job = enqueueAnimeJob({
      name: title,
      episode: Number(episode) || 1,
      preferred: provider === "jikan" ? null : provider,
      quality: q,
      sock: null, chatId: null, quotedMsg: null,
    });
    // Track Continue Watching progress (with the picked quality).
    service.trackProgress({ id, provider, title, episode: Number(episode) || 1, quality: q, status: "watching" });
    res.redirect(`/dashboard/anime/downloads?job=${job.id}&ok=1`);
  } catch (e) { res.redirect(`/dashboard/anime?err=${encodeURIComponent(e.message)}`); }
});

router.post("/retry", async (req, res) => {
  try {
    const { id } = req.body || {};
    const fresh = retryJob(id);
    res.redirect(`/dashboard/anime/downloads${fresh ? "?retried=" + fresh.id : "?err=notfound"}`);
  } catch (e) { res.redirect("/dashboard/anime/downloads?err=1"); }
});

router.post("/watchlist/toggle", async (req, res) => {
  try {
    const { provider, id, title, cover, rating, episodes, redirect } = req.body || {};
    const existing = service.loadWatchlist().find((e) => e.id === id && e.provider === provider);
    if (existing) service.removeFromWatchlist(id, provider);
    else service.addToWatchlist({ id, provider, title, cover, rating, episodes });
    res.redirect(redirect || "/dashboard/anime/watchlist");
  } catch (e) { res.redirect("/dashboard/anime?err=1"); }
});

router.post("/watchlist/remove", async (req, res) => {
  try {
    const { id, provider } = req.body || {};
    service.removeFromWatchlist(id, provider);
    res.redirect("/dashboard/anime/watchlist");
  } catch (e) { res.redirect("/dashboard/anime/watchlist?err=1"); }
});

module.exports = router;
