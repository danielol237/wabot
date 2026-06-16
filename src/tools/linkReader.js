const axios = require("axios");
const path = require("path");

// Reads files/code from shared links — Gofile, Pastebin, GitHub raw, etc.
async function readFromLink(url) {
  try {
    // ── GitHub ──────────────────────────────────────────────
    // Convert github.com blob URL to raw
    if (url.includes("github.com") && url.includes("/blob/")) {
      url = url
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }

    // ── Pastebin ────────────────────────────────────────────
    if (url.includes("pastebin.com") && !url.includes("/raw/")) {
      const id = url.split("/").pop();
      url = `https://pastebin.com/raw/${id}`;
    }

    // ── Hastebin ────────────────────────────────────────────
    if (url.includes("hastebin.com") && !url.includes("/raw/")) {
      const id = url.split("/").pop();
      url = `https://hastebin.com/raw/${id}`;
    }

    // ── Gofile ──────────────────────────────────────────────
    if (url.includes("gofile.io")) {
      return await readGofile(url);
    }

    // ── Generic raw fetch ───────────────────────────────────
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/plain, application/json, */*",
      },
      timeout: 15000,
      maxContentLength: 2 * 1024 * 1024, // 2MB max
      responseType: "text",
    });

    const content = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
    const filename = url.split("/").pop().split("?")[0] || "file.txt";
    const ext = path.extname(filename).slice(1) || "txt";

    return {
      success: true,
      filename,
      ext,
      content: content.slice(0, 8000),
      source: url,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function readGofile(url) {
  try {
    // Extract file ID from gofile URL
    const fileId = url.split("/d/")[1]?.split("/")[0] || url.split("/").pop();
    if (!fileId) return { success: false, error: "Invalid Gofile URL" };

    // Get guest token
    const tokenRes = await axios.post("https://api.gofile.io/accounts", {}, { timeout: 10000 });
    const token = tokenRes.data?.data?.token;
    if (!token) return { success: false, error: "Couldn't get Gofile token" };

    // Get file info
    const infoRes = await axios.get(`https://api.gofile.io/contents/${fileId}?wt=4fd6sg89d7s6&cache=true`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });

    const contents = infoRes.data?.data?.contents;
    if (!contents) return { success: false, error: "No contents found in Gofile" };

    // Get first file
    const firstFile = Object.values(contents)[0];
    if (!firstFile) return { success: false, error: "Empty Gofile folder" };

    const fileRes = await axios.get(firstFile.link, {
      headers: { Cookie: `accountToken=${token}` },
      timeout: 15000,
      responseType: "text",
      maxContentLength: 2 * 1024 * 1024,
    });

    return {
      success: true,
      filename: firstFile.name,
      ext: path.extname(firstFile.name).slice(1) || "txt",
      content: fileRes.data.slice(0, 8000),
      source: url,
    };
  } catch (err) {
    return { success: false, error: `Gofile error: ${err.message}` };
  }
}

// Detect if a message contains a shareable file link
function detectFileLink(text) {
  const patterns = [
    /https?:\/\/gofile\.io\/d\/\w+/i,
    /https?:\/\/pastebin\.com\/\w+/i,
    /https?:\/\/hastebin\.com\/\w+/i,
    /https?:\/\/raw\.githubusercontent\.com\/[^\s]+/i,
    /https?:\/\/github\.com\/[^\s]+\/blob\/[^\s]+/i,
    /https?:\/\/[^\s]+\.(js|ts|py|html|css|json|txt|md|csv|sh|sql|xml|yaml|env)[^\s]*/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

module.exports = { readFromLink, detectFileLink };
