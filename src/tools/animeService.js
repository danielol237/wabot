// ── Anime Service — normalized provider-agnostic data layer ───────
// ARIA's single anime engine. Every provider normalizes to:
//   { id, title, cover, description, genres, status, year, rating,
//     episodes, provider }
// Providers are queried in priority order and merged, so the UI never
// cares which backend answered — and IDs never leak across providers.

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/animeWatchlist.json");
const PROGRESS_FILE = path.join(__dirname, "../../data/animeProgress.json");

// AniList GraphQL — reliable, keyless fallback for search/trending/latest
// (Jikan/MAL is frequently rate-limited or 504s, which gutted the browser).
const ANILIST_URL = "https://graphql.anilist.co";

// Public catalog policy: exclude AniList adult titles, adult-only genres/tags,
// and a conservative set of explicit title terms from public discovery.
const BLOCKED_TITLE_RE = /(?:\bhentai\b|\becchi\b|\bporn\b|\bxxx\b|\berotic\b|kyonyuu|nuki\s*nuki|bokki|sex\s+ga\s+suki|paihame|overflow|adult\s+only)/i;
const BLOCKED_GENRE_RE = /(?:hentai|ecchi|erotica)/i;
function isCatalogSafe(item) {
  if (!item || item.isAdult === true || BLOCKED_TITLE_RE.test(String(item.title || ""))) return false;
  const values = [...(item.genres || []), ...(item.tags || [])];
  return !values.some((value) => BLOCKED_GENRE_RE.test(String(value?.name || value || "")));
}
function safeCatalog(items) { return (Array.isArray(items) ? items : []).filter(isCatalogSafe); }

async function anilist(query, variables) {
  try {
    const r = await axios.post(ANILIST_URL, { query, variables }, { timeout: 12000 });
    return r.data?.data || null;
  } catch (_) { return null; }
}

function fromAnilist(page) {
  return safeCatalog((page?.media || []).map((a) => ({
    id: String(a.id),
    title: a.title?.english || a.title?.romaji || a.title?.native || "Untitled",
    cover: a.coverImage?.extraLarge || a.coverImage?.large || "",
    description: a.description ? a.description.replace(/<[^>]+>/g, "").slice(0, 400) : "",
    overview: a.description ? a.description.replace(/<[^>]+>/g, "").slice(0, 400) : "",
    genres: a.genres || [],
    tags: (a.tags || []).map((tag) => tag?.name || tag).filter(Boolean),
    isAdult: a.isAdult === true,
    status: a.status ? a.status.replace(/_/g, " ") : "",
    year: a.seasonYear,
    rating: a.averageScore ? a.averageScore / 10 : null,
    episodes: a.episodes,
    type: a.format,
    provider: "anilist",
  })));
}

// ── Watchlist and progress (persisted, per-user namespaces) ─────────
const LEGACY_SCOPE = "legacy";
function scopeFor(userId) { return String(userId || LEGACY_SCOPE).replace(/[^a-zA-Z0-9._:@-]/g, "_").slice(0, 160) || LEGACY_SCOPE; }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; }
}
function atomicJsonWrite(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch (_) {}
  } catch (_) {}
}
function scopedUsers(file, defaultValue) {
  const raw = readJson(file, defaultValue);
  if (raw && !Array.isArray(raw) && raw.users && typeof raw.users === "object") return raw.users;
  if (Array.isArray(raw)) {
    const migrated = { [LEGACY_SCOPE]: raw };
    atomicJsonWrite(file, { version: 1, users: migrated });
    return migrated;
  }
  if (raw && typeof raw === "object" && file === PROGRESS_FILE) {
    const migrated = { [LEGACY_SCOPE]: raw };
    atomicJsonWrite(file, { version: 1, users: migrated });
    return migrated;
  }
  return {};
}
function loadWatchlist(userId) {
  const users = scopedUsers(DATA_FILE, []);
  const list = users[scopeFor(userId)] || [];
  return Array.isArray(list) ? list : [];
}
function saveWatchlist(list, userId = LEGACY_SCOPE) {
  const users = scopedUsers(DATA_FILE, []);
  users[scopeFor(userId)] = Array.isArray(list) ? list : [];
  atomicJsonWrite(DATA_FILE, { version: 1, users });
}
function addToWatchlist(entry, userId = LEGACY_SCOPE) {
  const list = loadWatchlist(userId);
  if (!list.some((e) => e.id === entry.id && e.provider === entry.provider)) list.push(entry);
  saveWatchlist(list, userId);
  return list;
}
function removeFromWatchlist(id, provider, userId = LEGACY_SCOPE) {
  const list = loadWatchlist(userId).filter((e) => !(e.id === id && (!provider || e.provider === provider)));
  saveWatchlist(list, userId);
  return list;
}

