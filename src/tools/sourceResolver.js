// ── Anime Source Resolution Engine ───────────────────────────────
// Provider-agnostic anime episode resolution. The architectural fix:
// ARIA searches for a PLAYABLE EPISODE, not a provider.
//
// Pipeline:
//   Request { title, episode }
//     → Canonical Resolver (AniList: canonical id/title/season, metadata
//       confidence — title match %, season match %, episode exists)
//     → Source Discovery (run INDEPENDENT provider resolvers CONCURRENTLY,
//       each producing normalized stream candidates)
//     → Stream Validator (HTTP range + yt-dlp + ffprobe ladder)
//     → first HEALTHY playable candidate wins (not first search result)
//     → Provider reputation + circuit breakers gate which providers run
//
// The downloader consumes the winning candidate. It never treats a
// metadata search result as proof an episode is downloadable.

const { validateCandidate } = require("./streamValidator");
const rep = require("./sourceReputation");

// ── Canonical Resolver ─────────────────────────────────────────
// Resolve a human request into a canonical anime identity + confidence.
// AniList is the canonical identity source (stable IDs, seasons, episodes).
const ANILIST_URL = "https://graphql.anilist.co";
const axios = require("axios");

function normalize(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

async function anilistSearch(title) {
  try {
    const r = await axios.post(ANILIST_URL, {
      query: `query($q:String){Page(perPage:8){media(search:$q,type:ANIME,sort:SEARCH_MATCH){id
        title{english romaji native} episodes format seasonYear status nextAiringEpisode{episode}}}}}`,
      variables: { q: title },
    }, { timeout: 12000 });
    return r.data?.data?.Page?.media || [];
  } catch (_) { return []; }
}

// Resolve title+episode → canonical identity. Returns
// { ok, canonical, confidence } where confidence = { title, season, episodeExists }.
async function resolveCanonical(title, episode) {
  const target = normalize(title);
  const results = await anilistSearch(title);
  if (!results.length) return { ok: false, reason: "no canonical match on AniList" };

  // Score each result by title-match, prefer the best.
  const scored = results.map((a) => {
    const en = normalize(a.title?.english), ro = normalize(a.title?.romaji), na = normalize(a.title?.native);
    let score = 0;
    if (en && (en === target || en.includes(target) || target.includes(en))) score = Math.max(score, en === target ? 1 : 0.85);
    if (ro && (ro === target || ro.includes(target) || target.includes(ro))) score = Math.max(score, ro === target ? 1 : 0.8);
    if (na && (na === target || na.includes(target))) score = Math.max(score, 0.7);
    return { anime: a, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.5) return { ok: false, reason: "no confident title match" };
  const anime = best.anime;
  const epCount = anime.episodes || null;
  const episodeExists = epCount ? episode <= epCount : true; // null = ongoing/unknown
  return {
    ok: true,
    canonical: {
      id: String(anime.id),
      title: anime.title?.english || anime.title?.romaji || anime.title?.native || title,
      seasonYear: anime.seasonYear,
      format: anime.format,
      totalEpisodes: epCount,
      status: anime.status,
    },
    confidence: {
      title: Math.round(best.score * 100),
      season: anime.seasonYear ? 100 : null,
      episodeExists,
    },
    candidates: results.map((a) => ({ id: String(a.id), title: a.title?.english || a.title?.romaji || "", titleRomaji: a.title?.romaji || "" })),
  };
}

// ── Source Discovery ───────────────────────────────────────────
// Independent provider resolvers, each returning normalized candidates.
// Every candidate: { provider, url, type: 'hls'|'mp4', quality, headers, title }.
const DISCOVERERS = [
  {
    provider: "omnisave",
    // Circuit breaker: skip when open.
    enabled: () => rep.usable("omnisave"),
    async discover(title, episode) {
      const { searchOmniSave, searchOmniSaveById, getOmniSaveDownload } = require("./animeDownload");
      const list = await searchOmniSave(title);
      if (!list.length) return { candidates: [], noResults: true };
      const anime = list[0];
      let detailPath = anime.detailPath;
      if (!detailPath) { const d = await searchOmniSaveById(anime.subjectId); detailPath = d?.detailPath || ""; }
      if (!detailPath) return { candidates: [], error: "no detailPath" };
      const dl = await getOmniSaveDownload(anime.subjectId, detailPath, 1, episode || 1);
      const url = dl?.downloads?.find((d) => d?.url)?.url || dl?.downloads?.[0]?.url;
      if (!url) return { candidates: [], error: "no usable URL (VIP-locked?)" };
      return { candidates: [{ provider: "omnisave", url, type: /m3u8/i.test(url) ? "hls" : "mp4", quality: "unknown", headers: { "User-Agent": "Mozilla/5.0" }, title: anime.title }] };
    },
  },
  {
    provider: "gogoanime",
    enabled: () => rep.usable("gogoanime"),
    async discover(title, episode) {
      const { searchGogo, gogoAnimeStream, HOSTS } = require("./animeGogo");
      const list = await searchGogo(title);
      if (!list.length) return { candidates: [], noResults: true };
      const anime = list[0];
      const slug = String(anime.id || "").replace(/^category\//, "").replace(/\/$/, "");
      const gogo = await gogoAnimeStream(slug, episode);
      if (!gogo.m3u8) return { candidates: [], error: gogo.error || "no m3u8" };
      const referer = (Array.isArray(HOSTS) && HOSTS[0]) || "https://gogoanime3.net/";
      return { candidates: [{ provider: "gogoanime", url: gogo.m3u8, type: "hls", quality: "unknown", headers: { "User-Agent": "Mozilla/5.0", Referer: referer, Origin: referer.replace(/\/$/, "") }, title: gogo.title || anime.title }] };
    },
  },
  {
    provider: "consumet",
    enabled: () => rep.usable("consumet"),
    async discover(title, episode) {
      const { consumetSearch, consumetEpisodeStream } = require("./animeConsumet");
      const s = await consumetSearch(title);
      const anime = s.results?.[0];
      if (!anime?.id) return { candidates: [], noResults: true };
      const got = await consumetEpisodeStream(anime.id, episode, null);
      if (!got?.url) return { candidates: [], error: got?.error || "no stream" };
      return { candidates: [{ provider: "consumet", url: got.url, type: /m3u8/i.test(got.url) ? "hls" : "mp4", quality: "unknown", headers: { "User-Agent": "Mozilla/5.0" }, title: anime.title }] };
    },
  },
];

// Discover candidates from all enabled providers CONCURRENTLY (resolver race).
async function discoverCandidates(title, episode) {
  const results = await Promise.all(
    DISCOVERERS.filter((d) => !d.enabled || d.enabled())
      .map(async (d) => {
        const start = Date.now();
        try {
          const out = await d.discover(title, episode);
          // Record provider outcome for reputation.
          if (out.noResults) rep.record(d.provider, "no-results", false, {});
          else if (out.error) rep.record(d.provider, "resolve", false, { error: out.error });
          else if (out.candidates.length) rep.record(d.provider, "resolve", true, {});
          return { provider: d.provider, ...out, latencyMs: Date.now() - start };
        } catch (e) {
          rep.record(d.provider, "resolve", false, { error: e.message });
          return { provider: d.provider, candidates: [], error: e.message, latencyMs: Date.now() - start };
        }
      })
  );
  // Flatten to a candidate list tagged with which provider found it.
  const candidates = [];
  const diagnostics = [];
  for (const r of results) {
    diagnostics.push({ provider: r.provider, latencyMs: r.latencyMs, error: r.error || null, noResults: !!r.noResults, candidateCount: r.candidates?.length || 0 });
    for (const c of r.candidates || []) candidates.push(c);
  }
  return { candidates, diagnostics };
}

// ── Quality Router ─────────────────────────────────────────────
// Score candidates: prefer validated, higher quality, healthier provider.
// Uses ffprobe-reported height/codec when available (not just the claimed
// quality label) so a 720p stream with real dimensions scores properly.
// `preferredQuality` (e.g. "480") rewards candidates matching the requested
// quality instead of always picking the highest-res validated stream.
function qualityRank(candidates, validations, preference, preferredQuality) {
  const scored = candidates.map((c) => {
    const v = validations[c.url] || {};
    let s = 0;
    if (v.ok) s += 100;               // validated & playable
    // Real ffprobe height beats the claimed label when we have it.
    const realHeight = v.height || 0;
    const claimed = c.quality === "1080" ? 1080 : c.quality === "720" ? 720 : c.quality === "480" ? 480 : c.quality === "360" ? 360 : 0;
    const height = realHeight || claimed;
    s += Math.min(50, height / 24);    // quality (up to ~45 for 1080)
    // Prefer real video codecs (h264/h265) over edge or unknown codecs.
    const codec = String(v.codec || "").toLowerCase();
    if (codec === "h264" || codec === "h265" || codec === "hevc") s += 8;
    else if (codec && codec !== "none") s += 3;
    const prov = rep.status(c.provider);
    s += prov.score * 0.3;             // provider reputation
    if (preference && c.provider === preference) s += 30; // user preference
    // If a specific quality was requested, reward the closest match so we don't
    // blindly pick 1080p when the user asked for 480p.
    const pq = parseInt(preferredQuality, 10);
    if (Number.isFinite(pq) && pq > 0) {
      s += Math.max(0, 25 - Math.abs(height - pq) / 40); // 25 for exact match, less for off
    }
    if (c.type === "mp4") s += 5;      // direct file slightly preferred over hls
    return { candidate: c, validation: v, score: s, height, codec: v.codec || null, duration: v.duration || null };
  }).sort((a, b) => b.score - a.score);
  return scored;
}

// ── Main entry ─────────────────────────────────────────────────
// Resolve an episode to a validated, playable source.
async function resolveEpisode(title, episode, { preference, quality } = {}) {
  const report = { title, episode, canonical: null, confidence: null, candidates: [], diagnostics: [], selected: null, error: null };

  // 1. Canonical identity.
  const canon = await resolveCanonical(title, episode);
  report.canonical = canon.canonical || null;
  report.confidence = canon.confidence || null;
  if (!canon.ok) {
    report.error = "canonical: " + canon.reason;
    return report;
  }
  // Canonical episode validation: if metadata says the episode doesn't exist,
  // do NOT proceed to source discovery — fail fast with a clear reason.
  if (canon.confidence?.episodeExists === false) {
    report.error = `episode ${episode} not in canonical episode list (${canon.canonical?.totalEpisodes ?? "?"} total)`;
    return report;
  }

  // 2. Concurrent source discovery.
  const disc = await discoverCandidates(title, episode);
  report.diagnostics = disc.diagnostics;
  report.candidates = disc.candidates;
  if (!disc.candidates.length) {
    report.error = "no provider produced a stream candidate";
    return report;
  }

  // 3. Validate all candidates concurrently (resolver race: first valid wins,
  //    but we validate all to rank by quality).
  const validationEntries = await Promise.all(
    disc.candidates.map(async (c) => {
      const v = await validateCandidate(c);
      rep.record(c.provider, "validate", v.ok, { error: v.reason });
      return [c.url, v];
    })
  );
  const validations = Object.fromEntries(validationEntries);
  report.validation = Object.fromEntries(validationEntries.map(([u, v]) => [u, { ok: v.ok, reason: v.reason, steps: v.steps }]));

  // 4. Quality-route to the best validated candidate.
  const ranked = qualityRank(disc.candidates, validations, preference, quality);
  const selected = ranked.find((r) => r.validation.ok) || ranked[0];
  if (!selected.validation.ok) {
    report.error = "no candidate passed stream validation";
    report.reason = selected.validation.reason;
    return report;
  }

  report.selected = {
    provider: selected.candidate.provider,
    url: selected.candidate.url,
    type: selected.candidate.type,
    quality: selected.candidate.quality,
    headers: selected.candidate.headers,
    title: selected.candidate.title || title,
    height: selected.height,
    codec: selected.codec,
    duration: selected.duration,
    score: Math.round(selected.score),
  };
  // Expose ALL validated candidates in ranked order so the downloader can retry
  // the next-best candidate if the top one fails mid-download (instead of giving up).
  report.ranked = ranked
    .filter((r) => r.validation.ok)
    .map((r) => ({
      provider: r.candidate.provider,
      url: r.candidate.url,
      type: r.candidate.type,
      quality: r.candidate.quality,
      headers: r.candidate.headers,
      title: r.candidate.title || title,
      height: r.height,
      codec: r.codec,
      duration: r.duration,
      score: Math.round(r.score),
    }));
  rep.record(selected.candidate.provider, "download", true, {});
  return report;
}

// Provider reputation snapshot for the dashboard.
function reputationReport() {
  return rep.all();
}

module.exports = { resolveEpisode, resolveCanonical, discoverCandidates, reputationReport, DISCOVERERS };
