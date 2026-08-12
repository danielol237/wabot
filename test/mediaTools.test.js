// Media tools tests — yt-dlp-backed music + video download helpers.
const test = require("node:test");
const assert = require("node:assert");

test("mediaTools: module loads and exposes expected API", () => {
  const m = require("../src/tools/mediaTools");
  assert.strictEqual(typeof m.searchYt, "function");
  assert.strictEqual(typeof m.downloadAudio, "function");
  assert.strictEqual(typeof m.downloadVideo, "function");
  assert.ok(m.TEMP_DIR, "temp dir set");
});

test("mediaTools: searchYt returns null (graceful) when yt-dlp unavailable/no result", async () => {
  // With no cookies, YouTube may refuse; the helper must return null, not throw.
  const m = require("../src/tools/mediaTools");
  const hit = await m.searchYt("zzzz_impossible_nonexistent_song_987654");
  // Either a hit or null — must NOT throw.
  assert.ok(hit === null || (hit && typeof hit.url === "string"));
});