// Tracks each user's last watched/downloaded episode and chosen quality.
function loadProgress(userId) {
  const users = scopedUsers(PROGRESS_FILE, {});
  const progress = users[scopeFor(userId)] || {};
  return progress && typeof progress === "object" && !Array.isArray(progress) ? progress : {};
}
function saveProgress(progress, userId = LEGACY_SCOPE) {
  const users = scopedUsers(PROGRESS_FILE, {});
  users[scopeFor(userId)] = progress && typeof progress === "object" ? progress : {};
  atomicJsonWrite(PROGRESS_FILE, { version: 1, users });
}

function trackProgress({ id, provider, title, cover, episode, quality, status, userId }) {
  const p = loadProgress(userId);
  const key = provider + ":" + id;
  const prev = p[key] || {};
  p[key] = {
    id, provider, title: title || prev.title, cover: cover || prev.cover,
    episode: Number(episode) || prev.episode || 1,
    quality: quality || prev.quality || "best",
    status: status || "watching",
    updatedAt: Date.now(),
  };
  saveProgress(p, userId);
  return p[key];
}

function markCompleted({ id, provider, userId }) {
  const p = loadProgress(userId);
  const key = provider + ":" + id;
  if (p[key]) { p[key].status = "completed"; p[key].updatedAt = Date.now(); saveProgress(p, userId); }
  return p[key] || null;
}

function getContinueWatching(limit = 10, userId) {
  return Object.values(loadProgress(userId))
    .filter((e) => e.status !== "completed")
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);
}

