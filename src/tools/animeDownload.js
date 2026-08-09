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
      const titleM = context.match(/title="([^"]{2,120})"/);
      const title = titleM ? titleM[1].replace(/&amp;/g, "&") : "Unknown";
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
    const res = await axios.post(
      "https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/search",
      { keyword: query, page: 1, perPage: 10, subjectType: 3 },
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

    const items = res.data?.data?.list || [];
    return items.map((item) => ({
      subjectId: item.subjectId,
      title: item.title,
      year: item.releaseDate,
      rating: item.imdbRatingValue,
      image: item.cover?.url,
      detailPath: item.detailPath,
      hasResource: item.hasResource,
    }));
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

// Download a single anime episode to a video file.
// Uses OmniSave to resolve the direct stream URL, then yt-dlp to fetch it.
// Returns { success, filePath, size } or { success:false, error }.
async function downloadAnimeEpisode(subjectId, episode, detailPath = "") {
  // If we have a subjectId from an OmniSave search, resolve a download URL.
  try {
    const omni = await searchOmniSaveById(subjectId);
    if (omni && omni.detailPath) {
      const dl = await getOmniSaveDownload(subjectId, omni.detailPath, 0, episode || 1);
      const direct = dl?.downloads?.find((d) => d?.url)?.url || dl?.downloads?.[0]?.url;
      if (direct) {
        return await downloadVideo(direct);
      }
    }
  } catch (err) {
    console.error("OmniSave episode download failed:", err.message);
  }
  return { success: false, error: "Couldn't resolve a download URL for that episode." };
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
