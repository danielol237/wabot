const axios = require("axios");

// Provider chain: Tavily first (purpose-built for LLM retrieval, 1k free/month),
// Brave second (2k free queries/month, good general quality), DuckDuckGo scraping
// as last resort (known unreliable — kept only so search never fully dies if
// both real APIs are unavailable).
const { runOperation } = require("../utils/operationGuard");

async function guardedSearch(name, task) {
  try {
    return await runOperation(name, task, {
      timeoutMs: 15_000,
      attempts: 2,
      retryIf: (value) => value?.success === false,
      retryDelayMs: 250,
    });
  } catch (error) {
    return { success: false, error: error?.message || "search provider failed" };
  }
}

async function searchWeb(query, dependencies = {}) {
  const tavilyTask = dependencies.tavily;
  const braveTask = dependencies.brave;
  const fallbackTask = dependencies.fallback || searchWebFallback;
  if (tavilyTask || process.env.TAVILY_API_KEY) {
    const result = await guardedSearch("web-search:tavily", tavilyTask || (() => tavilySearch(query)));
    if (result.success) return result.output;
    console.error("Tavily failed, trying Brave:", result.error);
  }

  if (braveTask || process.env.BRAVE_API_KEY) {
    const result = await guardedSearch("web-search:brave", braveTask || (() => braveSearch(query)));
    if (result.success) return result.output;
    console.error("Brave failed, falling back to scraping:", result.error);
  }

  return await fallbackTask(query);
}

async function tavilySearch(query) {
  try {
    const res = await axios.post(
      "https://api.tavily.com/search",
      { api_key: process.env.TAVILY_API_KEY, query, max_results: 5 },
      { timeout: 12000 }
    );

    const results = res.data?.results || [];
    if (results.length === 0) return { success: false, error: "no results" };

    let output = `🔍 *Search: ${query}*\n\n`;
    results.forEach((r, i) => {
      output += `*${i + 1}. ${r.title}*\n${(r.content || "").slice(0, 200)}\n🔗 ${r.url}\n\n`;
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

async function braveSearch(query) {
  try {
    const res = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      params: { q: query, count: 5 },
      headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY, Accept: "application/json" },
      timeout: 12000,
    });

    const results = res.data?.web?.results || [];
    if (results.length === 0) return { success: false, error: "no results" };

    let output = `🔍 *Search: ${query}*\n\n`;
    results.forEach((r, i) => {
      output += `*${i + 1}. ${r.title}*\n${(r.description || "").replace(/<[^>]+>/g, "").slice(0, 200)}\n🔗 ${r.url}\n\n`;
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

// Last resort if neither real API is configured or both failed — known to be
// unreliable due to DuckDuckGo's bot detection, kept only so search isn't
// completely dead in that scenario.
async function searchWebFallback(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      timeout: 10000,
    });

    const cheerio = require("cheerio");
    const $ = cheerio.load(res.data);
    const results = [];

    $(".result").each((i, el) => {
      if (i >= 5) return false;
      const title = $(el).find(".result__title").text().trim();
      const snippet = $(el).find(".result__snippet").text().trim();
      const link = $(el).find(".result__url").text().trim();
      if (title && snippet) results.push({ title, snippet, link });
    });

    if (results.length === 0) {
      return `❌ No results found for: *${query}*\n\n_(Tip: set TAVILY_API_KEY or BRAVE_API_KEY in .env for reliable search — this fallback is known to be flaky.)_`;
    }

    let output = `🔍 *Search: ${query}*\n\n`;
    results.forEach((r, i) => {
      output += `*${i + 1}. ${r.title}*\n${r.snippet}\n🔗 ${r.link}\n\n`;
    });
    return output.trim();
  } catch (err) {
    console.error("Fallback search error:", err.message);
    return `❌ Search failed: ${err.message}`;
  }
}

module.exports = { searchWeb, _test: { guardedSearch, searchWithProviders: searchWeb } };

