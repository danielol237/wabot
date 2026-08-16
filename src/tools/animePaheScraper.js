// ── AnimePahe Scraper ───────────────────────────────────────────
// Adapted from the Tampermonkey userscript for ARIA bot
// Handles: animepahe → pahe.win → kwik/pahe → direct download links

const axios = require("axios");
const cheerio = require("cheerio");

const PAHE_HOSTS = [
  "https://animepahe.ru",
  "https://animepahe.org", 
  "https://animepahe.com",
  "https://animepahetv.to",
];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Settings from the userscript
const SETTINGS = {
  resolutionValue: 2,      // 0=360p, 1=480p, 2=720p, 3=1080p
  subtitleDubbed: true,    // true=sub, false=dub
  allLinks: false,
};

// Helper: Make requests with proper headers
async function paheGet(url, options = {}) {
  return axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
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
        id: item.session,           // Anime session ID
        title: item.title,
        titleEnglish: item.title,
        type: item.type,
        episodes: item.episodes,
        status: item.status,
        year: item.year,
        season: item.season,
        image: item.poster && item.poster.startsWith("http") 
          ? item.poster 
          : item.poster 
            ? `https://animepahe.ru${item.poster}` 
            : "",
        source: "animepahe",
      }));
    } catch (e) {
      console.error(`[animepahe] Search failed on ${host}:`, e.message);
    }
  }
  return [];
}

// Get episodes list for an anime
async function getPaheEpisodes(animeSession) {
  for (const host of PAHE_HOSTS) {
    try {
      // Get first page to check total pages
      const res = await paheGet(`${host}/api?m=release&id=${animeSession}&sort=episode_asc&page=1`);
      const data = res.data;
      
      if (!data?.data?.length) continue;
      
      const episodes = data.data.map((ep) => ({
        number: ep.episode,
        session: ep.session,        // Episode session ID
        title: ep.title || `Episode ${ep.episode}`,
        audio: ep.audio,            // 'jpn' or 'eng'
        duration: ep.duration,
        snapshot: ep.snapshot,
      }));
      
      return episodes;
    } catch (e) {
      console.error(`[animepahe] Episodes fetch failed on ${host}:`, e.message);
    }
  }
  return [];
}

// Get download links for an episode
// This is where we implement the userscript logic
async function getPaheDownloadLinks(animeSession, episodeSession, episodeNum) {
  for (const host of PAHE_HOSTS) {
    try {
      // Step 1: Get the episode page to find pahe.win links
      const episodeUrl = `${host}/play/${animeSession}/${episodeSession}`;
      const res = await paheGet(episodeUrl);
      const html = res.data;
      const $ = cheerio.load(html);
      
      // Find the download button/links
      // AnimePahe loads download links via AJAX, so we need to find the API endpoint
      const downloadApiMatch = html.match(/api\?m=links&id=([a-f0-9]{32})/);
      
      if (!downloadApiMatch) {
        // Try alternative: look for embedded data
        const embedMatch = html.match(/data-embed="([^"]+)"/);
        if (!embedMatch) continue;
      }
      
      // Step 2: Call the links API
      const linksRes = await paheGet(`${host}/api?m=links&id=${episodeSession}&p=kwik`);
      const linksData = linksRes.data;
      
      if (!linksData?.data?.length) continue;
      
      // Parse download options (mirrors with different qualities)
      const downloads = [];
      
      for (const mirror of linksData.data) {
        // mirror contains: audio (jpn/eng), filesize, fansub, kwik, quality (360/720/1080)
        const isSub = mirror.audio === "jpn";
        const isDub = mirror.audio === "eng";
        
        // Skip if user wants sub but this is dub (and vice versa)
        if (SETTINGS.subtitleDubbed && !isSub) continue;
        if (!SETTINGS.subtitleDubbed && !isDub) continue;
        
        // Extract resolution
        const resolution = parseInt(mirror.quality) || 720;
        
        downloads.push({
          url: mirror.kwik,           // pahe.win or kwik.cx link
          resolution,
          filesize: mirror.filesize,
          fansub: mirror.fansub,
          audio: mirror.audio,
          type: "mp4",
        });
      }
      
      // Sort by resolution preference
      downloads.sort((a, b) => {
        const aDiff = Math.abs(a.resolution - (SETTINGS.resolutionValue === 0 ? 360 : SETTINGS.resolutionValue === 1 ? 480 : SETTINGS.resolutionValue === 2 ? 720 : 1080));
        const bDiff = Math.abs(b.resolution - (SETTINGS.resolutionValue === 0 ? 360 : SETTINGS.resolutionValue === 1 ? 480 : SETTINGS.resolutionValue === 2 ? 720 : 1080));
        return aDiff - bDiff;
      });
      
      return downloads;
    } catch (e) {
      console.error(`[animepahe] Download links failed on ${host}:`, e.message);
    }
  }
  return [];
}

