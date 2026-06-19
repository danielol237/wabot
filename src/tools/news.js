const axios = require("axios");
const cheerio = require("cheerio");

// Lightweight news digest — scrapes Google News RSS for a topic, no API key needed
async function getNewsDigest(topic = "world") {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 12000,
    });

    const $ = cheerio.load(res.data, { xmlMode: true });
    const items = [];

    $("item").each((i, el) => {
      if (i >= 5) return false;
      const title = $(el).find("title").text().trim();
      const link = $(el).find("link").text().trim();
      const pubDate = $(el).find("pubDate").text().trim();
      if (title) items.push({ title, link, pubDate });
    });

    if (items.length === 0) return { success: false, error: "No news found for that topic." };
    return { success: true, items, topic };
  } catch (err) {
    console.error("News digest error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { getNewsDigest };
