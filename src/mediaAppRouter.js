// ARIA Unified Public Media Router — Hubs, Titles, Episodes, Player, Discovery, Library & Downloads

const express = require("express");
const router = express.Router();
const { mediaLayout, esc, svgIcon } = require("./tools/mediaLayout");
const mediaEngine = require("./tools/mediaEngine");
const userMediaStore = require("./tools/userMediaStore");
const { snapshot: animeSnapshot } = require("./tools/animeJobManager");

function getOwnerId(req) {
  const sessionCookie = req.cookies?.aria_anime_sid || req.headers["x-session-id"];
  if (sessionCookie) return `session:${sessionCookie}`;
  return "anonymous";
}

function cardComponent(item) {
  const href = item.type === "anime"
    ? `/anime/title/${encodeURIComponent(item.id)}`
    : `/movies/title/${encodeURIComponent(item.id)}`;
  return `<a class="media-card" href="${esc(href)}" style="display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; text-decoration: none; transition: transform 0.15s ease;">
    <div style="aspect-ratio: 2/3; background: var(--surface-2); position: relative; overflow: hidden;">
      <img src="${esc(item.poster || item.cover || "/aria-mark.png")}" alt="${esc(item.title)}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy">
      <span style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.7); font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${esc(item.type || "media")}</span>
    </div>
    <div style="padding: 12px; display: flex; flex-direction: column; gap: 6px;">
      <div style="font-size: 13px; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(item.title)}</div>
      <div style="font-size: 11px; color: var(--muted); display: flex; justify-content: space-between;">
        <span>${esc(item.year || "")}</span>
        <span style="color: #f5c451;">${item.rating ? "★ " + esc(item.rating) : ""}</span>
      </div>
    </div>
  </a>`;
}

function mediaGrid(items) {
  if (!items || !items.length) {
    return `<div style="padding: 40px; text-align: center; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted);">No media titles found in this view.</div>`;
  }
  return `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px;">
    ${items.map(cardComponent).join("")}
  </div>`;
}

// Global Search
router.get("/media/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const results = query ? await mediaEngine.searchGlobal(query) : [];
  const html = `<h1 style="font-size: 24px; font-weight: 800; margin-bottom: 16px;">Search Results ${query ? `for “${esc(query)}”` : ""}</h1>` + mediaGrid(results);
  res.send(mediaLayout("Search Results", "home", html));
});

// ARIA Media Unified Home
router.get(["/", "/media"], async (req, res) => {
  try {
    const [trending, latest] = await Promise.all([
      mediaEngine.getTrending("all"),
      mediaEngine.getLatest("all"),
    ]);

    const featured = trending[0] || { title: "ARIA Media Platform", synopsis: "Explore Anime, Movies, TV Series, Cartoons, and Kids entertainment." };

    const heroHtml = `<div style="background: linear-gradient(135deg, var(--surface-2), var(--surface)); border: 1px solid var(--line); border-radius: 16px; padding: 32px; margin-bottom: 32px; display: flex; flex-direction: column; gap: 16px;">
      <div style="font-size: 11px; font-weight: 800; color: var(--accent); letter-spacing: 0.1em; text-transform: uppercase;">Featured Title</div>
      <h1 style="font-size: 32px; font-weight: 800; line-height: 1.1;">${esc(featured.title)}</h1>
      <p style="font-size: 14px; color: var(--muted); max-width: 600px; line-height: 1.6;">${esc(featured.synopsis)}</p>
      <div style="display: flex; gap: 12px; margin-top: 8px;">
        <a href="/anime/recommend" style="background: var(--accent); color: #fff; font-size: 12px; font-weight: 800; padding: 10px 18px; border-radius: 8px;">Explore Recommendations</a>
        <a href="/library" style="background: var(--surface-3); border: 1px solid var(--line); color: var(--text); font-size: 12px; font-weight: 700; padding: 10px 18px; border-radius: 8px;">My Library</a>
      </div>
    </div>`;

    const html = heroHtml +
      `<h2 style="font-size: 20px; font-weight: 800; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">${svgIcon("home")} Trending Across ARIA</h2>` +
      mediaGrid(trending) +
      `<h2 style="font-size: 20px; font-weight: 800; margin: 32px 0 16px; display: flex; align-items: center; gap: 8px;">${svgIcon("movies")} Recently Added</h2>` +
      mediaGrid(latest);

    res.send(mediaLayout("Home", "home", html));
  } catch (err) {
    res.status(500).send("Media Home temporarily unavailable.");
  }
});