// Resolve pahe.win/kwik link to direct download URL
// This implements the bypass logic from your userscript
async function resolvePaheWinLink(paheWinUrl) {
  try {
    // Step 1: Visit the pahe.win/kwik link
    const res = await paheGet(paheWinUrl, {
      headers: {
        "Referer": "https://animepahe.ru/",
      },
    });
    
    const html = res.data;
    
    // Step 2: Extract the form data or redirect URL
    // The userscript looks for: form with action, token, etc.
    const $ = cheerio.load(html);
    
    // Look for the continue button/form
    const form = $("form");
    if (form.length) {
      const action = form.attr("action") || paheWinUrl;
      const inputs = {};
      form.find("input").each((_, el) => {
        const name = $(el).attr("name");
        const value = $(el).attr("value");
        if (name) inputs[name] = value;
      });
      
      // Submit the form (POST)
      const postRes = await axios.post(action, new URLSearchParams(inputs), {
        timeout: 15000,
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": paheWinUrl,
        },
        maxRedirects: 5,
      });
      
      // Step 3: Look for the actual download link or next redirect
      const postHtml = postRes.data;
      const directUrlMatch = postHtml.match(/(https:\/\/[^"']+\.(mp4|m3u8)[^"']*)/i);
      
      if (directUrlMatch) {
        return directUrlMatch[1];
      }
      
      // Check for kwik redirect
      const kwikMatch = postHtml.match(/https:\/\/kwik\.[^"']+/);
      if (kwikMatch) {
        return await resolveKwikLink(kwikMatch[0]);
      }
    }
    
    // Alternative: Look for direct link in script tags
    const scriptMatch = html.match(/var\s+url\s*=\s*["']([^"']+)["']/);
    if (scriptMatch) {
      return scriptMatch[1];
    }
    
    return null;
  } catch (e) {
    console.error("[animepahe] Failed to resolve pahe.win link:", e.message);
    return null;
  }
}

// Resolve kwik.cx link to direct download
async function resolveKwikLink(kwikUrl) {
  try {
    const res = await paheGet(kwikUrl);
    const html = res.data;
    
    // Look for the download form or direct link
    const $ = cheerio.load(html);
    
    // Kwik usually has a form that needs to be submitted
    const form = $("form");
    if (form.length) {
      const action = form.attr("action") || kwikUrl;
      const inputs = {};
      form.find("input").each((_, el) => {
        const name = $(el).attr("name");
        const value = $(el).attr("value");
        if (name) inputs[name] = value;
      });
      
      // POST to get the download link
      const postRes = await axios.post(action, new URLSearchParams(inputs), {
        timeout: 15000,
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": kwikUrl,
        },
      });
      
      const postHtml = postRes.data;
      
      // Extract the video URL
      const videoMatch = postHtml.match(/(https:\/\/[^"']+\.(mp4|m3u8)[^"']*)/i);
      if (videoMatch) return videoMatch[1];
      
      // Or look for redirect
      const redirectMatch = postHtml.match(/href=["']([^"']+)["']/);
      if (redirectMatch) return redirectMatch[1];
    }
    
    return null;
  } catch (e) {
    console.error("[animepahe] Failed to resolve kwik link:", e.message);
    return null;
  }
}

// Main function: Get stream/download URL for an episode
async function paheGetStream(animeSession, episodeNum) {
  try {
    // Get episodes list
    const episodes = await getPaheEpisodes(animeSession);
    if (!episodes.length) return { error: "No episodes found" };
    
    const episode = episodes.find((e) => e.number === episodeNum) || episodes[episodeNum - 1];
    if (!episode) return { error: `Episode ${episodeNum} not found` };
    
    // Get download links
    const downloads = await getPaheDownloadLinks(animeSession, episode.session, episodeNum);
    if (!downloads.length) return { error: "No download links found" };
    
    // Resolve the best link to direct URL
    const best = downloads[0];
    const directUrl = await resolvePaheWinLink(best.url);
    
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

// Legacy compatibility: searchAnimePahe (used by animeService.js)
async function searchAnimePahe(query) {
  return searchPahe(query);
}

// Get episode MD5 (for compatibility with existing code)
async function animepaheGetEpisodeMd5(animeId, episodeNum) {
  // In the new API, animeId is the session
  const episodes = await getPaheEpisodes(animeId);
  const episode = episodes.find((e) => e.number === episodeNum);
  
  if (!episode) return { error: "Episode not found" };
  return { md5: episode.session, title: episode.title };
}

module.exports = {
  searchPahe,
  searchAnimePahe,
  getPaheEpisodes,
  getPaheDownloadLinks,
  resolvePaheWinLink,
  resolveKwikLink,
  paheGetStream,
  animepaheGetEpisodeMd5,
};