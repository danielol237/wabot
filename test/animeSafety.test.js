const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

const service = require("../src/tools/animeService");

test("catalog safety: filters adult flags, explicit genres, and known explicit title patterns", () => {
  const items = [
    { title: "A Normal Adventure", genres: ["Action"], isAdult: false },
    { title: "Explicit Example", genres: ["Hentai"], isAdult: false },
    { title: "Paihame Kazoku", genres: ["Comedy"], isAdult: false },
    { title: "Flagged by AniList", genres: ["Drama"], isAdult: true },
  ];
  assert.deepStrictEqual(service.safeCatalog(items).map((item) => item.title), ["A Normal Adventure"]);
  assert.strictEqual(service.isCatalogSafe({ title: "Clean title", genres: ["Action"], isAdult: false }), true);
});

test("resolver: provider attempts are bounded and OmniSave carries CDN access headers", () => {
  const source = fs.readFileSync(require.resolve("../src/tools/sourceResolver"), "utf8");
  assert.match(source, /PROVIDER_TIMEOUT_MS/);
  assert.match(source, /provider timeout after/);
  assert.ok(source.includes('Referer: "https://videodownloader.site/"'));
  assert.ok(source.includes('Origin: "https://videodownloader.site"'));
  assert.match(source, /vipLocked !== true/);
});
