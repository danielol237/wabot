// ── Anime download via @consumet/extensions (maintained providers) ──
// Handles the AnimePahe session/obfuscation churn that the hand-rolled
// scraper in animeDownload.js can't keep up with. Falls back across multiple
// maintained providers so a single source dying doesn't kill downloads.
const { ANIME } = require("@consumet/extensions");

// Accumulates per-provider failure reasons across a single episode-stream
// attempt so the caller can report WHY no source was found instead of a
// generic failure. Reset at the start of each top-level call.
let lastProviderErrors = [];

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
            episodes: r.totalEpisodes || r.episodes || null,
            type: r.type || "",
            score: r.rating || r.score || null,
          })),
        };
      }
    } catch (_) {}
  }
  return { source: "", results: [] };
}

// Try to fetch the stream URL for a single episode from one provider.
// Returns { url, title, provider } or null.
async function streamFromProvider(p, name, animeId, episodeNum, info) {
  // Locate the episode. If the caller already passed full episode info, use it.
  const eps = info?.episodes || [];
  let ep = eps.find((e) => Number(e.number) === Number(episodeNum));
  if (!ep) ep = eps[episodeNum - 1];
  if (!ep) return null;

  // AnimePahe: fetchEpisodeSources expects the episode id ("anime/ep-session").
  let epId = ep.id;
  if (!epId && ep.url) {
    const m = ep.url.match(/\/play\/([^/]+\/[^/]+)/);
    if (m) epId = m[1];
  }
  if (!epId) return null;

  let src;
  try {
    src = await p.fetchEpisodeSources(epId);
  } catch (e) {
    return { error: `${name} episode fetch failed: ${e?.message || e}` };
  }

  const sources = src?.sources || [];
  const url =
    sources.find((s) => s?.url?.includes(".m3u8"))?.url ||
    sources[0]?.url ||
    src?.download?.[0]?.url;
  if (url) return { provider: name, url, title: info?.title || "" };
  return { error: `${name} returned no playable source` };
}

// Get the direct stream URLs for an episode across providers.
async function consumetEpisodeStream(animeId, episodeNum, providerName) {
  const providers = providerName
    ? [providerName]
    : ["AnimePahe", "Hianime", "AnimeKai", "AnimeUnity"];

  lastProviderErrors = [];
  const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  for (const name of providers) {
    const p = newProvider(name);
    if (!p || typeof p.fetchAnimeInfo !== "function") continue;

    // fetchAnimeInfo needs the anime id/session. Try as-is first; if that
    // fails, try a fresh search to get a valid id.
    for (const tryId of [animeId, null]) {
      let info = null;
      try {
        if (tryId) {
          info = await p.fetchAnimeInfo(tryId, 1);
        } else if (typeof p.search === "function") {
          const searchTerm = String(animeId).replace(/[-_]/g, " ");
          const s = await p.search(searchTerm);
          const res = s?.results || [];
          // #35/#11: rank results by match quality instead of taking res[0]
          // (which can be a film/special) or the first loose "contains" hit.
          // Exact title > normalized-exact > plural/the > contains > contained.
          const target = norm(searchTerm);
          const score = (r) => {
            const nt = norm(r.title);
            if (!nt) return 0;
            if (nt === target) return 100;
            if (nt === target + "s" || nt === "the" + target) return 85;
            if (nt.includes(target)) return 70;
            if (target.includes(nt) && nt.length > 3) return 60;
            return 0;
          };
          const guess =
            res.map((r) => ({ r, s: score(r) }))
              .filter((x) => x.s > 0)
              .sort((a, b) => b.s - a.s)[0]?.r || null;
          if (guess?.id) info = await p.fetchAnimeInfo(guess.id, 1);
          else lastProviderErrors.push(`${name}: no title match for "${searchTerm}"`);
        }
      } catch (e) {
        lastProviderErrors.push(`${name} ${tryId ? "lookup" : "search"} failed: ${e?.message || e}`);
        continue;
      }
      const got = await streamFromProvider(p, name, tryId || animeId, episodeNum, info);
      if (got && got.url) return got;
      if (got && got.error) lastProviderErrors.push(got.error);
    }
  }
  return { error: lastProviderErrors.length ? lastProviderErrors.join("; ") : "no provider available" };
}

module.exports = { consumetSearch, consumetEpisodeStream, _resetConsumetErrors: () => { lastProviderErrors = []; } };
