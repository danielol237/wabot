const axios = require("axios");
const { exec } = require("child_process");
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
    const cmd = `yt-dlp -f "best[filesize<500M]/best" --max-filesize 500M -o "${outputPath}" "${url}" 2>&1`;

    exec(cmd, { timeout: 300000 }, (err, stdout, stderr) => {
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

module.exports = {
  searchAnime,
  getAnimeDetails,
  getAnimeEpisodes,
  searchOmniSave,
  getOmniSaveDownload,
  downloadVideo,
  search,
};
