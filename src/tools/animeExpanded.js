// ── Expanded Anime System ──────────────────────────────────
// Adds !trending, !airing, !anime random, !character, !schedule

const axios = require("axios");

// Get trending anime
async function getTrending() {
  try {
    const r = await axios.get("https://api.jikan.moe/v4/top/anime?filter=airing&limit=10", { timeout: 10000 });
    return r.data.data.map(a => ({
      title: a.title,
      score: a.score || "N/A",
      episodes: a.episodes || "?",
      type: a.type,
      url: a.url,
    }));
  } catch (e) { return []; }
}

// Get currently airing
async function getAiring() {
  try {
    const r = await axios.get("https://api.jikan.moe/v4/seasons/now?limit=10", { timeout: 10000 });
    return r.data.data.map(a => ({
      title: a.title,
      score: a.score || "N/A",
      episodes: a.episodes || "?",
      airing: a.airing,
    }));
  } catch (e) { return []; }
}

// Get random anime
async function getRandom() {
  try {
    const r = await axios.get("https://api.jikan.moe/v4/random/anime", { timeout: 10000 });
    const a = r.data.data;
    return {
      title: a.title,
      synopsis: a.synopsis?.slice(0, 300) || "",
      score: a.score,
      episodes: a.episodes,
      type: a.type,
      status: a.status,
      image: a.images?.jpg?.image_url,
    };
  } catch (e) { return null; }
}

// Search character
async function searchCharacter(name) {
  try {
    const r = await axios.get(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(name)}&limit=5`, { timeout: 10000 });
    return r.data.data.map(c => ({
      name: c.name,
      nameJapanese: c.name_kanji || "",
      anime: c.anime?.slice(0, 3).map(a => a.anime?.title) || [],
      image: c.images?.jpg?.image_url,
      url: c.url,
    }));
  } catch (e) { return []; }
}

// Get anime schedule for a day
async function getSchedule(day) {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  if (!days.includes(day)) return [];
  try {
    const r = await axios.get(`https://api.jikan.moe/v4/schedules?filter=${day}&limit=10`, { timeout: 10000 });
    return r.data.data.map(a => ({
      title: a.title,
      time: a.broadcast?.time || "Unknown",
      score: a.score || "N/A",
    }));
  } catch (e) { return []; }
}

module.exports = { getTrending, getAiring, getRandom, searchCharacter, getSchedule };
