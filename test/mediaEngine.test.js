const test = require("node:test");
const assert = require("node:assert/strict");
const { BaseMediaProvider, registry } = require("../src/tools/mediaProvider");
const mediaEngine = require("../src/tools/mediaEngine");

test("BaseMediaProvider throws unimplemented errors", async () => {
  const provider = new BaseMediaProvider({ id: "test", name: "Test Provider" });
  assert.equal(provider.id, "test");
  await assert.rejects(async () => provider.search("query"), /search\(\) not implemented/);
});

test("ProviderRegistry registers and retrieves providers", () => {
  const provider = new BaseMediaProvider({ id: "test_reg", name: "Test Reg", category: "anime" });
  registry.register(provider);
  assert.equal(registry.get("test_reg"), provider);
  const animeProviders = registry.getAllForCategory("anime");
  assert.ok(animeProviders.includes(provider));
});

test("mediaEngine retrieves trending items", async () => {
  const trendingMovies = await mediaEngine.getTrending("movie");
  assert.ok(Array.isArray(trendingMovies));
  assert.ok(trendingMovies.length > 0);
  assert.equal(trendingMovies[0].type, "movie");
});

test("mediaEngine searchGlobal returns matching items", async () => {
  const results = await mediaEngine.searchGlobal("Inception");
  assert.ok(Array.isArray(results));
  assert.ok(results.some(r => r.title === "Inception"));
});
