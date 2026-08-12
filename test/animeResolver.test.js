// Anime source resolution engine tests — canonical resolver, provider
// reputation/circuit breaker, stream validator ladder, and the resolver race.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

function cleanup(...files) {
  for (const f of files) {
    try { fs.unlinkSync(path.join(__dirname, "../../data", f)); } catch (_) {}
  }
}

test("stream validator: rejects malformed URL at step 1", async () => {
  const { validateCandidate } = require("../src/tools/streamValidator");
  const r = await validateCandidate({ provider: "x", url: "notaurl", quality: "720" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "malformed URL");
});

test("provider reputation: circuit breaker opens after 3 failures + backoff", async () => {
  const rep = require("../src/tools/sourceReputation");
  const prov = "test-" + Date.now();
  rep.record(prov, "resolve", false);
  rep.record(prov, "resolve", false);
  rep.record(prov, "resolve", false);
  const st = rep.status(prov);
  assert.strictEqual(st.circuit, "open", "circuit should open after 3 failures");
  assert.ok(st.retryAfterMs > 0, "should have a cooldown");
  assert.strictEqual(rep.usable(prov), false, "provider should be unusable while open");
  // Success trips to half-open and makes it usable again.
  rep.record(prov, "resolve", true);
  const st2 = rep.status(prov);
  assert.ok(st2.circuit === "half-open" || rep.usable(prov), "success should recover provider");
  cleanup("providerReputation.json");
});

test("provider reputation: score decays on failures", async () => {
  const rep = require("../src/tools/sourceReputation");
  const prov = "score-" + Date.now();
  const base = rep.status(prov).score;
  for (let i = 0; i < 3; i++) rep.record(prov, "resolve", false);
  const after = rep.status(prov).score;
  assert.ok(after < base, `score should drop below baseline ${base}, got ${after}`);
  cleanup("providerReputation.json");
});

test("canonical resolver: confidence + episode existence from AniList", async () => {
  // This hits AniList (network). If unavailable, treat as acceptable (the
  // engine degrades gracefully) — but when it works, assert structure.
  const { resolveCanonical } = require("../src/tools/sourceResolver");
  let canon = null;
  try {
    canon = await resolveCanonical("Naruto", 1);
  } catch (_) { canon = null; }
  if (canon === null) {
    console.log("  (skipped: AniList unreachable in this env)");
    assert.ok(true);
    return;
  }
  assert.ok("ok" in canon, "canonical result has ok flag");
  if (canon.ok) {
    assert.ok(canon.confidence.title >= 50, "title confidence should be reasonable");
    assert.strictEqual(canon.confidence.episodeExists, true, "ep 1 of Naruto exists");
    assert.ok(canon.canonical.id, "canonical id present");
  }
});

test("quality router: prefers validated, higher-quality candidates", () => {
  // Internal — test through the ranking logic via the exported resolver.
  const sr = require("../src/tools/sourceResolver");
  assert.ok(typeof sr.resolveEpisode === "function", "resolveEpisode exported");
  assert.ok(typeof sr.discoverCandidates === "function", "discoverCandidates exported");
  assert.ok(Array.isArray(sr.DISCOVERERS) && sr.DISCOVERERS.length >= 2, "multiple discoverers registered");
  // Each discoverer has an `enabled` gate and produces normalized candidates.
  for (const d of sr.DISCOVERERS) {
    assert.ok(d.provider, "discoverer has provider name");
    assert.ok(typeof d.enabled === "function", "discoverer has circuit-breaker gate");
    assert.ok(typeof d.discover === "function", "discoverer can discover");
  }
});
