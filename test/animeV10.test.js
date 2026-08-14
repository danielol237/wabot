const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

process.env.ANIME_DISABLE_WORKER = "1";

test("anime V10: active downloads are separated by requested quality", () => {
  const manager = require("../src/tools/animeJobManager");
  const title = `V10 quality separation ${Date.now()}`;
  const low = manager.enqueueAnimeJob({ name: title, episode: 1, quality: "360", ownerId: "v10-test", sock: null, chatId: null, quotedMsg: null });
  const high = manager.enqueueAnimeJob({ name: title, episode: 1, quality: "720", ownerId: "v10-test", sock: null, chatId: null, quotedMsg: null });
  assert.strictEqual(manager.findActiveJob({ ownerId: "v10-test", name: title, episode: 1, quality: "360" })?.id, low.id);
  assert.strictEqual(manager.findActiveJob({ ownerId: "v10-test", name: title, episode: 1, quality: "720" })?.id, high.id);
  assert.notStrictEqual(low.id, high.id);
});

test("anime V10: worker boot pumps recovered queue after load", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/tools/animeJobManager.js"), "utf8");
  assert.match(source, /loadQueue\(\);[\s\S]{0,260}pump\(\);/);
});

test("anime V10: provider bundle includes bounded fallback adapters", () => {
  const consumet = require("../src/tools/animeConsumet");
  assert.ok(consumet._providers.includes("KickAssAnime"));
  assert.ok(consumet._providers.includes("AnimeSaturn"));
  assert.ok(consumet._providers.includes("AnimeUnity"));
});

test("anime V10: resolver source validates signed direct MP4s before local file delivery", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/tools/streamValidator.js"), "utf8");
  assert.match(source, /signedDirect/);
  assert.match(source, /deferred to local file validation after download/);
  assert.match(source, /HTTP probe failed:/);
});
