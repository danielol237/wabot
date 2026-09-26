// ── AnimePahe Scraper ───────────────────────────────────────────
// Handles: animepahe → pahe.win → kwik/pahe → direct stream & download links

const axios = require("axios");
const cheerio = require("cheerio");

const PAHE_HOSTS = [
  "https://animepahe.ru",
  "https://animepahe.org", 
  "https://animepahe.com",
  "https://animepahetv.to",
];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SETTINGS = {
  resolutionValue: 2,      // 0=360p, 1=480p, 2=720p, 3=1080p
  subtitleDubbed: true,    // true=sub, false=dub
};

// JavaScript Unpacker for Dean Edwards packed code (p,a,c,k,e,d)
function unpackJS(packed) {
  try {
    const match = packed.match(/}\s*\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*)'\.split\('\|'\)/s);
    if (!match) return packed;

    let [_, p, a, c, k] = match;
    a = parseInt(a, 10);
    c = parseInt(c, 10);
    k = k.split("|");

    function e(c) {
      return (c < a ? "" : e(parseInt(c / a, 10))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
    }

    while (c--) {
      if (k[c]) {
        p = p.replace(new RegExp("\\b" + e(c) + "\\b", "g"), k[c]);
      }
    }
    return p;
  } catch (_) {
    return packed;
  }
}

async function paheGet(url, options = {}) {
  return axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://animepahe.ru/",
      ...options.headers,
    },
    ...options,
  });
}

// Search AnimePahe
async function searchPahe(query) {
  for (const host of PAHE_HOSTS) {
    try {
      const res = await paheGet(`${host}/api?m=search&q=${encodeURIComponent(query)}`);
      const data = res.data;
      if (!data?.data?.length) continue;
      
      return data.data.map((item) => ({
        id: item.session,
        title: item.title,
        titleEnglish: item.title,
        type: item.type,
        episodes: item.episodes,
        status: item.status,
        year: item.year,
        season: item.season,
        image: item.poster && item.poster.startsWith("http") ? item.poster : (item.poster ? `${host}${item.poster}` : ""),
        source: "animepahe",
      }));
    } catch (_) {}
  }
  return [];
}

// Get episodes list
async function getPaheEpisodes(animeSession) {
  for (const host of PAHE_HOSTS) {
    try {
      const res = await paheGet(`${host}/api?m=release&id=${animeSession}&sort=episode_asc&page=1`);
      const data = res.data;
      if (!data?.data?.length) continue;
      
      return data.data.map((ep) => ({
        number: ep.episode,
        session: ep.session,
        title: ep.title || `Episode ${ep.episode}`,
        audio: ep.audio,
        duration: ep.duration,
        snapshot: ep.snapshot,
      }));
    } catch (_) {}
  }
  return [];
}

// Get download links
async function getPaheDownloadLinks(animeSession, episodeSession) {
  for (const host of PAHE_HOSTS) {
    try {
      const linksRes = await paheGet(`${host}/api?m=links&id=${episodeSession}&p=kwik`);
      const linksData = linksRes.data;
      if (!linksData?.data?.length) continue;
      
      const downloads = [];
      for (const mirror of linksData.data) {
        const resolution = parseInt(mirror.quality, 10) || 720;
        downloads.push({
          url: mirror.kwik,
          resolution,
          filesize: mirror.filesize,
          fansub: mirror.fansub,
          audio: mirror.audio,
          type: "mp4",
        });
      }
      
      downloads.sort((a, b) => Math.abs(a.resolution - 720) - Math.abs(b.resolution - 720));
      return downloads;
    } catch (_) {}
  }
  return [];
}

// Resolve kwik.cx / pahe.win obfuscated JS to direct stream URL
async function resolveKwikLink(kwikUrl) {
  try {
    const res = await paheGet(kwikUrl, {
      headers: { "Referer": "https://animepahe.ru/" }
    });
    const html = res.data;
    
    // Check for direct MP4/m3u8 in scripts or forms
    const directMatch = html.match(/(https:\/\/[^"']+\.(mp4|m3u8)[^"']*)/i);
    if (directMatch) return directMatch[1];
    
    // Look for packed JS
    const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\).*\)/);
    if (packedMatch) {
      const unpacked = unpackJS(packedMatch[0]);
      const sourceMatch = unpacked.match(/const\s+source\s*=\s*['"]([^'"]+)['"]/i) || unpacked.match(/(https:\/\/[^"']+\.(mp4|m3u8)[^"']*)/i);
      if (sourceMatch) return sourceMatch[1];
    }
    
    // Check form submit
    const $ = cheerio.load(html);
    const form = $("form");
    if (form.length) {
      const action = form.attr("action") || kwikUrl;
      const inputs = {};
      form.find("input").each((_, el) => {
        const name = $(el).attr("name");
        const value = $(el).attr("value");
        if (name) inputs[name] = value;
      });
      
      const postRes = await axios.post(action, new URLSearchParams(inputs), {
        timeout: 15000,
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": kwikUrl,
        },
      });
      const postHtml = postRes.data;
      const videoMatch = postHtml.match(/(https:\/\/[^"']+\.(mp4|m3u8)[^"']*)/i);
      if (videoMatch) return videoMatch[1];
    }
  } catch (_) {}
  return null;
}

async function paheGetStream(animeSession, episodeNum) {
  try {
    const episodes = await getPaheEpisodes(animeSession);
    if (!episodes.length) return { error: "No episodes found" };
    
    const episode = episodes.find((e) => e.number === episodeNum) || episodes[episodeNum - 1];
    if (!episode) return { error: `Episode ${episodeNum} not found` };
    
    const downloads = await getPaheDownloadLinks(animeSession, episode.session);
    if (!downloads.length) return { error: "No download links found" };
    
    const best = downloads[0];
    const directUrl = await resolveKwikLink(best.url);
    if (!directUrl) return { error: "Could not resolve download link" };
    
    return {
      url: directUrl,
      type: directUrl.includes(".m3u8") ? "hls" : "mp4",
      quality: String(best.resolution),
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": "https://kwik.cx/",
      },
      title: episode.title,
    };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = {
  searchPahe,
  searchAnimePahe: searchPahe,
  getPaheEpisodes,
  getPaheDownloadLinks,
  resolveKwikLink,
  resolvePaheWinLink: resolveKwikLink,
  paheGetStream,
};
