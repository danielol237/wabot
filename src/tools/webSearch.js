const axios = require("axios");
const cheerio = require("cheerio");

async function searchWeb(query) {
  try {
    // DuckDuckGo HTML search (no API key needed)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      timeout: 10000,
    });

    const $ = cheerio.load(res.data);
    const results = [];

    $(".result").each((i, el) => {
      if (i >= 5) return false; // top 5 results
      const title = $(el).find(".result__title").text().trim();
      const snippet = $(el).find(".result__snippet").text().trim();
      const link = $(el).find(".result__url").text().trim();
      if (title && snippet) {
        results.push({ title, snippet, link });
      }
    });

    if (results.length === 0) return `❌ No results found for: *${query}*`;

    let output = `🔍 *Search: ${query}*\n\n`;
    results.forEach((r, i) => {
      output += `*${i + 1}. ${r.title}*\n${r.snippet}\n🔗 ${r.link}\n\n`;
    });

    return output.trim();
  } catch (err) {
    console.error("Search error:", err.message);
    return `❌ Search failed: ${err.message}`;
  }
}

module.exports = { searchWeb };
