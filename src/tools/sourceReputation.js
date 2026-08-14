// ── Provider Reputation + Circuit Breaker Store ──────────────────
// Persists a live score per anime provider based on real outcomes
// (search success, episode resolve, stream validate, download, HTTP
// failures, latency). Drives the Source Router: broken providers are
// automatically suppressed instead of repeatedly hammered.
//
// Circuit breaker: after N consecutive failures, a provider goes
// CIRCUIT_OPEN and is skipped for a cooldown (exponential backoff). A
// probe/success trips it back to CLOSED.
//
// Score (0-100): weighted recent outcomes.
//   search_ok, resolve_ok, validate_ok, download_ok raise it
//   HTTP errors / no-results / download-fail lower it
//   latency adds a small penalty beyond a threshold

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/providerReputation.json");

let store = { providers: {} };
function load() {
  try { store = JSON.parse(fs.readFileSync(FILE, "utf8")) || { providers: {} }; }
  catch (_) { store = { providers: {} }; }
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(FILE, JSON.stringify(store)); } catch (_) {}
  }, 1500);
}
load();

const FAIL_THRESHOLD = 3;        // consecutive failures to open the circuit
const SCORE_DECAY = 0.9;         // multiply old score each new event (recency)
const BASE = 50;

function rec(provider) {
  if (!store.providers[provider]) {
    store.providers[provider] = {
      score: BASE,
      consecutiveFailures: 0,
      circuit: "closed",          // closed | open | half-open
      openUntil: 0,
      attempts: 0,
      lastEvent: null,
      lastError: null,
      probeInFlight: false,
      // rolling tallies for the dashboard
      tally: { search: 0, resolve: 0, validate: 0, download: 0, httpErrors: 0, noResults: 0 },
    };
  }
  return store.providers[provider];
}

// Cooldown grows exponentially: 30s * 2^openCount.
function backoffMs(openCount) {
  return Math.min(30 * 60 * 1000, 30000 * Math.pow(2, Math.min(openCount || 1, 6)));
}

// Register an outcome for a provider. `type` ∈ outcome codes; `ok` bool.
// Also pass latencyMs for score shaping.
function record(provider, outcome, ok, { latencyMs, error } = {}) {
  const r = rec(provider);
  r.attempts++;
  r.lastEvent = { outcome, ok, at: Date.now() };
  if (!ok) r.lastError = error || outcome;
  r.score = Math.round(r.score * SCORE_DECAY + (ok ? 8 : -12));
  r.score = Math.max(0, Math.min(100, r.score));

  // Update tallies.
  const t = r.tally;
  if (outcome === "http") t.httpErrors += ok ? 0 : 1;
  else if (outcome === "no-results") t.noResults += ok ? 0 : 1;
  if (t[outcome] !== undefined) t[outcome] = t[outcome] + (ok ? 1 : 0);
  else if (outcome !== "http" && outcome !== "no-results") t[outcome] = (t[outcome] || 0) + (ok ? 1 : 0);

  // Latency penalty (>8s counts against).
  if (latencyMs && latencyMs > 8000) r.score = Math.max(0, r.score - 3);

  // Circuit breaker logic. A successful half-open probe closes the circuit;
  // a failed half-open probe reopens it with exponential backoff.
  if (ok) {
    r.consecutiveFailures = 0;
    r.probeInFlight = false;
    if (r.circuit === "half-open" || r.circuit === "open") {
      r.circuit = "closed";
      r.openUntil = 0;
      r.openCount = 0;
    }
  } else {
    r.consecutiveFailures++;
    if (r.consecutiveFailures >= FAIL_THRESHOLD) {
      const openCount = (r.openCount || 0) + 1;
      r.openCount = openCount;
      r.circuit = "open";
      r.probeInFlight = false;
      r.openUntil = Date.now() + backoffMs(openCount);
      r.consecutiveFailures = 0; // reset so backoff re-arms on later failures
    }
  }
  persist();
  return status(provider);
}

// Is this provider currently usable? Open circuit + still cooling down = no.
function usable(provider) {
  const r = rec(provider);
  const now = Date.now();
  if (r.circuit === "open") {
    if (now < r.openUntil) return false;
    r.circuit = "half-open";
    r.openUntil = 0;
    r.probeInFlight = false;
    persist();
  }
  if (r.circuit === "half-open") {
    if (r.probeInFlight) return false;
    r.probeInFlight = true;
    persist();
  }
  return true;
}

// Full status for routing + dashboard.
function status(provider) {
  const r = rec(provider);
  const now = Date.now();
  if (r.circuit === "open" && now >= r.openUntil) {
    r.circuit = "half-open";
    r.openUntil = 0;
    r.probeInFlight = false;
    persist();
  }
  const open = r.circuit === "open" && now < r.openUntil;
  return {
    provider,
    score: r.score,
    circuit: open ? "open" : r.circuit,
    retryAfterMs: open ? Math.max(0, r.openUntil - now) : 0,
    attempts: r.attempts,
    lastError: r.lastError,
    tally: r.tally,
  };
}

function all() {
  return Object.keys(store.providers).map((p) => status(p));
}

// Ranking: healthiest usable providers first.
function ranked() {
  return all().filter((s) => s.circuit !== "open").sort((a, b) => b.score - a.score);
}

module.exports = { record, usable, status, all, ranked, load };
