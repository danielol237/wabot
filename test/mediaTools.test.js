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

test("mediaTools: social download configuration is disabled explicitly and size is bounded", () => {
  const m = require("../src/tools/mediaTools");
  const previousEnabled = process.env.MEDIA_DOWNLOAD_ENABLED;
  const previousMax = process.env.MEDIA_DOWNLOAD_MAX_MB;
  process.env.MEDIA_DOWNLOAD_ENABLED = "0";
  process.env.MEDIA_DOWNLOAD_MAX_MB = "999";
  assert.equal(m.mediaDownloadEnabled(), false);
  assert.equal(m.mediaDownloadMaxMb(), 100);
  process.env.MEDIA_DOWNLOAD_ENABLED = "1";
  process.env.MEDIA_DOWNLOAD_MAX_MB = "0";
  assert.equal(m.mediaDownloadEnabled(), true);
  assert.equal(m.mediaDownloadMaxMb(), 1);
  if (previousEnabled === undefined) delete process.env.MEDIA_DOWNLOAD_ENABLED;
  else process.env.MEDIA_DOWNLOAD_ENABLED = previousEnabled;
  if (previousMax === undefined) delete process.env.MEDIA_DOWNLOAD_MAX_MB;
  else process.env.MEDIA_DOWNLOAD_MAX_MB = previousMax;
});

test("mediaTools: searchYt returns null (graceful) when yt-dlp unavailable/no result", async () => {
  // With no cookies, YouTube may refuse; the helper must return null, not throw.
  const m = require("../src/tools/mediaTools");
  const hit = await m.searchYt("zzzz_impossible_nonexistent_song_987654");
  // Either a hit or null — must NOT throw.
  assert.ok(hit === null || (hit && typeof hit.url === "string"));
});
