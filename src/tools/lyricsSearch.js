const axios = require("axios");

// Switched from lyrics.ovh to LRCLIB — lyrics.ovh has a known history of going
// fully down intermittently (documented GitHub issue: "all requests returning
// 404, was working fine a couple hours ago"). LRCLIB is a dedicated, actively
// maintained lyrics database (~3M songs) with a free, keyless API.
//
// IMPORTANT: per copyright limits, this returns only a short preview/snippet,
// never the full lyrics verbatim — reproducing complete song lyrics is not
// something ARIA does regardless of the source API.
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
    const res = await axios.get(url, { timeout: 10000 });

    const match = res.data?.[0];
    if (!match) {
      return { success: false, error: "Couldn't find that song. Try format: artist - song title" };
    }

    const fullLyrics = match.plainLyrics || match.syncedLyrics || "";
    if (!fullLyrics) {
      return { success: false, error: "Found the song but no lyrics are available for it." };
    }

    // Only return a short preview — never the complete lyrics, regardless of length
    const lines = fullLyrics.split("\n").filter((l) => l.trim());
    const preview = lines.slice(0, 4).join("\n");

    return {
      success: true,
      artist: match.artistName || artist,
      title: match.trackName || title,
      preview,
      isPreviewOnly: true,
    };
  } catch (err) {
    console.error("Lyrics search error:", err.message);
    return { success: false, error: "Lyrics search failed. Try again or check the song name." };
  }
}

module.exports = { getLyrics };

