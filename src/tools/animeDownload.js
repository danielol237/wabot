const axios = require("axios");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const TEMP_DIR = path.join(__dirname, "../../temp");

// ── Jikan API (MyAnimeList) for search & metadata ───────────────

async function searchAnime(query, page = 1) {
  try {
    const res = await axios.get(
      `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&page=${page}&limit=10&sfw`,
      { timeout: 10000 }
    );
    const data = res.data.data || [];
    return data.map((a) => ({
      id: a.mal_id,
      title: a.title,
      titleEnglish: a.title_english,
      episodes: a.episodes,
      status: a.status,
      score: a.score,
      image: a.images?.jpg?.image_url,
      synopsis: a.synopsis ? a.synopsis.slice(0, 300) + "..." : "No synopsis",
      type: a.type,
      year: a.year,
      url: a.url,
    }));
  } catch (err) {
    console.error("Jikan search error:", err.message);
    return [];
  }
}

// AnimePahe search — a reliable fallback that works even when Jikan (MAL) is down.
// Scrapes animepahetv.to/search?q= and returns anime cards.
async function searchAnimePahe(query) {
  try {
    const res = await axios.get(`https://animepahetv.to/search?q=${encodeURIComponent(query)}`, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = res.data || "";
    // Each result is an anime link with an MD5 id and a title/poster nearby.
    const ids = [...new Set((html.match(/\/anime\/([a-f0-9]{32})/g) || []).map((u) => u.split("/").pop()))];
    if (!ids.length) return [];

    // Extract title + poster for each unique anime id.
    const results = [];
    for (const id of ids) {
      const idx = html.indexOf(`/anime/${id}`);
      const context = html.slice(idx, idx + 3000);
      // AnimePahe stores the title in the poster's alt attribute (and sometimes
      // title=). Prefer the alt text since that's where the real title lives.
      const altM = context.match(/alt="([^"]{2,120})"/);
      const titleM = context.match(/title="([^"]{2,120})"/);
      const rawTitle = (altM && altM[1]) || (titleM && titleM[1]) || "";
      const title = (rawTitle || "Unknown").replace(/&amp;/g, "&").replace(/&#039;/g, "'");
      const posterM = context.match(/src="([^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/);
      const poster = posterM ? posterM[1] : "";
      const epM = context.match(/(\d+)\s*Ep/);
      results.push({
        id,
        title,
        titleEnglish: title,
        episodes: epM ? parseInt(epM[1]) : null,
        type: "TV",
        score: null,
        image: poster,
        synopsis: "",
        source: "animepahe",
      });
    }
    return results.slice(0, 8);
  } catch (err) {
    console.error("AnimePahe search error:", err.message);
    return [];
  }
}

async function getAnimeDetails(malId) {
  try {
    const res = await axios.get(
      `https://api.jikan.moe/v4/anime/${malId}/full`,
      { timeout: 10000 }
    );
    const a = res.data.data;
    return {
      id: a.mal_id,
      title: a.title,
      titleEnglish: a.title_english,
      episodes: a.episodes,
      status: a.status,
      score: a.score,
      synopsis: a.synopsis,
      image: a.images?.jpg?.image_url,
      genres: a.genres?.map((g) => g.name) || [],
      type: a.type,
      source: a.source,
      season: a.season,
      year: a.year,
      studios: a.studios?.map((s) => s.name) || [],
      duration: a.duration,
      rating: a.rating,
      url: a.url,
    };
  } catch (err) {
    console.error("Jikan detail error:", err.message);
    return null;
  }
}

async function getAnimeEpisodes(malId, page = 1) {
  try {
    const res = await axios.get(
      `https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`,
      { timeout: 10000 }
    );
    return (res.data.data || []).map((ep) => ({
      id: ep.mal_id,
      episode: ep.mal_id,
      title: ep.title,
      titleJapanese: ep.title_japanese,
      aired: ep.aired,
      filler: ep.filler,
      recap: ep.recap,
    }));
  } catch (err) {
    console.error("Jikan episodes error:", err.message);
    return [];
  }
}

// ── OmniSave (videodownloader.site) — direct MP4 downloads ──────

let omniscrapeToken = null;

async function getOmniscrapeToken() {
  if (omniscrapeToken) return omniscrapeToken;
  try {
    const res = await axios.post(
      "https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/search-suggest",
      {},
      { headers: { "Content-Type": "application/json" } }
    );
    const header = res.headers["x-user"];
    if (header) {
      const parsed = JSON.parse(header);
      omniscrapeToken = parsed.token;
      return parsed.token;
    }
    return null;
  } catch (err) {
    console.error("OmniSave token error:", err.message);
    return null;
  }
}

async function searchOmniSave(query) {
  const token = await getOmniscrapeToken();
  if (!token) return [];

  try {
    const H = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-request-lang": "en",
      "X-Site-Domain": "videodownloader.site",
      Referer: "https://videodownloader.site/",
      Origin: "https://videodownloader.site/",
    };
    // subjectType 3 = movies (returns nothing for anime). 2 = TV/anime, 0 = all.
    for (const subjectType of [2, 0]) {
      const res = await axios.post(
        "https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/search",
        { keyword: query, page: 1, perPage: 10, subjectType },
        { headers: H, timeout: 15000 }
      );
      const payload = res.data?.data || {};
      const items = payload.items || payload.list || payload.records || [];
      if (!items.length) continue;
      return items.map((item) => ({
        subjectId: item.subjectId,
        title: item.title || item.name || "",
        year: item.releaseDate,
        rating: item.imdbRatingValue,
        image: item.cover?.url,
        detailPath: item.detailPath,
        hasResource: item.hasResource,
        subjectType,
        source: "omnisave",
      }));
    }
    return [];
  } catch (err) {
    console.error("OmniSave search error:", err.message);
    return [];
  }
}

