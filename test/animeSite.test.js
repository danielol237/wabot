const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
process.env.ANIME_DISABLE_WORKER = "1";

function boot() {
  const app = express();
  app.use("/anime", require("../src/animeSite"));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}/anime`, server }));
  });
}

test("anime home exposes account entry and clear catalog actions", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes("Learner sign in"));
    assert.ok(html.includes("Search anime"));
    assert.ok(html.includes("Browse catalog"));
  } finally {
    server.close();
  }
});

test("anime home renders poster artwork with a safe fallback wrapper", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.match(html, /artwork-(?:card|hero)/);
    assert.match(html, /img\.anili\.st\/media|fallback-art/);
  } finally {
    server.close();
  }
});

test("curated title preserves episode metadata and renders episode actions", async () => {
  const { base, server } = await boot();
  try {
    const query = new URLSearchParams({ prov: "curated", title: "One Piece", cover: "https://img.anili.st/media/21", episodes: "2", type: "TV" });
    const response = await fetch(`${base}/title/curated-one-piece?${query}`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes("artwork-poster"));
    assert.ok(html.includes("Episode 1"));
    assert.ok(html.includes("Download"));
  } finally {
    server.close();
  }
});

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


test("anime public download status preserves the requested quality", async () => {
  const { enqueueAnimeJob } = require("../src/tools/animeJobManager");
  const { base, server } = await boot();
  try {
    const job = enqueueAnimeJob({ name: "One Piece", episode: 1, quality: "720", sock: null, chatId: null, quotedMsg: null });
    const response = await fetch(`${base}/dl/21?prov=anilist&ep=1&quality=720&job=${encodeURIComponent(job.id)}`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes("Requested quality"));
    assert.ok(html.includes("720p"));
    assert.ok(html.includes("validated authorized source"));
  } finally {
    server.close();
  }
});


test("anime download: dependency failures explain recovery without exposing a raw-only error", async () => {
  const { enqueueAnimeJob, getJob } = require("../src/tools/animeJobManager");
  const { base, server } = await boot();
  try {
    const job = enqueueAnimeJob({ name: "One Piece", episode: 1, quality: "720", sock: null, chatId: null, quotedMsg: null });
    const tracked = getJob(job.id);
    tracked.status = "failed";
    tracked.error = { code: "DEPENDENCY_MISSING", message: "Anime downloads are unavailable because yt-dlp is not installed." };
    const response = await fetch(`${base}/dl/21?prov=anilist&ep=1&quality=720&job=${encodeURIComponent(job.id)}`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes("Media runtime is not ready"));
    assert.ok(html.includes("The deployment has not passed its media-runtime check yet"));
    assert.ok(html.includes("Retry download"));
    assert.ok(html.includes("DEPENDENCY_MISSING"));
  } finally {
    server.close();
  }
});

test("anime fallback title preserves metadata and manual media controls", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/title/curated-one-piece?prov=curated&title=One%20Piece`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes("One Piece"));
    assert.ok(html.includes("Featured"));
    assert.ok(html.includes("manual-ep"));
    assert.ok(html.includes("Download"));
    assert.ok(html.includes("fallback-art"));
    assert.ok(html.includes("Source-ready metadata"));
    assert.ok(!html.includes("Untitled"));
  } finally {
    server.close();
  }
});

test("anime V11: home exposes persistent dark/light theme controls", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes('id="theme-toggle"'));
    assert.ok(html.includes("aria-anime-theme"));
    assert.ok(html.includes('data-theme="dark"'));
  } finally {
    server.close();
  }
});

test("anime V11: public download session survives the redirect and rejects a different session", async () => {
  const { base, server } = await boot();
  try {
    const first = await fetch(`${base}/dl/21?prov=anilist&ep=1&quality=360`, { redirect: "manual" });
    assert.strictEqual(first.status, 302);
    const cookie = String(first.headers.get("set-cookie") || "").split(";")[0];
    assert.match(cookie, /^aria_anime_sid=/);
    const location = new URL(first.headers.get("location"), base).toString();
    const sameSession = await fetch(location, { headers: { cookie } });
    assert.strictEqual(sameSession.status, 200);
    const differentSession = await fetch(location);
    assert.strictEqual(differentSession.status, 403);
  } finally {
    server.close();
  }
});
