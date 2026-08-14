// Consumet-backed anime provider adapter.
// The provider ecosystem changes frequently, so this module keeps each adapter
// isolated, bounded, and replaceable. It never bypasses ARIA's URL validation.
const { ANIME } = require("@consumet/extensions");

let lastProviderErrors = [];
const PROVIDERS = ["AnimePahe", "Hianime", "AnimeKai", "KickAssAnime", "AnimeSaturn", "AnimeUnity"];
const PROVIDER_TIMEOUT_MS = Math.max(4000, Number(process.env.ANIME_CONSUMET_PROVIDER_TIMEOUT_MS || 6000));

function providerEnvKey(name) { return `ANIME_${String(name || "").replace(/[^a-z0-9]/gi, "_").toUpperCase()}_BASE_URL`; }
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
function newProvider(name) {
  const Cls = ANIME[name];
  if (!Cls) return null;
  try {
    const provider = new Cls();
    const override = String(process.env[providerEnvKey(name)] || "").trim().replace(/\/+$/, "");
    if (override) provider.baseUrl = override;
    return provider;
  } catch (_) { return null; }
}
function normalizeTitle(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function bestMatch(query, results) {
  const target = normalizeTitle(query);
  return (Array.isArray(results) ? results : [])
    .map((result, index) => {
      const title = normalizeTitle(result?.title);
      const score = title === target ? 100 : title.includes(target) ? 70 : target.includes(title) && title.length > 3 ? 60 : 0;
      return { result, score, index };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.result || null;
}

async function searchOne(name, query) {
  const provider = newProvider(name);
  if (!provider || typeof provider.search !== "function") return null;
  const response = await withTimeout(provider.search(query), PROVIDER_TIMEOUT_MS, null);
  const results = response?.results || [];
  if (!results.length) return null;
  return {
    source: name,
    results: results.map((r) => ({
      id: r.id,
      title: r.title || "",
      image: r.image || r.poster || "",
      episodes: r.totalEpisodes || r.episodes || null,
      type: r.type || "",
      score: r.rating || r.score || null,
    })),
  };
}

// Search all configured adapters concurrently and use the first non-empty
// result. A dead provider must not serialize the entire catalog search.
async function consumetSearch(query) {
  const results = await Promise.all(PROVIDERS.map((name) => searchOne(name, query)));
  return results.find((result) => result?.results?.length) || { source: "", results: [] };
}

async function streamFromProvider(provider, name, animeId, episodeNum, info) {
  const episodes = info?.episodes || [];
  let episode = episodes.find((item) => Number(item.number) === Number(episodeNum));
  if (!episode) episode = episodes[episodeNum - 1];
  if (!episode) return { error: `${name} has no episode ${episodeNum}` };

  let episodeId = episode.id;
  if (!episodeId && episode.url) {
    const match = episode.url.match(/\/play\/([^/]+\/[^/]+)/);
    if (match) episodeId = match[1];
  }
  if (!episodeId) return { error: `${name} returned no episode identifier` };

  const source = await withTimeout(provider.fetchEpisodeSources(episodeId), PROVIDER_TIMEOUT_MS, null);
  if (!source) return { error: `${name} source request timed out` };
  const sources = source.sources || [];
  const chosen = sources.find((item) => item?.url?.includes(".m3u8")) || sources.find((item) => item?.url) || source.download?.[0];
  if (chosen?.url) {
    return {
      provider: name,
      url: chosen.url,
      title: info?.title || "",
      quality: chosen.quality || "unknown",
      type: chosen.isM3U8 || /\.m3u8(?:\?|$)/i.test(chosen.url) ? "hls" : "mp4",
      headers: source.headers || {},
    };
  }
  return { error: `${name} returned no playable source` };
}

async function attemptProvider(name, animeId, episodeNum) {
  const provider = newProvider(name);
  if (!provider || typeof provider.fetchAnimeInfo !== "function") return { error: `${name} adapter unavailable` };
  const errors = [];
  const rawId = String(animeId || "");
  const looksLikeProviderId = !!rawId && !/\s/.test(rawId) && rawId.length <= 180;
  const ids = looksLikeProviderId ? [animeId, null] : [null];
  for (const tryId of ids) {
    let info = null;
    try {
      if (tryId) {
        info = await withTimeout(provider.fetchAnimeInfo(tryId, 1), PROVIDER_TIMEOUT_MS, null);
        if (!info) errors.push(`${name} lookup timed out`);
      } else if (typeof provider.search === "function") {
        const search = await withTimeout(provider.search(String(animeId).replace(/[-_]/g, " ")), PROVIDER_TIMEOUT_MS, null);
        const match = bestMatch(animeId, search?.results);
        if (!match?.id) {
          errors.push(`${name} no title match for "${animeId}"`);
          continue;
        }
        info = await withTimeout(provider.fetchAnimeInfo(match.id, 1), PROVIDER_TIMEOUT_MS, null);
        if (!info) errors.push(`${name} detail lookup timed out`);
      }
    } catch (error) {
      errors.push(`${name} ${tryId ? "lookup" : "search"} failed: ${error?.message || error}`);
      continue;
    }
    if (!info) continue;
    const got = await streamFromProvider(provider, name, tryId || animeId, episodeNum, info);
    if (got?.url) return got;
    if (got?.error) errors.push(got.error);
  }
  return { error: errors.join("; ") || `${name} returned no source` };
}

// Try all adapters concurrently. This is intentionally bounded: dead or
// Cloudflare-blocked providers cannot consume the resolver’s whole deadline.
async function consumetEpisodeStream(animeId, episodeNum, providerName) {
  const providers = providerName ? [providerName, ...PROVIDERS.filter((name) => name !== providerName)] : PROVIDERS;
  lastProviderErrors = [];
  const results = await Promise.all(providers.map((name) => withTimeout(attemptProvider(name, animeId, episodeNum), PROVIDER_TIMEOUT_MS * 2, { error: `${name} provider timeout` })));
  const success = results.find((result) => result?.url);
  if (success) return success;
  for (const result of results) if (result?.error) lastProviderErrors.push(result.error);
  return { error: lastProviderErrors.join("; ") || "no provider available" };
}

module.exports = {
  consumetSearch,
  consumetEpisodeStream,
  _resetConsumetErrors: () => { lastProviderErrors = []; },
  _providers: PROVIDERS,
};
