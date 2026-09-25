// ARIA Media Platform API Router (mounted at /api/media)
const express = require("express");
const router = express.Router();
const mediaEngine = require("./tools/mediaEngine");
const userMediaStore = require("./tools/userMediaStore");
const { snapshot: animeSnapshot, emitter: jobEmitter } = require("./tools/animeJobManager");

router.use(express.json());

function getOwnerId(req) {
  const sessionCookie = req.cookies?.aria_anime_sid || req.headers["x-session-id"];
  if (sessionCookie) return `session:${sessionCookie}`;
  return "anonymous";
}

// Global & Category Search
router.get("/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) return res.json({ ok: true, results: [] });
    const results = await mediaEngine.searchGlobal(query);
    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Search query failed" });
  }
});

// Trending
router.get("/trending", async (req, res) => {
  try {
    const type = String(req.query.type || "all");
    const results = await mediaEngine.getTrending(type);
    res.json({ ok: true, type, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Trending fetch failed" });
  }
});

// Latest Releases
router.get("/latest", async (req, res) => {
  try {
    const type = String(req.query.type || "all");
    const results = await mediaEngine.getLatest(type);
    res.json({ ok: true, type, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Latest fetch failed" });
  }
});

// Recommendations / Discovery Engine
router.get("/recommendations", async (req, res) => {
  try {
    const type = String(req.query.type || "anime");
    const genres = req.query.genres ? String(req.query.genres).split(",") : [];
    const mood = req.query.mood ? String(req.query.mood).split(",") : [];
    const year = String(req.query.year || "");
    const status = String(req.query.status || "");
    const format = String(req.query.format || "");

    let results = [];
    if (type === "anime") {
      results = await mediaEngine.recommendAnime({ genres, mood, year, status, format });
    } else {
      results = await mediaEngine.recommendMovies({ genres, mood });
    }
    res.json({ ok: true, type, filters: { genres, mood, year, status, format }, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Recommendation failed" });
  }
});

// User Library: Watchlist
router.get("/watchlist", (req, res) => {
  const ownerId = getOwnerId(req);
  const items = userMediaStore.getWatchlist(ownerId);
  res.json({ ok: true, count: items.length, items });
});

router.post("/watchlist", (req, res) => {
  const ownerId = getOwnerId(req);
  const success = userMediaStore.addToWatchlist(ownerId, req.body);
  if (!success) return res.status(400).json({ ok: false, error: "Invalid media item payload" });
  res.json({ ok: true, message: "Added to watchlist" });
});

router.delete("/watchlist/:type/:id", (req, res) => {
  const ownerId = getOwnerId(req);
  const { type, id } = req.params;
  const removed = userMediaStore.removeFromWatchlist(ownerId, type, id);
  res.json({ ok: true, removed });
});

// User Library: History & Continue Watching
router.get("/history", (req, res) => {
  const ownerId = getOwnerId(req);
  const items = userMediaStore.getHistory(ownerId);
  res.json({ ok: true, count: items.length, items });
});

router.post("/history", (req, res) => {
  const ownerId = getOwnerId(req);
  const success = userMediaStore.recordHistory(ownerId, req.body);
  if (!success) return res.status(400).json({ ok: false, error: "Invalid history payload" });
  res.json({ ok: true, message: "History recorded" });
});

router.get("/continue-watching", (req, res) => {
  const ownerId = getOwnerId(req);
  const items = userMediaStore.getContinueWatching(ownerId);
  res.json({ ok: true, count: items.length, items });
});

router.post("/continue-watching", (req, res) => {
  const ownerId = getOwnerId(req);
  const success = userMediaStore.updateProgress(ownerId, req.body);
  if (!success) return res.status(400).json({ ok: false, error: "Invalid progress payload" });
  res.json({ ok: true, message: "Progress updated" });
});

// Downloads Manager & Real-Time Events (SSE)
router.get("/downloads", (req, res) => {
  const snap = animeSnapshot();
  res.json({ ok: true, downloads: snap });
});

router.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const listener = (job) => {
    res.write(`data: ${JSON.stringify({ event: "download.update", job })}\n\n`);
  };

  jobEmitter.on("update", listener);

  req.on("close", () => {
    jobEmitter.off("update", listener);
  });
});

module.exports = router;