// Category Hubs: Series, Cartoons, Kids
router.get(["/series"], async (req, res) => {
  const items = await mediaEngine.getTrending("series");
  const html = `<h1 style="font-size: 24px; font-weight: 800; margin-bottom: 16px;">TV Series & Shows</h1>` + mediaGrid(items);
  res.send(mediaLayout("Series", "series", html));
});

router.get(["/cartoons"], async (req, res) => {
  const items = await mediaEngine.getTrending("cartoon");
  const html = `<h1 style="font-size: 24px; font-weight: 800; margin-bottom: 16px;">Cartoons & Animated Series</h1>` + mediaGrid(items);
  res.send(mediaLayout("Cartoons", "cartoons", html));
});

router.get(["/kids"], async (req, res) => {
  const items = await mediaEngine.getTrending("kids");
  const html = `<h1 style="font-size: 24px; font-weight: 800; margin-bottom: 16px;">Kids & Family Entertainment</h1>` + mediaGrid(items);
  res.send(mediaLayout("Kids", "kids", html));
});

// Recommendations & Discovery Engine
router.get(["/anime/recommend", "/recommend"], async (req, res) => {
  const genres = req.query.genres ? [].concat(req.query.genres) : [];
  const mood = req.query.mood ? [].concat(req.query.mood) : [];
  const year = req.query.year || "";
  const format = req.query.format || "";

  const results = await mediaEngine.recommendAnime({ genres, mood, year, format });

  const ALL_GENRES = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Isekai", "Mecha"];
  const ALL_MOODS = ["Intense", "Dark", "Funny", "Emotional", "Wholesome", "Relaxing", "Mind-bending", "Epic"];

  const formHtml = `<form action="/anime/recommend" method="get" style="background: var(--surface); border: 1px solid var(--line); padding: 24px; border-radius: 12px; margin-bottom: 32px; display: flex; flex-direction: column; gap: 20px;">
    <h1 style="font-size: 20px; font-weight: 800;">Anime Discovery Engine</h1>
    <p style="font-size: 13px; color: var(--muted);">Select your preferred genres, mood, format, or era to find matching anime.</p>

    <div>
      <div style="font-size: 12px; font-weight: 700; margin-bottom: 8px;">Genres</div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${ALL_GENRES.map(g => `<label style="font-size: 12px; background: var(--surface-2); border: 1px solid var(--line); padding: 6px 12px; border-radius: 6px; cursor: pointer;">
          <input type="checkbox" name="genres" value="${g}" ${genres.includes(g) ? "checked" : ""}> ${g}
        </label>`).join("")}
      </div>
    </div>

    <div>
      <div style="font-size: 12px; font-weight: 700; margin-bottom: 8px;">Mood / Tone</div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${ALL_MOODS.map(m => `<label style="font-size: 12px; background: var(--surface-2); border: 1px solid var(--line); padding: 6px 12px; border-radius: 6px; cursor: pointer;">
          <input type="checkbox" name="mood" value="${m}" ${mood.includes(m) ? "checked" : ""}> ${m}
        </label>`).join("")}
      </div>
    </div>

    <button type="submit" style="background: var(--accent); color: #fff; font-weight: 800; font-size: 13px; padding: 12px; border: 0; border-radius: 8px; cursor: pointer; width: 180px;">Find My Anime</button>
  </form>`;

  const html = formHtml + `<h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">Matching Titles (${results.length})</h2>` + mediaGrid(results);
  res.send(mediaLayout("Anime Discovery", "recommend", html));
});

