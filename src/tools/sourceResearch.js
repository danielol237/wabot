// ── Source-specific research: GitHub / Reddit / Wikipedia ──────
// Each platform uses its own native API so results are genuinely from that
// source (no generic web search). Uses only axios + cheerio (already deps).

const axios = require("axios");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── GitHub ─────────────────────────────────────────────────────
// Public GitHub Search API. No token needed for the free tier (rate-limited),
// but respects GITHUB_TOKEN if one is set in env for higher limits.
async function searchGitHub(query) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ARIA-Bot",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  // Try repositories first, then fall back to code search if nothing useful.
  let repos = [];
  try {
    const r = await axios.get("https://api.github.com/search/repositories", {
      params: { q: query, sort: "stars", order: "desc", per_page: 5 },
      headers,
      timeout: 15000,
    });
    repos = r.data?.items || [];
  } catch (e) {
    return { error: `GitHub API: ${e.response?.status || e.message}` };
  }

  if (!repos.length) {
    return { error: `No GitHub repos found for "${query}".` };
  }

  const lines = repos.map((repo, i) => {
    const desc = (repo.description || "No description").slice(0, 180);
    let out = `*${i + 1}. ${repo.full_name}* ⭐${repo.stargazers_count}${repo.language ? " · " + repo.language : ""}\n`;
    out += `  ${desc}\n`;
    out += `  🔗 https://github.com/${repo.full_name}\n`;
    if (repo.homepage) out += `  🏠 ${repo.homepage}\n`;
    return out;
  });

  return {
    source: "GitHub",
    title: `🔍 *GitHub: "${query}"*`,
    body: lines.join("\n"),
  };
}

// Fetch the latest releases (with download links) for a GitHub repo/user/owner.
async function gitHubReleases(query) {
  // Allow both "owner/repo" and a bare repo name. Try owner/repo first.
  const q = query.trim().replace(/^github\.com\//i, "").replace(/^https?:\/\//i, "");
  const candidates = q.includes("/")
    ? [q.replace(/\.git$/, "")]
    : [q];

  for (const full of candidates) {
    const ownerRepo = full.replace(/^@/, "");
    try {
      const r = await axios.get(`https://api.github.com/repos/${ownerRepo}/releases`, {
        params: { per_page: 5 },
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "ARIA-Bot",
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
        timeout: 15000,
      });
      const releases = r.data || [];
      if (!releases.length) {
        return { error: `No releases found for "${ownerRepo}". (It may not be a repo — try "owner/repo".)` };
      }
      const lines = releases.map((rel, i) => {
        let out = `*${i + 1}. ${rel.tag_name}*`;
        if (rel.published_at) out += ` — ${new Date(rel.published_at).toISOString().slice(0, 10)}`;
        if (rel.name) out += `\n  ${rel.name}`;
        const assets = (rel.assets || []).slice(0, 5);
        if (assets.length) {
          out += "\n  📦 Files:";
          assets.forEach((a) => {
            out += `\n   • ${a.name} (${formatBytes(a.size)}) — ${a.browser_download_url}`;
          });
        } else if (rel.zipball_url) {
          out += `\n   • Source zip — ${rel.zipball_url}`;
        }
        return out;
      });
      return {
        source: "GitHub Releases",
        title: `📦 *GitHub Releases: ${ownerRepo}*`,
        body: lines.join("\n\n"),
      };
    } catch (e) {
      // If single candidate failed and it wasn't owner/repo, try GitHub repo search.
      if (!q.includes("/") && candidates.length === 1) {
        const search = await searchGitHub(q);
        if (search.repos) {
          return {
            source: "GitHub",
            title: `❓ Couldn't resolve "${q}" to a repo. Try "owner/repo".\n\nClosest repos:`,
            body: search.body,
          };
        }
      }
      return { error: `GitHub: ${e.response?.status || e.message}` };
    }
  }
  return { error: "Could not resolve a GitHub repository." };
}

function formatBytes(bytes) {
  if (!bytes) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

// ── Reddit ─────────────────────────────────────────────────────
// Reddit's public JSON API (append .json). Returns top matching posts.
async function searchReddit(query, subreddit) {
  // Optionally scope to a subreddit: "!reddit r/dankmemes cats"
  let target = subreddit
    ? `https://www.reddit.com/r/${subreddit.replace(/^r\//i, "")}/search.json`
    : `https://www.reddit.com/search.json`;
  const params = { q: query, limit: 8, sort: "relevance", t: "year" };

  const results = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await axios.get(target, {
        params,
        headers: {
          "User-Agent": "ARIA-Bot/1.0 (research command)",
          Accept: "application/json",
        },
        timeout: 15000,
      });
      const children = r.data?.data?.children || [];
      for (const c of children) {
        const d = c?.data;
        if (!d) continue;
        results.push({
          title: d.title,
          subreddit: d.subreddit_name_prefixed || `r/${d.subreddit}`,
          permalink: `https://www.reddit.com${d.permalink}`,
          score: d.score,
          comments: d.num_comments,
          url: d.url,
          selftext: (d.selftext || "").replace(/\s+/g, " ").slice(0, 150),
        });
      }
      if (results.length) break;
      // Reddit can be finicky; retry once with a fresh request.
      await new Promise((res) => setTimeout(res, 1500));
    } catch (e) {
      // 403 often means bot-detection; fall back to the .json on old.reddit
      if (e.response?.status === 403 && attempt === 0) {
        target = target.replace("www.reddit.com", "old.reddit.com");
        continue;
      }
      return { error: `Reddit: ${e.response?.status || e.message}` };
    }
  }

  if (!results.length) return { error: `No Reddit results for "${query}".` };

  const lines = results.map((post, i) => {
    let out = `*${i + 1}. ${post.title}*\n`;
    out += `  ${post.subreddit} · ⬆${post.score} · 💬${post.comments}\n`;
    if (post.selftext) out += `  ${post.selftext}\n`;
    out += `  🔗 ${post.permalink}\n`;
    return out;
  });

  return {
    source: "Reddit",
    title: `🔍 *Reddit: "${query}"*${subreddit ? ` (in ${subreddit})` : ""}`,
    body: lines.join("\n"),
  };
}

