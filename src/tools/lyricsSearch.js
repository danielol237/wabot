const axios = require("axios");

async function getLyrics(songQuery) {
  try {
    const parts = songQuery.split(" - ");
    let artist, title;
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join(" - ").trim();
    } else {
      title = songQuery.trim();
      artist = "";
    }

    const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}${artist ? `&artist_name=${encodeURIComponent(artist)}` : ""}`;
    const res = await axios.get(url, { timeout: 15000 });

    const match = res.data?.[0];
    if (!match) {
      return { success: false, error: "Couldn't find that song. Try format: artist - song title" };
    }

    const fullLyrics = match.plainLyrics || match.syncedLyrics || "";
    if (!fullLyrics) {
      return { success: false, error: "Found the song but no lyrics are available for it." };
    }

    return {
      success: true,
      artist: match.artistName || artist,
      title: match.trackName || title,
      lyrics: fullLyrics,
      isPreviewOnly: false,
    };
  } catch (err) {
    console.error("Lyrics search error:", err.message);
    return { success: false, error: "Lyrics search failed. Try again or check the song name." };
  }
}

module.exports = { getLyrics };