async function getOmniSaveDownload(subjectId, detailPath, season = 0, episode = 0) {
  const token = await getOmniscrapeToken();
  if (!token) return null;

  try {
    const res = await axios.get(
      `https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/download?subjectId=${subjectId}&detailPath=${encodeURIComponent(detailPath)}&se=${season}&ep=${episode}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-request-lang": "en",
          "X-Site-Domain": "videodownloader.site",
          Referer: "https://videodownloader.site/",
          Origin: "https://videodownloader.site/",
        },
        timeout: 15000,
      }
    );

    return {
      downloads: res.data?.data?.downloads || [],
      captions: res.data?.data?.captions || [],
    };
  } catch (err) {
    console.error("OmniSave download error:", err.message);
    return null;
  }
}

// ── Download via yt-dlp ─────────────────────────────────────────

async function downloadVideo(url) {
  const id = uuidv4();
  const outputPath = path.join(TEMP_DIR, `${id}.%(ext)s`);

  return new Promise((resolve) => {
    const args = [
      "-f", "best[filesize<500M]/best",
      "--max-filesize", "500M",
      "-o", outputPath,
      url,
    ];

    execFile("yt-dlp", args, { timeout: 300000 }, (err, stdout, stderr) => {
      if (err) {
        console.error("Download stderr:", stderr?.slice(0, 500));

        // yt-dlp sometimes writes the file even when it exits non-zero
        const files = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(id));
        if (files.length > 0) {
          const fp = path.join(TEMP_DIR, files[0]);
          const stats = fs.statSync(fp);
          if (stats.size > 1024 * 100) {
            // >100KB means something usable was downloaded
            return resolve({ success: true, filePath: fp, size: stats.size });
          }
          try { fs.unlinkSync(fp); } catch (_) {}
        }
        return resolve({ success: false, error: "Download failed." });
      }

      const files = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(id));
      if (files.length === 0) {
        return resolve({ success: false, error: "File not found after download." });
      }

      const fp = path.join(TEMP_DIR, files[0]);
      const stats = fs.statSync(fp);
      resolve({ success: true, filePath: fp, size: stats.size });
    });
  });
}

// ── High-level: search + download orchestration ─────────────────

async function search(query) {
  const [jikan, omniscrape] = await Promise.all([
    searchAnime(query),
    searchOmniSave(query).catch(() => []),
  ]);
  return { jikan, omniscrape };
}

// ── AnimePahe episode stream resolution ──────────────────────────
// AnimePahe serves episodes behind a session + server-embed flow:
//   /anime/{id}            -> find session id
//   /play/{id}/{session}   -> find the target episode's md5_id
//   /anime/get-servers/{md5} -> list server embed URLs
//   embed URL              -> find data-id
//   {base}stream/getSources?id= -> get m3u8 HLS URL
// Then yt-dlp downloads the m3u8.
const PAHE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function animepaheGetEpisodeMd5(animeId, episodeNum) {
  const page = await axios.get(`https://animepahetv.to/anime/${animeId}`, {
    timeout: 15000, headers: { "User-Agent": PAHE_UA, Accept: "text/html" },
  }).then((r) => r.data);
  // Find session id from a /play/{animeId}/{session} link
  const sessionM = page.match(new RegExp(`/play/${animeId}/([a-f0-9]{32})`));
  const session = sessionM ? sessionM[1] : "";
  if (!session) return { error: "no session" };

  const play = await axios.get(`https://animepahetv.to/play/${animeId}/${session}`, {
    timeout: 15000, headers: { "User-Agent": PAHE_UA, Accept: "text/html" },
  }).then((r) => r.data);

  // Parse allEpisodes JSON
  const epStart = play.indexOf("allEpisodes:");
  if (epStart < 0) return { error: "no episodes" };
  const start = epStart + "allEpisodes:".length;
  let depth = 0, end = start;
  for (let i = start; i < play.length; i++) {
    if (play[i] === "[") depth++;
    else if (play[i] === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  let episodes = [];
  try { episodes = JSON.parse(play.slice(start, end)); } catch (_) {}
  if (!Array.isArray(episodes)) return { error: "no episode list" };

  const target = episodes.find((e) => Number(e.chapter_number) === Number(episodeNum)) || episodes[episodeNum - 1];
  if (!target || !target.md5_id) return { error: `no md5 for ep ${episodeNum}` };
  return { md5: target.md5_id, title: target.title || "" };
}

async function animepaheGetStreamUrl(animeId, episodeNum) {
  const md5Res = await animepaheGetEpisodeMd5(animeId, episodeNum);
  if (md5Res.error) return { error: md5Res.error };

  const servers = await axios.get(`https://animepahetv.to/anime/get-servers/${md5Res.md5}`, {
    timeout: 15000, headers: { "User-Agent": PAHE_UA, "X-Requested-With": "XMLHttpRequest" },
  }).then((r) => r.data).catch(() => null);
  if (!servers || servers.status !== "success" || !servers.servers?.length) {
    return { error: "no servers for episode" };
  }

  // Pick the best-quality server
  const server = servers.servers.sort((a, b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0))[0];
  const embedUrl = server.url;
  if (!embedUrl) return { error: "no embed url" };

  const embedHtml = await axios.get(embedUrl, {
    timeout: 10000, headers: { "User-Agent": PAHE_UA },
  }).then((r) => r.data).catch(() => "");
  const dataIdM = embedHtml.match(/data-id="(\d+)"/);
  if (!dataIdM) return { error: "no data-id in embed" };
  const dataId = dataIdM[1];

  const embedBase = embedUrl.split("/").slice(0, 3).join("/") + "/";
  const bases = ["https://vidwish.live/", embedBase];
  for (const base of bases) {
    try {
      const src = await axios.get(`${base}stream/getSources?id=${dataId}`, {
        timeout: 10000, headers: { "User-Agent": "Mozilla/5.0", Referer: `${base}stream/s-2/${dataId}/sub` },
      });
      const m3u8 = src.data?.sources?.file || src.data?.sources?.[0]?.file;
      if (m3u8) return { m3u8, title: md5Res.title };
    } catch (_) {}
  }
  return { error: "couldn't resolve m3u8" };
}

// Attempt a download from a resolved stream URL via yt-dlp.
async function tryDownloadUrl(url) {
  try {
    const dl = await downloadVideo(url);
    if (dl.success) return dl;
    return null;
  } catch (_) { return null; }
}

// Download a single anime episode to a video file. Tries every available
// source in order so a dead/moved site doesn't kill the whole download:
//   1. AnimePahe (if id is a 32-hex MD5 from an AnimePahe search)
//   2. Gogoanime/Anitaku (resolves a raw m3u8)
//   3. OmniSave (direct MP4)
// Returns { success, filePath, size } or { success:false, error }.
async function downloadAnimeEpisode(subjectId, episode, detailPath = "", title = "") {
  const errors = [];

  // 0. OmniSave fast path — when the search already gave us a detailPath
  //    (numeric subjectId + detailPath), this is self-contained and reliable.
  //    On success we return; on failure we fall through to the other sources.
  if (detailPath) {
    try {
      const dl = await getOmniSaveDownload(subjectId, detailPath, 1, episode || 1);
      const direct = dl?.downloads?.find((d) => d?.url)?.url || dl?.downloads?.[0]?.url;
      if (direct) {
        const got = await tryDownloadUrl(direct);
        if (got) return got;
      }
      errors.push("OmniSave: no download URL");
    } catch (e) { errors.push("OmniSave: " + e.message); }
  }

  // 1. Consumet (maintained providers) — reliable when we have a provider id.
  try {
    const { consumetEpisodeStream } = require("./animeConsumet");
    const got = await consumetEpisodeStream(subjectId, episode);
    if (got && got.url) {
      const dl = await tryDownloadUrl(got.url);
      if (dl) return dl;
    }
    errors.push(got ? `${got.provider}: download failed` : "Consumet: no source");
  } catch (e) { errors.push("Consumet: " + e.message); }

  // 2. AnimePahe (works only for ids found via AnimePahe search).
  if (/^[a-f0-9]{32}$/i.test(String(subjectId))) {
    try {
      const pahe = await animepaheGetStreamUrl(subjectId, episode);
      if (pahe.m3u8) {
        const dl = await tryDownloadUrl(pahe.m3u8);
        if (dl) return dl;
      }
      errors.push(pahe.error || "AnimePahe resolve failed");
    } catch (e) { errors.push("AnimePahe: " + e.message); }
  }

  // 2. Gogoanime/Anitaku — the id from an AnimePahe search is useless here,
  //    so attempt it when we have a gogo-style slug OR a Jikan numeric id
  //    (in which case we search Gogo by title to get a slug).
  const gogoOk = !/^[a-f0-9]{32}$/i.test(String(subjectId));
  if (gogoOk) {
    try {
      const { gogoAnimeStream, searchGogo } = require("./animeGogo");
      let gogoId = String(subjectId);
      // For a numeric/Jikan MAL id (or anything that's not a slug), look it
      // up on Gogoanime by title so we get a working slug.
      if (/^\d+$/.test(gogoId)) {
        const g = await searchGogo(title || "");
        gogoId = g[0]?.id || "";
      }
      if (!gogoId) throw new Error("no gogo slug");
      const gogo = await gogoAnimeStream(gogoId.replace(/^category\//, ""), episode);
      if (gogo.m3u8) {
        const dl = await tryDownloadUrl(gogo.m3u8);
        if (dl) return dl;
      }
      errors.push(gogo.error || "Gogoanime resolve failed");
    } catch (e) { errors.push("Gogoanime: " + e.message); }
  }

  // 3. OmniSave direct download. Season is 1-indexed (se=1 = season 1).
  try {
    let omni = null;
    if (detailPath) {
      omni = { detailPath };
    } else {
      omni = await searchOmniSaveById(subjectId);
    }
    if (omni && omni.detailPath) {
      const dl = await getOmniSaveDownload(subjectId, omni.detailPath, 1, episode || 1);
      const direct = dl?.downloads?.find((d) => d?.url)?.url || dl?.downloads?.[0]?.url;
      if (direct) {
        const got = await tryDownloadUrl(direct);
        if (got) return got;
      }
    }
    errors.push("OmniSave: no download URL");
  } catch (e) { errors.push("OmniSave: " + e.message); }

  return { success: false, error: errors.join(" | ") || "Couldn't resolve a download URL for that episode." };
}

// Look up a single subject by id from OmniSave so we can get its detailPath.
async function searchOmniSaveById(subjectId) {
  const token = await getOmniscrapeToken();
  if (!token) return null;
  try {
    const res = await axios.post(
      "https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/detail",
      { subjectId },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-request-lang": "en",
          "X-Site-Domain": "videodownloader.site",
          Referer: "https://videodownloader.site/",
          Origin: "https://videodownloader.site/",
        },
        timeout: 15000,
      }
    );
    return res.data?.data || null;
  } catch (err) {
    console.error("OmniSave detail error:", err.message);
    return null;
  }
}

module.exports = {
  searchAnime,
  searchAnimePahe,
  getAnimeDetails,
  getAnimeEpisodes,
  searchOmniSave,
  getOmniSaveDownload,
  downloadVideo,
  downloadAnimeEpisode,
  searchOmniSaveById,
  search,
};
