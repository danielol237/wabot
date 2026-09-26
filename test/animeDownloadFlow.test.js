const test = require("node:test");
const assert = require("node:assert/strict");
const { enqueueAnimeJob, getJob, snapshot } = require("../src/tools/animeJobManager");
const userMediaStore = require("../src/tools/userMediaStore");

test("anime download flow end-to-end job lifecycle and store tracking", () => {
  const ownerId = "session:test_e2e_user";

  // 1. Record watchlist and continue watching progress
  userMediaStore.addToWatchlist(ownerId, { type: "anime", id: "1", title: "Test Anime" });
  userMediaStore.updateProgress(ownerId, { type: "anime", id: "1", title: "Test Anime", episode: 1, quality: "720" });

  const wl = userMediaStore.getWatchlist(ownerId);
  assert.equal(wl.length, 1);
  assert.equal(wl[0].title, "Test Anime");

  // 2. Queue anime download job
  const job = enqueueAnimeJob({
    name: "Test Anime",
    episode: 1,
    preferred: "anilist",
    quality: "720",
    ownerId,
    sessionId: ownerId,
    createdBy: "e2e-test",
  });

  assert.ok(job.id);
  assert.equal(job.ownerId, ownerId);

  // 3. Retrieve queued job
  const retrieved = getJob(job.id);
  assert.ok(retrieved);
  assert.equal(retrieved.name, "Test Anime");

  // 4. Verify snapshot includes queued/running/recent job
  const snap = snapshot();
  assert.ok(
    snap.current.some((j) => j.id === job.id) ||
    snap.queued.some((j) => j.id === job.id) ||
    snap.recent.some((j) => j.id === job.id)
  );
});
