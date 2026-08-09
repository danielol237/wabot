// ── Anime download via @consumet/extensions (maintained providers) ──
// Handles the AnimePahe session/obfuscation churn that the hand-rolled
// scraper in animeDownload.js can't keep up with. Falls back across multiple
// maintained providers so a single source dying doesn't kill downloads.
const { ANIME } = require("@consumet/extensions");

function newProvider(name) {
  const Cls = ANIME[name];
  if (!Cls) return null;
  try { return new Cls(); } catch (_) { return null; }
}

// Search across providers. Returns a normalized result list.
async function consumetSearch(query) {
  const providers = ["AnimePahe", "Hianime", "AnimeKai", "AnimeUnity"];
  for (const name of providers) {
    const p = newProvider(name);
    if (!p || typeof p.search !== "function") continue;
    try {
      const res = await p.search(query);
      const results = res?.results || [];
      if (results.length) {
        return {
          source: name,
          results: results.map((r) => ({
            id: r.id,
            title: r.title || "",
            image: r.image || r.poster || "",
            episodes: r.totalEpisodes || null,
            type: r.type || "",
            score: r.rating || r.score || null,
          })),
        };
      }
    } catch (_) {}
  }
  return { source: "", results: [] };
}

// Get the direct stream URLs for an episode across providers.
// Returns the first working provider's first usable URL.
async function consumetEpisodeStream(animeId, episodeNum, providerName) {
  const providers = providerName ? [providerName] : ["AnimePahe", "Hianime", "AnimeKai", "AnimeUnity"];
  for (const name of providers) {
    const p = newProvider(name);
    if (!p || typeof p.fetchAnimeInfo !== "function") continue;
    try {
      // Fetch anime info to find the episode id. AnimePahe returns a session
      // id from search; fetchAnimeInfo accepts id/session and lists episodes.
      const info = await p.fetchAnimeInfo(animeId, 1);
      const eps = info?.episodes || [];
      let ep = eps.find((e) => Number(e.number) === Number(episodeNum));
      if (!ep) ep = eps[episodeNum - 1];
      if (!ep) continue;

      const src = await p.fetchEpisodeSources(ep.id);
      // sources[] has {url, quality, isDub}. Prefer HLS/m3u8.
      const sources = src?.sources || [];
      const url = sources.find((s) => s?.url?.includes(".m3u8"))?.url
        || sources[0]?.url
        || src?.download?.[0]?.url;
      if (url) return { provider: name, url, title: info?.title || "" };
    } catch (_) {}
  }
  return null;
}

module.exports = { consumetSearch, consumetEpisodeStream };
