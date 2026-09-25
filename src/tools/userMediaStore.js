// ARIA User Media Store — Server-side persistence for Watchlist, History, and Continue Watching position.
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/userMediaState.json");

let store = {
  watchlist: new Map(), // ownerId -> Map(mediaKey -> item)
  history: new Map(),   // ownerId -> Map(mediaKey -> item)
  continueWatching: new Map(), // ownerId -> Map(mediaKey -> item)
};

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data.watchlist) {
      for (const [ownerId, items] of Object.entries(data.watchlist)) {
        store.watchlist.set(ownerId, new Map(Object.entries(items)));
      }
    }
    if (data.history) {
      for (const [ownerId, items] of Object.entries(data.history)) {
        store.history.set(ownerId, new Map(Object.entries(items)));
      }
    }
    if (data.continueWatching) {
      for (const [ownerId, items] of Object.entries(data.continueWatching)) {
        store.continueWatching.set(ownerId, new Map(Object.entries(items)));
      }
    }
  } catch (_) {}
}

function persistStore() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const out = {
      watchlist: {},
      history: {},
      continueWatching: {},
    };
    for (const [ownerId, items] of store.watchlist.entries()) {
      out.watchlist[ownerId] = Object.fromEntries(items.entries());
    }
    for (const [ownerId, items] of store.history.entries()) {
      out.history[ownerId] = Object.fromEntries(items.entries());
    }
    for (const [ownerId, items] of store.continueWatching.entries()) {
      out.continueWatching[ownerId] = Object.fromEntries(items.entries());
    }
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (_) {}
}

loadStore();

function getOwnerMap(storeMap, ownerId) {
  if (!storeMap.has(ownerId)) {
    storeMap.set(ownerId, new Map());
  }
  return storeMap.get(ownerId);
}

const userMediaStore = {
  // Watchlist
  getWatchlist(ownerId) {
    const map = getOwnerMap(store.watchlist, ownerId);
    return [...map.values()].sort((a, b) => b.addedAt - a.addedAt);
  },

  addToWatchlist(ownerId, item) {
    if (!item || !item.id || !item.type) return false;
    const key = `${item.type}:${item.id}`;
    const map = getOwnerMap(store.watchlist, ownerId);
    map.set(key, { ...item, addedAt: Date.now() });
    persistStore();
    return true;
  },

  removeFromWatchlist(ownerId, type, id) {
    const key = `${type}:${id}`;
    const map = getOwnerMap(store.watchlist, ownerId);
    const removed = map.delete(key);
    if (removed) persistStore();
    return removed;
  },

  // History
  getHistory(ownerId) {
    const map = getOwnerMap(store.history, ownerId);
    return [...map.values()].sort((a, b) => b.watchedAt - a.watchedAt);
  },

  recordHistory(ownerId, item) {
    if (!item || !item.id || !item.type) return false;
    const key = `${item.type}:${item.id}:${item.episode || 1}`;
    const map = getOwnerMap(store.history, ownerId);
    map.set(key, { ...item, watchedAt: Date.now() });
    persistStore();
    return true;
  },

  clearHistory(ownerId) {
    const map = getOwnerMap(store.history, ownerId);
    map.clear();
    persistStore();
    return true;
  },

  // Continue Watching
  getContinueWatching(ownerId) {
    const map = getOwnerMap(store.continueWatching, ownerId);
    return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  },

  updateProgress(ownerId, item) {
    if (!item || !item.id || !item.type) return false;
    const key = `${item.type}:${item.id}`;
    const map = getOwnerMap(store.continueWatching, ownerId);
    map.set(key, {
      ...item,
      position: item.position || 0,
      duration: item.duration || 0,
      episode: item.episode || 1,
      updatedAt: Date.now(),
    });
    persistStore();
    return true;
  },

  removeContinueWatching(ownerId, type, id) {
    const key = `${type}:${id}`;
    const map = getOwnerMap(store.continueWatching, ownerId);
    const removed = map.delete(key);
    if (removed) persistStore();
    return removed;
  }
};

module.exports = userMediaStore;
