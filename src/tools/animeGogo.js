// ── Gogoanime / Anitaku — fallback anime stream source ─────────
// Gogoanime has a stable, plain-HTML structure that doesn't need a JS session:
//   search.html?keyword=X      -> search results
//   /category/{id}             -> anime detail (list of episodes)
//   ajax/load-list-episode     -> episode list JSON (HTML)
//   /{id}-episode-{n}          -> watch page (has the server + embed)
//   stream/{id}?post={n}       -> returns the <iframe> embed URL
//   encrypt-ajax API           -> decrypts to the raw m3u8
//
// We scrape through the stable public endpoints with multiple mirror hosts so
// a single domain being blocked/down doesn't kill the whole flow.

const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");

// Mirror hosts tried in order (gogo + its anitaku re-brand).
const HOSTS = [
  "https://anitaku.to",
  "https://gogoanimehd.io",
  "https://gogoanime3.net",
  "https://anitaku.bz",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const GOGO_SECRET = "37911490979715163134003223491201";
const GOGO_SECOND_SECRET = "54632138312660897455";

async function gogoGet(host, path, extraHeaders = {}) {
  return axios.get(host + path, {
    timeout: 15000,
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: host + "/",
      ...extraHeaders,
    },
  });
}

// Decrypt the AjaxResponse payload (aes-cbc with the static gogo secret).
function decryptAjax(data) {
  const ct = data?.data ?? data;
  if (!ct) return null;
  // The payload is base64-encoded AES-CBC ciphertext with static key+iv.
  try {
    const key = Buffer.from(GOGO_SECRET, "utf8");
    const iv = Buffer.from(GOGO_SECOND_SECRET, "utf8");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    decipher.setAutoPadding(true);
    const buf = Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
    return JSON.parse(buf.toString("utf8"));
  } catch (_) { return null; }
}

// Search Gogoanime for an anime. Returns normalized results.
async function searchGogo(query) {
  for (const host of HOSTS) {
    try {
      const res = await gogoGet(host, `/search.html?keyword=${encodeURIComponent(query)}`);
      const $ = cheerio.load(res.data);
      const results = [];
      $("ul.items li").each((_, el) => {
        const a = $(el).find("a").first();
        const href = a.attr("href") || "";
        const id = href.replace(/^\//, "").replace(/-episode.*$/, "");
        const title = a.attr("title") || a.text().trim();
        if (!id || !title) return;
        const img = $(el).find("img").attr("src") || "";
        results.push({
          id,                // e.g. "one-piece" or "category/one-piece"
          title,
          titleEnglish: title,
          image: img,
          source: "gogoanime",
        });
      });
      if (results.length) return results.slice(0, 8);
    } catch (e) {
      // try next host
    }
  }
  return [];
}

// Get the total episode count + gogo episode ids for an anime.
async function gogoGetEpisodeIds(animeId, host) {
  // Normalize the category path.
  const catId = animeId.replace(/^category\//, "").replace(/\/$/, "");
  try {
    const res = await gogoGet(host, `/ajax/load-list-episode?ep_start=0&ep_end=100000&id=${encodeURIComponent(catId)}`, {
      "X-Requested-With": "XMLHttpRequest",
    });
    const $ = cheerio.load(res.data);
    const eps = [];
    $("li a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const dataId = $(el).attr("data-ep-id") || "";
      const text = $(el).text().trim();
      const m = href.match(/-episode-(\d+)$/) || text.match(/(?:episode\s*)?(\d+)/i);
      if (m && dataId) {
        eps.push({ ep: parseInt(m[1]), epId: dataId, href });
      }
    });
    if (eps.length) {
      eps.sort((a, b) => a.ep - b.ep);
      return { host, eps, catId };
    }
  } catch (_) {}
  return null;
}

// Resolve the raw m3u8 for an episode via the watch page + encrypt-ajax flow.
async function gogoResolveStream(host, catId, epId, epNum) {
  try {
    const watchPath = `/category/${catId}-episode-${epNum}`;
    const watch = await gogoGet(host, watchPath);
    const $ = cheerio.load(watch.data);
    let serverUrl = "";
    $("div.anime_muti_link a").each((_, el) => {
      const data = $(el).attr("data-video") || "";
      if (data && data.startsWith("https://")) serverUrl = data;
    });
    // fallback: first iframe src
    if (!serverUrl) serverUrl = $("iframe").first().attr("src") || "";

    // The server URL is usually https://{host}/stream/{id}?post={data-id}
    let srcPage;
    try {
      srcPage = await axios.get(serverUrl, { timeout: 15000, headers: { "User-Agent": UA, Referer: host + watchPath } });
    } catch (e) {
      return { error: "Gogoanime server unreachable" };
    }
    const $src = cheerio.load(srcPage.data);
    const dataId = $src("input#alias-data").attr("value")
      || $src('script[data-name="episode"]').attr("data-value")
      || $src("#wrapper-data").attr("data-value")
      || "";
    if (!dataId) return { error: "Gogoanime: could not find server data id" };

    const ajax = await gogoGet(host, `/encrypt-ajax.php?id=${encodeURIComponent(dataId)}&alias=${encodeURIComponent(catId)}&ep=${epNum}`, {
      "X-Requested-With": "XMLHttpRequest",
    });
    const dec = decryptAjax(ajax.data);
    const source = dec?.source || dec?.link || dec?.source2 || [];
    if (!source) return { error: "Gogoanime: no stream source" };
    const srcList = Array.isArray(source) ? source : (source.source || []);
    const file = (Array.isArray(srcList) && srcList.find((s) => s?.file)?.file) || source.file;
    if (!file) return { error: "Gogoanime: no m3u8 in response" };
    return { m3u8: file, title: catId };
  } catch (e) {
    return { error: "Gogoanime: " + (e.message || "resolve failed") };
  }
}

// High-level: get a direct m3u8 for an anime + episode across mirrors.
async function gogoAnimeStream(animeId, episodeNum) {
  for (const host of HOSTS) {
    const info = await gogoGetEpisodeIds(animeId, host);
    if (!info) continue;
    const res = await gogoResolveStream(info.host, info.catId, info.eps[episodeNum - 1]?.epId, episodeNum);
    if (res.m3u8) return res;
  }
  return { error: "Gogoanime: all mirrors failed" };
}

module.exports = {
  searchGogo,
  gogoGetEpisodeIds,
  gogoResolveStream,
  gogoAnimeStream,
  HOSTS,
};
