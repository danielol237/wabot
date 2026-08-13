const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

function boot() {
  const app = express();
  app.use("/anime", require("../src/animeSite"));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}/anime`, server }));
  });
}

test("anime download status route returns a stable page for a tracked job", async () => {
  const { enqueueAnimeJob } = require("../src/tools/animeJobManager");
  const { base, server } = await boot();
  try {
    const job = enqueueAnimeJob({ name: "One Piece", episode: 1, quality: "best", sock: null, chatId: null, quotedMsg: null });
    const response = await fetch(`${base}/dl/21?prov=anilist&ep=1&job=${encodeURIComponent(job.id)}`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes(job.id));
    assert.ok(html.includes("Status"));
  } finally {
    server.close();
  }
});
