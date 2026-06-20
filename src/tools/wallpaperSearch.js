const axios = require("axios");

// Searches for wallpapers/images using Unsplash's public source endpoint (no key needed
// for basic random/topic-based image fetches via their source.unsplash.com redirect).
async function searchWallpaper(query) {
  try {
    // source.unsplash.com redirects to a relevant random image for the query — no API key required
    const url = `https://source.unsplash.com/1600x900/?${encodeURIComponent(query)}`;
    const res = await axios.head(url, { timeout: 12000, maxRedirects: 5 });
    return { success: true, url: res.request?.res?.responseUrl || url };
  } catch (err) {
    console.error("Wallpaper search error:", err.message);
    return { success: false, error: "Couldn't find a wallpaper for that search." };
  }
}

module.exports = { searchWallpaper };
