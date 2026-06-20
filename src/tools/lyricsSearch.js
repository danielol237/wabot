const axios = require("axios");
const cheerio = require("cheerio");

// Lyrics search via a free, no-key lyrics API
async function getLyrics(songQuery) {
  try {
    // Try to split "artist - song" format if provided, otherwise treat as general search
    const parts = songQuery.split(" - ");
    let artist, title;
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join(" - ").trim();
    } else {
      // No clear separator — let the API try to figure it out from a general query
      title = songQuery.trim();
      artist = "";
    }

    const url = artist
      ? `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
      : null;

    if (url) {
      const res = await axios.get(url, { timeout: 10000 });
      if (res.data?.lyrics) {
        return { success: true, lyrics: res.data.lyrics.trim(), artist, title };
      }
    }

    return { success: false, error: "Couldn't find lyrics. Try format: artist - song title" };
  } catch (err) {
    return { success: false, error: "Lyrics not found for that search." };
  }
}

module.exports = { getLyrics };
