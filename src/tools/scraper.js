const axios = require("axios");
const cheerio = require("cheerio");

async function scrapeUrl(url) {
  if (!url.startsWith("http")) url = "https://" + url;

  // Stage 1: Fast axios fetch
  const axiosResult = await tryAxios(url);
  if (axiosResult.success && axiosResult.content.length > 200) {
    return formatResult(axiosResult, url);
  }

  // Stage 2: Puppeteer for JS-heavy sites
  console.log("Axios gave thin content, switching to Puppeteer...");
  const puppeteerResult = await tryPuppeteer(url);
  if (puppeteerResult.success) {
    return formatResult(puppeteerResult, url);
  }

  // Stage 3: Try a reader-mode proxy as last resort
  console.log("Puppeteer failed, trying reader proxy...");
  const readerResult = await tryReaderProxy(url);
  if (readerResult.success) {
    return formatResult(readerResult, url);
  }

  return `❌ Couldn't read that site. It may require login or block all bots.\n🔗 ${url}`;
}

async function tryAxios(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
      },
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
    });

    const $ = cheerio.load(res.data);
    $("script, style, nav, footer, header, iframe, noscript, .ads, .cookie-banner, .popup").remove();

    const title = $("title").text().trim();
    const metaDesc = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";

    // Build structured content
    let content = "";

    // Extract headings and paragraphs with structure
    $("h1, h2, h3, h4, p, li, td, th, blockquote, pre, code").each((_, el) => {
      const tag = el.tagName.toLowerCase();
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (!t || t.length < 20) return;

      if (tag === "h1") content += `\n*${t}*\n`;
      else if (tag === "h2") content += `\n*${t}*\n`;
      else if (tag === "h3" || tag === "h4") content += `\n_${t}_\n`;
      else if (tag === "li") content += `• ${t}\n`;
      else if (tag === "pre" || tag === "code") content += `\`${t.slice(0, 200)}\`\n`;
      else content += `${t}\n`;
    });

    content = content.replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);

    return { success: !!content, title, metaDesc, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function tryPuppeteer(url) {
  let browser;
  try {
    const puppeteer = require("puppeteer");
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
      ],
    });

    const page = await browser.newPage();

    // Block images/fonts/media to speed up load
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "media", "stylesheet"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Wait a bit for JS to render
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      // Remove noise
      document.querySelectorAll("script, style, nav, footer, header, iframe, noscript").forEach(el => el.remove());

      const title = document.title || "";
      const metaDesc = document.querySelector('meta[name="description"]')?.content || "";

      let content = "";
      document.querySelectorAll("h1, h2, h3, h4, p, li, td, th, pre, code, blockquote").forEach(el => {
        const tag = el.tagName.toLowerCase();
        const t = el.innerText?.replace(/\s+/g, " ").trim();
        if (!t || t.length < 20) return;

        if (tag === "h1" || tag === "h2") content += `\n*${t}*\n`;
        else if (tag === "h3" || tag === "h4") content += `\n_${t}_\n`;
        else if (tag === "li") content += `• ${t}\n`;
        else if (tag === "pre" || tag === "code") content += `\`${t.slice(0, 200)}\`\n`;
        else content += `${t}\n`;
      });

      return { title, metaDesc, content: content.slice(0, 4000) };
    });

    return { success: !!data.content, ...data };
  } catch (err) {
    console.error("Puppeteer scrape error:", err.message);
    return { success: false, error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

async function tryReaderProxy(url) {
  try {
    // Use a public reader-mode API as last resort
    const readerUrl = `https://r.jina.ai/${url}`;
    const res = await axios.get(readerUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/plain" },
      timeout: 15000,
    });

    const content = res.data?.slice(0, 4000) || "";
    const titleMatch = content.match(/^Title: (.+)/m);
    const title = titleMatch?.[1] || "";

    return { success: content.length > 100, title, metaDesc: "", content };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function formatResult({ title, metaDesc, content }, url) {
  let output = "";
  if (title) output += `🌐 *${title}*\n`;
  if (metaDesc) output += `_${metaDesc}_\n`;
  output += `\n${content}\n\n🔗 ${url}`;
  return output.trim();
}

module.exports = { scrapeUrl };
