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

// AniList GraphQL — reliable, keyless fallback for search/trending/latest
// (Jikan/MAL is frequently rate-limited or 504s, which gutted the browser).
const ANILIST_URL = "https://graphql.anilist.co";
async function anilist(query, variables) {
  try {
    const r = await axios.post(ANILIST_URL, { query, variables }, { timeout: 12000 });
    return r.data?.data || null;
  } catch (_) { return null; }
}

function fromAnilist(page) {
  return (page?.media || []).map((a) => ({
    id: String(a.id),
    title: a.title?.english || a.title?.romaji || a.title?.native || "Untitled",
    cover: a.coverImage?.extraLarge || a.coverImage?.large || "",
    description: a.description ? a.description.replace(/<[^>]+>/g, "").slice(0, 400) : "",
    genres: a.genres || [],
    status: a.status ? a.status.replace(/_/g, " ") : "",
    year: a.seasonYear,
    rating: a.averageScore ? a.averageScore / 10 : null,
    episodes: a.episodes,
    type: a.format,
    provider: "anilist",
  }));
}

// ── Watchlist (persisted JSON) ────────────────────────────────────
function loadWatchlist() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch (_) { return []; }
}
function saveWatchlist(list) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2)); } catch (_) {}
}
function addToWatchlist(entry) {
  const list = loadWatchlist();
  if (!list.some((e) => e.id === entry.id && e.provider === entry.provider)) list.push(entry);
  saveWatchlist(list);
  return list;
}
function removeFromWatchlist(id, provider) {
  const list = loadWatchlist().filter((e) => !(e.id === id && (!provider || e.provider === provider)));
  saveWatchlist(list);
  return list;
}

// ── Search across providers ───────────────────────────────────────
// Merges results from several sources, preferring the richest metadata.
async function searchAnime(query) {
  const buckets = {
    anilist: [], jikan: [], omnisave: [], consumet: [], animepahe: [], gogoanime: [],
  };

  await Promise.all([
    (async () => {
      const data = await anilist(
        `query($q:String){Page(perPage:12){media(search:$q,type:ANIME,sort:SEARCH_MATCH){id
          title{english romaji native} coverImage{extraLarge large} description genres status
          seasonYear averageScore episodes format}}}`,
        { q: query }
      );
      buckets.anilist = fromAnilist(data?.Page);
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
  return out.slice(0, 24);
}

// ── Trending / top (Jikan) ────────────────────────────────────────
async function getTrending() {
  // AniList: top anime by popularity this season (reliable fallback).
  const data = await anilist(
    `query{Page(perPage:12){media(type:ANIME,sort:POPULARITY_DESC,status_in:[RELEASING,NOT_YET_RELEASED]){id
      title{english romaji} coverImage{extraLarge large} seasonYear averageScore episodes format status}}}`
  );
  if (data?.Page?.media?.length) return fromAnilist(data.Page);

  // Fallback to Jikan/MAL.
  try {
    const r = await axios.get("https://api.jikan.moe/v4/top/anime?filter=airing&limit=12", { timeout: 10000 });
    return (r.data.data || []).map((a) => ({
      id: String(a.mal_id),
      title: a.title,
      cover: a.images?.jpg?.image_url,
      rating: a.score,
      episodes: a.episodes,
      type: a.type,
      year: a.year,
      provider: "jikan",
    }));
  } catch (_) { return []; }
}

// Recently updated (current season, newest) via Jikan seasonal
async function getLatest() {
  // AniList: newest episodes / recently airing.
  const data = await anilist(
    `query{Page(perPage:12){media(type:ANIME,status:RELEASING,sort:UPDATED_AT_DESC){id
      title{english romaji} coverImage{extraLarge large} seasonYear averageScore episodes format status}}}`
  );
  if (data?.Page?.media?.length) return fromAnilist(data.Page);

  // Fallback to Jikan/MAL current season.
  try {
    const r = await axios.get("https://api.jikan.moe/v4/seasons/now?limit=12", { timeout: 10000 });
    return (r.data.data || []).map((a) => ({
      id: String(a.mal_id),
      title: a.title,
      cover: a.images?.jpg?.image_url,
      rating: a.score,
      episodes: a.episodes,
      type: a.type,
      year: a.year,
      status: a.airing ? "Airing" : "Completed",
      provider: "jikan",
    }));
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
        description: a.synopsis || "", genres: a.genres?.map((g) => g.name) || [],
        status: a.status, year: a.year, rating: a.score, episodes: a.episodes,
        type: a.type, duration: a.duration, studios: a.studios?.map((s) => s.name) || [],
        provider: "jikan",
      };
    } catch (_) {}
  }

  // Fall back to whatever we already know about it.
  return {
    id, title: entry.title || "Unknown", cover: entry.cover || "", description: entry.description || "",
    genres: entry.genres || [], status: entry.status || "", year: entry.year || "",
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

  // Generic fallback: list count range.
  const n = entry.episodes || 12;
  return Array.from({ length: Math.min(n, 200) }, (_, i) => ({ number: i + 1, title: `Episode ${i + 1}` }));
}

module.exports = {
  searchAnime,
  getTrending,
  getLatest,
  getDetails,
  getEpisodes,
  loadWatchlist,
  addToWatchlist,
  removeFromWatchlist,
};
