// ── ARIA Anime Browser — a first-class web section ───────────────
// Mounted at /dashboard/anime (behind the same session auth as the
// dashboard). Server-rendered. Reuses the normalized anime service for
// search/details/episodes and the anime job manager for downloads, so the
// web browser and WhatsApp commands share one engine.

const express = require("express");
const path = require("path");
const router = express.Router();
const service = require("./tools/animeService");
const { enqueueAnimeJob, retryJob, snapshot } = require("./tools/animeJobManager");

router.use(express.urlencoded({ extended: true }));

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
    <a href="/dashboard/anime/trending">Trending</a>
    <a href="/dashboard/anime/latest">Latest</a>
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

async function homePage() {
  const [trending, latest] = await Promise.all([service.getTrending(), service.getLatest()]);
  const watchlist = service.loadWatchlist();
  let html = `<div class="section-h">🔥 Trending</div>${cardGrid(trending)}`;
  html += `<div class="section-h">🆕 Recently Updated</div>${cardGrid(latest)}`;
  if (watchlist.length) {
    html += `<div class="section-h">❤️ My List</div>${cardGrid(watchlist)}`;
  }
  return layout("Home", { html });
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

async function watchlistPage() {
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
            <input type="hidden" name="id" value="${esc(a.id)}" /><input type="hidden" name="provider" value="${esc(a.provider)}" />
            <button class="badge" style="background:var(--red);color:#fff;border:none;cursor:pointer">✕</button>
          </form>
        </div>`).join("")}</div>`
    : `<div class="empty">Your list is empty.</div>`;
  return layout("Watchlist", { html });
}

async function downloadsPage() {
  const snap = snapshot();
  const jobCard = (j) => `
    <div class="job">
      <div class="row"><span class="v">${esc(j.name)} — Ep ${j.episode}</span><span class="badge b-${j.status === "done" ? "status" : j.status === "failed" ? "score" : "prov"}">${esc(j.status)}</span></div>
      ${j.current ? `<div class="row" style="margin-top:4px"><span class="k">stage</span><span class="v">${esc(j.current.provider)} · ${esc(j.current.stage)}</span></div>` : ""}
      ${j.result ? `<div class="row" style="margin-top:4px"><span class="k">result</span><span class="v">${(j.result.size / 1048576).toFixed(1)} MB · ${esc(j.result.provider)}</span></div>` : ""}
      ${j.result && j.source === "browser" ? `<a class="watch" style="margin-top:10px" href="/dashboard/anime/file/${esc(j.id)}">⬇️ Download file</a>` : ""}
      ${j.error ? `<div class="row" style="margin-top:4px"><span class="k" style="color:var(--red)">error</span><span class="v" style="color:var(--red)">${esc(j.error.code)}: ${esc(j.error.message)}</span></div>` : ""}
      ${j.steps.length ? `<div class="steps">${j.steps.slice(-10).map((s) => `<div class="${s.ok ? "step-ok" : "step-no"}">${s.ok ? "✓" : "✗"} ${esc(s.provider)} ${esc(s.stage)} — ${esc(s.message)}</div>`).join("")}</div>` : ""}
      ${j.status === "failed" ? `<form method="post" action="/dashboard/anime/retry" style="margin-top:10px"><input type="hidden" name="id" value="${esc(j.id)}" /><button class="watch">↻ Retry</button></form>` : ""}
    </div>`;
  const active = [...snap.current, ...snap.queued];
  let html = `<h1>Downloads</h1><div class="sub">Live anime pipeline · active ${active.length} · done ${snap.counts.done} · failed ${snap.counts.failed}</div>`;
  html += active.length ? active.map(jobCard).join("") : `<div class="empty">No active downloads.</div>`;
  if (snap.recent.length) { html += `<div class="section-h">Recent</div>` + snap.recent.slice(0, 8).map(jobCard).join(""); }
  return layout("Downloads", { html });
}

async function detailPage(provider, id) {
  const entry = { provider, id, title: "" };
  // Try to enrich from the watchlist (may have metadata).
  const wl = service.loadWatchlist().find((e) => e.id === id && e.provider === provider);
  Object.assign(entry, wl || {});
  const d = await service.getDetails(entry);
  const eps = await service.getEpisodes(entry);
  const inWl = wl ? true : false;

  const dlAction = (epNum) => {
    const target = d.provider === "jikan"
      ? `provider=jikan&id=${encodeURIComponent(d.id)}&title=${encodeURIComponent(d.title)}`
      : `provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(d.title)}`;
    return target;
  };

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
      <form method="post" action="/dashboard/anime/download" class="ep">
        <input type="hidden" name="provider" value="${esc(d.provider)}" />
        <input type="hidden" name="id" value="${esc(d.id)}" />
        <input type="hidden" name="title" value="${esc(d.title)}" />
        <input type="hidden" name="episode" value="${ep.number}" />
        <button type="submit" style="background:none;border:none;color:inherit;cursor:pointer;width:100%">
          <div class="n">${ep.number}</div>
          <div class="e">${esc(ep.title)}</div>
        </button>
      </form>`).join("")}</div>`;
  } else {
    html += `<div class="empty">Couldn't load episodes for this provider. Try another entry.</div>`;
  }
  return layout(d.title, { html });
}

// ── Routes ────────────────────────────────────────────────────────

router.get("/", async (req, res) => { try { res.send(await homePage()); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/search", async (req, res) => { try { res.send(await searchPage(req.query.q || "")); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/trending", async (req, res) => { try { res.send(await trendingPage()); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/latest", async (req, res) => { try { res.send(await latestPage()); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/watchlist", async (req, res) => { try { res.send(await watchlistPage()); } catch (e) { res.status(500).send(esc(e.message)); } });
router.get("/downloads", async (req, res) => { try { res.send(await downloadsPage()); } catch (e) { res.status(500).send(esc(e.message)); } });

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

router.get("/:provider/:id", async (req, res) => {
  try { res.send(await detailPage(req.params.provider, req.params.id)); }
  catch (e) { res.status(500).send(esc(e.message)); }
});

// Enqueue a download job (same engine as WhatsApp).
router.post("/download", async (req, res) => {
  try {
    const { provider, id, title, episode } = req.body || {};
    if (!title || !episode) return res.redirect("/dashboard/anime?err=missing");
    const job = enqueueAnimeJob({
      name: title,
      episode: Number(episode) || 1,
      preferred: provider === "jikan" ? null : provider,
      sock: null, chatId: null, quotedMsg: null,
    });
    // Persist the chosen provider+id so the job manager can pin it later;
    // store it in the job's metadata via the preferred provider hint.
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
