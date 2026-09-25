const test = require("node:test");
const assert = require("node:assert/strict");
const animePahe = require("../src/tools/animePaheScraper");

test("animePahe module exports expected functions", () => {
  assert.equal(typeof animePahe.searchPahe, "function");
  assert.equal(typeof animePahe.getPaheEpisodes, "function");
  assert.equal(typeof animePahe.paheGetStream, "function");
});