// Title Detail Pages for Movies and General Media
router.get("/movies/title/:id", async (req, res) => {
  const { id } = req.params;
  const details = await mediaEngine.getDetails("movie", id);

  const html = `<div style="display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 32px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 24px; margin-bottom: 32px;">
    <img src="${esc(details.poster || "/aria-mark.png")}" alt="${esc(details.title)}" style="width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: 12px; background: var(--surface-2);">
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="font-size: 11px; font-weight: 800; color: var(--accent); text-transform: uppercase;">Movie Profile · ${esc(details.year || "")}</div>
      <h1 style="font-size: 32px; font-weight: 800; line-height: 1.1;">${esc(details.title)}</h1>
      <div style="font-size: 12px; color: var(--muted); display: flex; gap: 12px;">
        <span>★ ${esc(details.rating || "N/A")}</span>
        <span>${esc(details.runtime || "")}</span>
      </div>
      <p style="font-size: 14px; color: var(--text); line-height: 1.6; margin-top: 8px;">${esc(details.synopsis || "No description available.")}</p>
      <div style="display: flex; gap: 12px; margin-top: 16px;">
        <a href="/movies" style="background: var(--surface-2); border: 1px solid var(--line); color: var(--text); font-size: 12px; font-weight: 700; padding: 10px 18px; border-radius: 8px;">Back to Movies</a>
      </div>
    </div>
  </div>`;

  res.send(mediaLayout(details.title || "Movie Details", "movies", html));
});

// Library Workspace
router.get(["/library"], (req, res) => {
  const ownerId = getOwnerId(req);
  const watchlist = userMediaStore.getWatchlist(ownerId);
  const continueList = userMediaStore.getContinueWatching(ownerId);
  const history = userMediaStore.getHistory(ownerId);

  const html = `<h1 style="font-size: 24px; font-weight: 800; margin-bottom: 24px;">My Library</h1>

    <section style="margin-bottom: 32px;">
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 12px;">Continue Watching</h2>
      ${mediaGrid(continueList)}
    </section>

    <section style="margin-bottom: 32px;">
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 12px;">Watchlist</h2>
      ${mediaGrid(watchlist)}
    </section>

    <section>
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 12px;">History</h2>
      ${mediaGrid(history)}
    </section>`;

  res.send(mediaLayout("My Library", "library", html));
});

// Download Manager Workspace
router.get(["/downloads"], (req, res) => {
  const snap = animeSnapshot();
  const jobs = [...snap.current, ...snap.queued, ...snap.recent];

  const html = `<h1 style="font-size: 24px; font-weight: 800; margin-bottom: 16px;">Download Manager</h1>
    <p style="font-size: 13px; color: var(--muted); margin-bottom: 24px;">Active and completed media downloads queued through the ARIA engine.</p>

    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${jobs.length ? jobs.map(j => `<div style="background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 14px; font-weight: 700;">${esc(j.name)} - Ep ${esc(j.episode)}</div>
          <div style="font-size: 11px; color: var(--muted);">Quality: ${esc(j.quality)} | Status: <span style="color: var(--accent); font-weight: 800;">${esc(j.status)}</span></div>
        </div>
        <div>
          ${j.status === "done" && j.result ? `<a href="/anime/file/${encodeURIComponent(j.id)}" style="background: var(--accent); color: #fff; font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 6px;">Download File</a>` : ""}
        </div>
      </div>`).join("") : `<div style="padding: 40px; text-align: center; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted);">No active or recent download jobs.</div>`}
    </div>`;

  res.send(mediaLayout("Downloads", "downloads", html));
});

module.exports = router;
