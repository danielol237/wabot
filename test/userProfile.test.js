const test = require("node:test");
const assert = require("node:assert");

// Regression test for audit #18: the unified UserProfile service must read
// across all memory stores and return a coherent profile + context string
// without throwing, and it must be resilient if a store is missing/empty.
test("userProfile: readStores returns a coherent profile object", () => {
  const { readStores } = require("../src/utils/userProfile");
  const p = readStores("test-user-profile-1@lid");
  // Every key exists; per-store guards mean a cold/empty user still yields a
  // well-formed object (no throw), with arrays where the consumer expects arrays.
  assert.ok(p, "readStores returns an object");
  assert.ok("userMemory" in p && "preferences" in p && "facts" in p && "profile" in p && "world" in p,
    "profile has all consolidated sections");
  assert.ok(Array.isArray(p.preferences), "preferences is an array");
  assert.ok(Array.isArray(p.facts), "facts is an array");
  assert.ok(p.raw && typeof p.raw === "object", "raw store reads are exposed");
});

test("userProfile: buildUserContext returns a stable context string", () => {
  const { buildUserContext } = require("../src/utils/userProfile");
  const out = buildUserContext("test-user-profile-2@lid", "hello aria");
  assert.ok(out && typeof out === "object", "returns { context, profile }");
  assert.strictEqual(typeof out.context, "string", "context is a string");
  assert.ok("profile" in out, "profile is included for downstream consumers");
  // Deterministic: same inputs => same output (no randomness or timing jitter).
  const again = buildUserContext("test-user-profile-2@lid", "hello aria");
  assert.strictEqual(again.context, out.context, "context is deterministic");
});
