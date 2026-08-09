// ── ARIA Memory Curator ─────────────────────────────────────────
// A background maintenance pass that keeps long-term memory clean and smart:
//  - Expires old low-importance memories (facts fade after a while).
//  - Collapses near-duplicate memories.
//  - Caps the store size so it never grows unbounded.
//  - Returns a report of what was pruned so ARIA can surface it.

const { error } = require("../utils/logger");

let curatorTimer = null;
const CURATOR_INTERVAL_MS = 60 * 60 * 1000; // once an hour

const DAY = 1000 * 60 * 60 * 24;
const MAX_MEMORIES_PER_USER = 200;
const LOW_IMPORTANCE_TTL_DAYS = 30;      // importance 1 facts fade after a month
const MED_IMPORTANCE_TTL_DAYS = 120;     // importance 2 last ~4 months
const HIGH_IMPORTANCE_TTL_DAYS = 365;    // importance 3 (events/deadlines) last a year

function ttlFor(importance) {
  const i = Number(importance) || 1;
  if (i >= 3) return HIGH_IMPORTANCE_TTL_DAYS;
  if (i === 2) return MED_IMPORTANCE_TTL_DAYS;
  return LOW_IMPORTANCE_TTL_DAYS;
}

// Prune one user's memory store. Returns a report of what changed.
function curateUserStore(store) {
  const now = Date.now();
  const before = store.memories ? store.memories.length : 0;
  const expired = [];

  if (!store.memories || store.memories.length === 0) return { removed: 0, expired: 0, collapsed: 0, before, after: before };

  // 1. Remove expired memories (unless high importance / pinned)
  store.memories = store.memories.filter((m) => {
    const pinned = m.pinned === true;
    if (pinned) return true;
    const age = now - (m.ts || now);
    const ttl = ttlFor(m.importance) * DAY;
    if (age > ttl) {
      expired.push(m.text);
      return false;
    }
    return true;
  });

  // 2. Collapse near-duplicate memories (same keywords, close in time)
  const collapsed = [];
  const seen = new Map(); // keyword signature -> memory
  const deduped = [];
  for (const m of store.memories) {
    const sig = (m.keywords || []).slice(0, 4).join("|");
    if (sig && seen.has(sig)) {
      // Keep the higher-importance one
      collapsed.push(m.text);
      const existing = seen.get(sig);
      if ((m.importance || 1) > (existing.importance || 1)) {
        // replace existing with this one
        const idx = deduped.indexOf(existing);
        if (idx >= 0) deduped[idx] = m;
        seen.set(sig, m);
      }
    } else {
      seen.set(sig, m);
      deduped.push(m);
    }
  }
  store.memories = deduped;

  // 3. Cap the store size (keep most recent)
  if (store.memories.length > MAX_MEMORIES_PER_USER) {
    store.memories = store.memories.slice(-MAX_MEMORIES_PER_USER);
  }

  const after = store.memories.length;
  return { removed: before - after, expired: expired.length, collapsed: collapsed.length, before, after };
}

// Run the curator across every user store. Returns a global report.
function runCurator(semanticMemory) {
  try {
    if (!semanticMemory || typeof semanticMemory.getAllStores !== "function") {
      return { users: 0, removed: 0, expired: 0, collapsed: 0 };
    }
    const db = semanticMemory.getAllStores() || {};
    const users = Object.keys(db);
    let removed = 0, expired = 0, collapsed = 0;
    for (const uid of users) {
      const store = db[uid];
      if (store && typeof store === "object") {
        const r = curateUserStore(store);
        removed += r.removed;
        expired += r.expired;
        collapsed += r.collapsed;
      }
    }
    if (typeof semanticMemory.save === "function") semanticMemory.save();
    return { users: users.length, removed, expired, collapsed };
  } catch (err) {
    error("Memory curator error:", err.message);
    return { users: 0, removed: 0, expired: 0, collapsed: 0 };
  }
}

// Run the curator on a schedule. Cheap enough to do hourly.
function startCurator() {
  if (curatorTimer) clearInterval(curatorTimer);
  const run = () => {
    try {
      const semanticMemory = require("../utils/semanticMemory");
      const report = runCurator(semanticMemory);
      if (report.removed > 0) {
        require("../utils/eventLog").track("memory", `Memory curator pruned ${report.removed} stale memory(ies)`);
      }
    } catch (err) {
      error("Memory curator run failed:", err.message);
    }
  };
  // Run once shortly after start, then on the interval.
  setTimeout(run, 30 * 1000);
  curatorTimer = setInterval(run, CURATOR_INTERVAL_MS);
  if (curatorTimer.unref) curatorTimer.unref();
  return curatorTimer;
}

function stopCurator() {
  if (curatorTimer) { clearInterval(curatorTimer); curatorTimer = null; }
}

module.exports = { runCurator, curateUserStore, startCurator, stopCurator };
