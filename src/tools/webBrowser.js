// ── Web Browsing Engine ─────────────────────────────────────
// ARIA can browse the web — load pages, extract content, interact.
// Uses multiple backends: direct HTTP, Cheerio scraping, and search APIs.

const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");
const net = require("net");

// Block SSRF: reject non-http(s) schemes and any host that resolves to a
// private/internal/loopback/link-local address (AWS metadata, internal services).
async function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname;
    if (host === "localhost") return false;
    if (net.isIP(host)) {
      return !(isPrivate(host));
    }
    // resolve DNS and check all resolved addresses
    const addresses = await new Promise((resolve) => {
      try { require("dns").lookup(host, { all: true }, (err, addrs) => resolve(err ? [] : (addrs || []).map((a) => a.address))); }
      catch (_) { resolve([]); }
    });
    if (addresses.length === 0) return true; // allow if we can't resolve (browse will error anyway)
    return addresses.every((a) => !isPrivate(a));
  } catch (_) {
    return false;
  }
}

function isPrivate(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4) return true; // IPv6 => block by default (conservative)
  if (p[0] === 10) return true;                    // 10.0.0.0/8
  if (p[0] === 127) return true;                   // loopback
  if (p[0] === 169 && p[1] === 254) return true;   // link-local / AWS metadata
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
  if (p[0] === 192 && p[1] === 168) return true;   // 192.168/16
  if (p[0] === 0) return true;
  return false;
}

// Browse a URL and extract readable content
async function browse(url) {
  if (!(await isSafeUrl(url))) {
    return { success: false, error: "Blocked: only public http(s) URLs are allowed." };
  }
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      maxRedirects: 5,
    });

    const html = res.data;
    const $ = cheerio.load(html);

    // Remove scripts, styles, navs, footers
    $("script, style, nav, footer, header, aside, .sidebar, .menu, iframe, noscript").remove();

    // Get title
    const title = $("title").text().trim() || new URL(url).hostname;

    // Get meta description
    const metaDesc = $('meta[name="description"]').attr("content") || "";

    // Extract main content
    let content = "";

    // Try common content containers
    const selectors = ["article", "main", ".content", "#content", ".post", ".article", ".entry", ".main"];
    for (const sel of selectors) {
      const el = $(sel);
      if (el.length > 0) {
        content = el.text().trim();
        break;
      }
    }

    // Fallback: get body text
    if (!content) {
      content = $("body").text().trim();
    }

    // Clean up whitespace
    content = content.replace(/\s+/g, " ").replace(/\n+/g, "\n").trim();

    // Get links
    const links = [];
    $("a[href]").each((i, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim().slice(0, 60);
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        try {
          const fullUrl = new URL(href, url).href;
          if (fullUrl.startsWith("http") && !links.find(l => l.url === fullUrl)) {
            links.push({ url: fullUrl, text: text || fullUrl });
          }
        } catch (e) {}
      }
    });

    // Get images
    const images = [];
    $("img[src]").each((i, el) => {
      const src = $(el).attr("src");
      if (src && src.startsWith("http")) {
        images.push(src);
      }
    });

    return {
      success: true,
      title,
      description: metaDesc,
      content: content.slice(0, 4000),
      links: links.slice(0, 10),
      images: images.slice(0, 5),
      url,
    };
  } catch (err) {
    // Try with text mode
    try {
      const res = await axios.get(url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/plain" },
        responseType: "text",
      });
      return {
        success: true,
        title: url,
        content: (res.data || "").slice(0, 3000),
        url,
      };
    } catch (e2) {
      return { success: false, error: `Failed to load page: ${err.message}` };
    }
  }
}

// Search the web using available backends
async function searchWeb(query) {
  // Try Tavily first
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      const res = await axios.post("https://api.tavily.com/search", {
        api_key: tavilyKey,
        query,
        search_depth: "advanced",
        max_results: 8,
        include_answer: true,
      }, { timeout: 10000 });

      if (res.data?.results?.length > 0) {
        let text = `🔍 *Search: ${query}*`;
        if (res.data.answer) text += `\n\n${res.data.answer}\n\n`;
        text += "\n";
        res.data.results.slice(0, 5).forEach(r => {
          text += `\n📄 *${r.title}*\n${r.content?.slice(0, 200)}...\n🔗 ${r.url}\n`;
        });
        return { success: true, text };
      }
    } catch (e) {}
  }

  // Fallback to Brave
  const braveKey = process.env.BRAVE_API_KEY;
  if (braveKey) {
    try {
      const res = await axios.get("https://api.search.brave.com/res/v1/web/search", {
        params: { q: query, count: 5 },
        headers: { "X-Subscription-Token": braveKey },
        timeout: 10000,
      });
      const results = res.data.web?.results || [];
      if (results.length > 0) {
        let text = `🔍 *Search: ${query}*\n\n`;
        results.forEach(r => {
          text += `📄 *${r.title}*\n${r.description?.slice(0, 200) || ""}\n🔗 ${r.url}\n\n`;
        });
        return { success: true, text };
      }
    } catch (e) {}
  }

  return { success: false, error: "No search backends available. Set TAVILY_API_KEY or BRAVE_API_KEY in .env" };
}

// Search and browse — the full flow
async function searchAndBrowse(query) {
  const search = await searchWeb(query);
  if (!search.success) return search;

  // If search returned results, try to browse the first link for more detail
  const urlMatch = search.text.match(/https?:\/\/[^\s\n]+/);
  if (urlMatch) {
    const browseResult = await browse(urlMatch[0]);
    if (browseResult.success && browseResult.content.length > 500) {
      return {
        success: true,
        text: search.text + "\n\n📋 *Detailed content from top result:*\n\n" + browseResult.content.slice(0, 2000),
      };
    }
  }

  return search;
}

module.exports = { browse, searchWeb, searchAndBrowse, isSafeUrl };
