// ── Source Health Monitor ─────────────────────────────────────────
// Probes each anime source with a cheap request and records health so the
// dashboard (and the pipeline) can tell whether a provider is dead before
// wasting time trying it. Surfaces ok/status/latency/error per source.

const axios = require("axios");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Each probe returns { name, ok, status, latency, error, checkedAt }.
async function probeOmniSave() {
  const t = Date.now();
  try {
    const res = await axios.post(
      "https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/search-suggest",
      {},
      { timeout: 8000, headers: { "Content-Type": "application/json" } }
    );
    const hasToken = !!res.headers["x-user"];
    return { name: "OmniSave", ok: hasToken, status: res.status, latency: Date.now() - t, error: hasToken ? "" : "no x-user token" };
  } catch (e) {
    return { name: "OmniSave", ok: false, status: e.response?.status, latency: Date.now() - t, error: e.message };
  }
}

async function probeGogo() {
  const t = Date.now();
  const { HOSTS } = require("./animeGogo");
  for (const host of HOSTS) {
    try {
      const res = await axios.get(host + "/", { timeout: 8000, headers: { "User-Agent": UA } });
      return { name: "Gogoanime", ok: true, status: res.status, latency: Date.now() - t, error: "" };
    } catch (_) {}
  }
  return { name: "Gogoanime", ok: false, status: null, latency: Date.now() - t, error: "all mirrors unreachable" };
}

async function probeConsumet() {
  const t = Date.now();
  const hosts = ["https://hianime.to/", "https://animepahe.ru/", "https://animekai.to/", "https://animeunity.so/"];
  for (const host of hosts) {
    try {
      const res = await axios.get(host, { timeout: 8000, headers: { "User-Agent": UA } });
      return { name: "Consumet", ok: true, status: res.status, latency: Date.now() - t, error: "" };
    } catch (_) {}
  }
  return { name: "Consumet", ok: false, status: null, latency: Date.now() - t, error: "all consumet hosts unreachable" };
}

async function probeAnimePahe() {
  const t = Date.now();
  try {
    const res = await axios.get("https://animepahetv.to/", { timeout: 8000, headers: { "User-Agent": UA } });
    return { name: "AnimePahe", ok: true, status: res.status, latency: Date.now() - t, error: "" };
  } catch (e) {
    return { name: "AnimePahe", ok: false, status: e.response?.status, latency: Date.now() - t, error: e.message };
  }
}

async function probeAniList() {
  const t = Date.now();
  try {
    const res = await axios.post(
      "https://graphql.anilist.co",
      { query: "{ Page(perPage: 1) { media(type: ANIME) { id } } }" },
      { timeout: 8000 }
    );
    const ok = !!res.data?.data?.Page?.media;
    return { name: "AniList", ok, status: res.status, latency: Date.now() - t, error: ok ? "" : "empty response" };
  } catch (e) {
    return { name: "AniList", ok: false, status: e.response?.status, latency: Date.now() - t, error: e.message };
  }
}

async function probeJikan() {
  const t = Date.now();
  try {
    const res = await axios.get("https://api.jikan.moe/v4/anime/21", { timeout: 8000 });
    return { name: "Jikan/MAL", ok: true, status: res.status, latency: Date.now() - t, error: "" };
  } catch (e) {
    return { name: "Jikan/MAL", ok: false, status: e.response?.status, latency: Date.now() - t, error: e.message };
  }
}

const PROBES = [probeOmniSave, probeGogo, probeConsumet, probeAnimePahe, probeAniList, probeJikan];

// Run all probes in parallel and store results.
const state = { results: [], lastCheckedAt: null, checking: false };

async function checkAll() {
  if (state.checking) return state.results;
  state.checking = true;
  try {
    const results = await Promise.all(PROBES.map((p) => p().catch((e) => ({ name: "?", ok: false, error: e.message }))));
    state.results = results;
    state.lastCheckedAt = Date.now();
    return results;
  } finally {
    state.checking = false;
  }
}

function getHealth() {
  return { ...state, results: state.results };
}

module.exports = { checkAll, getHealth };