// ── Search across providers ───────────────────────────────────────
// Merges results from several sources, preferring the richest metadata.
async function searchAnime(query) {
  const buckets = {
    anilist: [], jikan: [], omnisave: [], consumet: [], animepahe: [], gogoanime: [],
  };

  // Race all providers against a hard deadline so a single slow/hung provider
  // can NEVER block the whole search. Unfinished buckets are skipped.
  await Promise.race([
    Promise.all([
    (async () => {
      try {
        const data = await anilist(
          `query($q:String){Page(perPage:12){media(search:$q,type:ANIME,sort:SEARCH_MATCH){id
            title{english romaji native} coverImage{extraLarge large} description genres tags{name} isAdult status
            seasonYear averageScore episodes format}}}`,
          { q: query }
        );
        buckets.anilist = fromAnilist(data?.Page);
      } catch (_) {}
    })(),
    (async () => {
      try {
        const r = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=12&sfw`, { timeout: 8000 });
        buckets.jikan = (r.data.data || []).map((a) => ({
          id: String(a.mal_id), title: a.title, cover: a.images?.jpg?.image_url,
          description: a.synopsis?.slice(0, 300) || "", genres: a.genres?.map((g) => g.name) || [],
          status: a.status, year: a.year, rating: a.score, episodes: a.episodes, type: a.type, provider: "jikan",
        }));
      } catch (_) {}
    })(),
    (async () => {
      try {
        const { searchOmniSave } = require("./animeDownload");
        buckets.omnisave = (await searchOmniSave(query)).map((r) => ({
          id: r.subjectId, title: r.title, cover: r.image, rating: r.rating,
          year: r.year ? String(r.year) : "", episodes: null, provider: "omnisave", detailPath: r.detailPath,
        }));
      } catch (_) {}
    })(),
    (async () => {
      try {
        const { consumetSearch } = require("./animeConsumet");
        const c = await consumetSearch(query);
        buckets.consumet = (c.results || []).map((r) => ({
          id: r.id, title: r.title, cover: r.image, rating: r.score, episodes: r.episodes,
          type: r.type, provider: "consumet", _consumetSource: c.source,
        }));
      } catch (_) {}
    })(),
    (async () => {
      try {
        const { searchAnimePahe } = require("./animeDownload");
        buckets.animepahe = (await searchAnimePahe(query)).map((r) => ({
          id: r.id, title: r.title, cover: r.image, episodes: r.episodes, type: r.type,
          rating: r.score, provider: "animepahe",
        }));
      } catch (_) {}
    })(),
    (async () => {
      try {
        const { searchGogo } = require("./animeGogo");
        buckets.gogoanime = (await searchGogo(query)).map((r) => ({
          id: r.id.replace(/^category\//, ""), title: r.title, cover: r.image, provider: "gogoanime",
        }));
      } catch (_) {}
    })(),
    ]),
    new Promise((resolve) => setTimeout(resolve, 10000)), // 10s hard cap
  ]);

  // Deterministic priority: rich metadata first, dedupe by title.
  const order = ["anilist", "jikan", "consumet", "omnisave", "animepahe", "gogoanime"];
  const seen = new Set();
  const out = [];
  for (const key of order) {
    for (const it of buckets[key] || []) {
      if (!it.title) continue;
      const norm = it.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(it);
    }
  }
  return safeCatalog(out).slice(0, 24);
}

// ── Trending / top (Jikan) ────────────────────────────────────────
async function getTrending() {
  // AniList: top anime by popularity this season (reliable fallback).
  const data = await anilist(
    `query{Page(perPage:12){media(type:ANIME,sort:POPULARITY_DESC,status:RELEASING){id
      title{english romaji} coverImage{extraLarge large} seasonYear averageScore episodes format status isAdult}}}`
  );
  if (data?.Page?.media?.length) return fromAnilist(data.Page);

  // Fallback to Jikan/MAL.
  try {
    const r = await axios.get("https://api.jikan.moe/v4/top/anime?filter=airing&limit=12", { timeout: 10000 });
    return safeCatalog((r.data.data || []).map((a) => ({
      id: String(a.mal_id),
      title: a.title,
      cover: a.images?.jpg?.image_url,
      isAdult: /(?:rx|hentai|ecchi)/i.test(String(a.rating || "")),
      rating: a.score,
      episodes: a.episodes,
      type: a.type,
      year: a.year,
      provider: "jikan",
    })));
  } catch (_) { return []; }
}

// Recently updated (current season, newest) via Jikan seasonal
async function getLatest() {
  // AniList: newest episodes / recently airing.
  const data = await anilist(
    `query{Page(perPage:12){media(type:ANIME,status:RELEASING,sort:UPDATED_AT_DESC){id
      title{english romaji} coverImage{extraLarge large} seasonYear averageScore episodes format status isAdult}}}`
  );
  if (data?.Page?.media?.length) return fromAnilist(data.Page);

  // Fallback to Jikan/MAL current season.
  try {
    const r = await axios.get("https://api.jikan.moe/v4/seasons/now?limit=12", { timeout: 10000 });
    return safeCatalog((r.data.data || []).map((a) => ({
      id: String(a.mal_id),
      title: a.title,
      cover: a.images?.jpg?.image_url,
      isAdult: /(?:rx|hentai|ecchi)/i.test(String(a.rating || "")),
      rating: a.score,
      episodes: a.episodes,
      type: a.type,
      year: a.year,
      status: a.airing ? "Airing" : "Completed",
      provider: "jikan",
    })));
  } catch (_) { return []; }
}

// ── Detail + episodes for a provider-pinned anime ─────────────────
async function getDetails(entry) {
  const provider = entry.provider || "jikan";
  const id = entry.id;

  // Jikan has the richest metadata.
  if (provider === "jikan") {
    try {
      const r = await axios.get(`https://api.jikan.moe/v4/anime/${id}/full`, { timeout: 10000 });
      const a = r.data.data;
      return {
        id: String(a.mal_id), title: a.title, cover: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url,
        description: a.synopsis || "", genres: a.genres?.map((g) => g.name) || [], isAdult: /(?:rx|hentai|ecchi)/i.test(String(a.rating || "")),
        status: a.status, year: a.year, rating: a.score, episodes: a.episodes,
        type: a.type, duration: a.duration, studios: a.studios?.map((s) => s.name) || [],
        provider: "jikan",
      };
    } catch (_) {}
  }

  if (provider === "anilist") {
    const data = await anilist(`query($id:Int){Media(id:$id,type:ANIME){id title{english romaji native} coverImage{extraLarge large} description genres tags{name} isAdult status seasonYear averageScore episodes format externalLinks{site url type language}}}`, { id: Number(id) });
    const a = data?.Media;
    if (a) {
      const description = a.description ? a.description.replace(/<[^>]+>/g, "").slice(0, 800) : "";
      return { id: String(a.id), title: a.title?.english || a.title?.romaji || a.title?.native || "Untitled", cover: a.coverImage?.extraLarge || a.coverImage?.large || "", description, overview: description, genres: a.genres || [], tags: (a.tags || []).map((tag) => tag?.name || tag).filter(Boolean), externalLinks: (a.externalLinks || []).filter((link) => link?.url).map((link) => ({ site: link.site || "Official site", url: link.url, type: link.type || "", language: link.language || "" })), isAdult: a.isAdult === true, status: a.status ? a.status.replace(/_/g, " ") : "", year: a.seasonYear, rating: a.averageScore ? a.averageScore / 10 : null, episodes: a.episodes, type: a.format, provider: "anilist" };
    }
  }

  // Fall back to whatever we already know about it.
  return {
    id, title: entry.title || "Untitled", cover: entry.cover || "", description: entry.description || "",
    overview: entry.overview || entry.description || "", genres: entry.genres || [], tags: entry.tags || [], isAdult: entry.isAdult === true, status: entry.status || "", year: entry.year || "",
    rating: entry.rating || null, episodes: entry.episodes || null, type: entry.type || "",
    provider,
  };
}

async function getEpisodes(entry) {
  const provider = entry.provider || "jikan";
  const id = entry.id;

  if (provider === "jikan") {
    try {
      const r = await axios.get(`https://api.jikan.moe/v4/anime/${id}/episodes?limit=100`, { timeout: 10000 });
      return (r.data.data || []).map((ep) => ({
        number: ep.mal_id, title: ep.title || `Episode ${ep.mal_id}`,
      }));
    } catch (_) { return []; }
  }

  if (provider === "anilist") {
    const data = await anilist(`query($id:Int){Media(id:$id,type:ANIME){episodes}}`, { id: Number(id) });
    const count = Number(data?.Media?.episodes || entry.episodes || 0);
    if (count > 0) return Array.from({ length: Math.min(count, 300) }, (_, i) => ({ number: i + 1, title: `Episode ${i + 1}` }));
  }

  if (provider === "consumet" && entry._consumetSource) {
    try {
      const { consumetEpisodeStream } = require("./animeConsumet");
      const { ANIME } = require("@consumet/extensions");
      const Cls = ANIME[entry._consumetSource];
      if (Cls) {
        const p = new Cls();
        const info = await p.fetchAnimeInfo(id, 1);
        const eps = info.episodes || [];
        return eps.map((ep) => ({ number: ep.number, title: ep.title || `Episode ${ep.number}`, _epId: ep.id }));
      }
    } catch (_) {}
  }

  // Never invent an episode count. Unknown or ongoing series should expose a
  // manual episode picker in the UI rather than misleading users with 12 items.
  const n = Number(entry.episodes) || 0;
  return n > 0 ? Array.from({ length: Math.min(n, 200) }, (_, i) => ({ number: i + 1, title: `Episode ${i + 1}` })) : [];
}

// ── Browse with filters (AniList) ─────────────────────────────────
// genre, status (RELEASING/COMPLETED/NOT_YET_RELEASED), year, type.
async function browseAnime({ genre, status, year, type, sort = "POPULARITY_DESC", perPage = 24 }) {
  const args = [];
  if (genre) args.push(`genre:${JSON.stringify(genre)}`);
  if (status) args.push(`status:${status}`);
  if (year) args.push(`seasonYear:${Number(year)}`);
  if (type) args.push(`format:${type}`);
  const filterStr = args.length ? args.join(",") + "," : "";
  const query = `query($page:Int){Page(page:$page,perPage:${perPage}){media(${filterStr}type:ANIME,sort:${sort}){id
    title{english romaji native} coverImage{extraLarge large} description genres tags{name} isAdult status
    seasonYear averageScore episodes format}}}`;
  const data = await anilist(query, { page: 1 });
  return fromAnilist(data?.Page);
}

// ── Random anime (AniList) ────────────────────────────────────────
async function getRandom() {
  // Fetch a random page of anime (IDs are sparse, so a random single-ID query
  // often misses). Pull 20 and pick one at random, retrying a few times.
  for (let i = 0; i < 3; i++) {
    const page = Math.floor(Math.random() * 100) + 1;
    const data = await anilist(
      `query($page:Int){Page(page:$page,perPage:20){media(type:ANIME,sort:POPULARITY_DESC){id
        title{english romaji native} coverImage{extraLarge large} description genres tags{name} isAdult status
        seasonYear averageScore episodes format}}}`,
      { page }
    );
    const items = fromAnilist(data?.Page);
    if (items.length) return items[Math.floor(Math.random() * items.length)];
  }
  return null;
}

// ── Daily schedule (AniList airingSchedule) ────────────────────────
// day: 0-6 (0=Sunday). Returns airing anime for the next week, filtered
// to the requested weekday.
async function getSchedule(day = new Date().getDay()) {
  const now = Math.floor(Date.now() / 1000);
  const dayMs = 24 * 60 * 60;
  const start = now;
  const end = now + 7 * dayMs;
  const data = await anilist(
    `query($start:Int,$end:Int){Page(perPage:60){airingSchedules(airingAt_greater:$start,airingAt_lesser:$end,sort:TIME){
      airingAt episode media{id title{english romaji} coverImage{large} format averageScore isAdult}}}}`,
    { start, end }
  );
  const airings = data?.Page?.airingSchedules || [];
  return airings
    .filter((a) => new Date(a.airingAt * 1000).getDay() === Number(day))
    .map((a) => ({
      id: String(a.media.id),
      title: a.media.title?.english || a.media.title?.romaji || "Untitled",
      cover: a.media.coverImage?.large || "",
      episode: a.episode,
      airingAt: a.airingAt,
      time: new Date(a.airingAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      rating: a.media.averageScore ? a.media.averageScore / 10 : null,
      type: a.media.format,
      provider: "anilist",
      isAdult: a.media.isAdult === true,
      genres: [],
      tags: [],
    }))
    .filter(isCatalogSafe)
    .slice(0, 24);
}

module.exports = {
  searchAnime,
  getTrending,
  getLatest,
  browseAnime,
  getRandom,
  getSchedule,
  getDetails,
  getEpisodes,
  loadWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  trackProgress,
  markCompleted,
  getContinueWatching,
  isCatalogSafe,
  safeCatalog,
};
