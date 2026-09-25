const test = require("node:test");
const assert = require("node:assert/strict");
const userMediaStore = require("../src/tools/userMediaStore");

test("userMediaStore manages watchlist", () => {
  const ownerId = "session:test_user_1";
  const item = { type: "anime", id: "100", title: "Test Anime", cover: "http://cover.jpg" };

  userMediaStore.addToWatchlist(ownerId, item);
  const watchlist = userMediaStore.getWatchlist(ownerId);
  assert.equal(watchlist.length, 1);
  assert.equal(watchlist[0].title, "Test Anime");

  const removed = userMediaStore.removeFromWatchlist(ownerId, "anime", "100");
  assert.ok(removed);
  assert.equal(userMediaStore.getWatchlist(ownerId).length, 0);
});

test("userMediaStore manages history and continue watching", () => {
  const ownerId = "session:test_user_2";
  const item = { type: "movie", id: "inception", title: "Inception", episode: 1, position: 120, duration: 3600 };

  userMediaStore.recordHistory(ownerId, item);
  const history = userMediaStore.getHistory(ownerId);
  assert.equal(history.length, 1);

  userMediaStore.updateProgress(ownerId, item);
  const continueList = userMediaStore.getContinueWatching(ownerId);
  assert.equal(continueList.length, 1);
  assert.equal(continueList[0].position, 120);
});