// ── Wikipedia ──────────────────────────────────────────────────
// MediaWiki action API — returns article summaries + links.
async function searchWikipedia(query) {
  try {
    const r = await axios.get("https://en.wikipedia.org/w/api.php", {
      params: {
        action: "query",
        list: "search",
        srsearch: query,
        srlimit: 5,
        format: "json",
        origin: "*",
      },
      headers: { "User-Agent": "ARIA-Bot/1.0" },
      timeout: 15000,
    });
    const hits = r.data?.query?.search || [];
    if (!hits.length) return { error: `No Wikipedia results for "${query}".` };

    const lines = [];
    for (const hit of hits) {
      const title = hit.title;
      const snippet = (hit.snippet || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 180);
      lines.push(`*${title}*\n  ${snippet}\n  🔗 https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    }

    return {
      source: "Wikipedia",
      title: `🔍 *Wikipedia: "${query}"*`,
      body: lines.join("\n\n"),
    };
  } catch (e) {
    return { error: `Wikipedia: ${e.response?.status || e.message}` };
  }
}

// ── Dispatcher ─────────────────────────────────────────────────
// research({source, query, subreddit}) -> normalized {source,title,body} | {error}
async function research({ source, query, subreddit }) {
  const q = (query || "").trim();
  if (!q) return { error: "I need a search term. Usage: !github <thing> / !reddit <thing> / !wikipedia <thing>" };

  switch (source) {
    case "github": return searchGitHub(q);
    case "releases": return gitHubReleases(q);
    case "reddit": {
      const r = await searchReddit(q, subreddit);
      if (!r.error) return r;
      // Last resort: generic web search scoped to the source domain.
      return genericFallback(`site:reddit.com ${subreddit ? subreddit + " " : ""}${q}`, "Reddit");
    }
    case "wikipedia": {
      const w = await searchWikipedia(q);
      if (!w.error) return w;
      return genericFallback(`site:en.wikipedia.org ${q}`, "Wikipedia");
    }
    default: return { error: "Unknown source." };
  }
}

// Fall back to the generic web search (Tavily/Brave/DDG) scoped to a domain.
async function genericFallback(query, source) {
  try {
    const { searchWeb } = require("./webSearch");
    const out = await searchWeb(query);
    if (out && !out.startsWith("❌") && !out.startsWith("No results")) {
      return { source, title: `🔍 *${source} (via web search):*`, body: out.replace(/^🔍 \*Search:[^*]*\*\s*/, "") };
    }
    return { error: `Primary ${source} API blocked and web fallback had no results.` };
  } catch (e) {
    return { error: `Primary ${source} API blocked: ${e.message}` };
  }
}

module.exports = { research, searchGitHub, gitHubReleases, searchReddit, searchWikipedia, genericFallback };
