const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

process.env.MEDIA_PROXY_SECRET = "test-media-secret-with-at-least-32-characters";
const media = require("../src/utils/mediaAccess");

test("media access: issues and verifies short-lived playback capabilities", () => {
  const token = media.issueMediaToken({
    url: "https://example.com/video.mp4",
    provider: "omnisave",
    headers: { Referer: "https://videodownloader.site/", Authorization: "must-not-pass" },
  }, 60_000);
  const payload = media.verifyMediaToken(token);
  assert.ok(payload);
  assert.strictEqual(payload.url, "https://example.com/video.mp4");
  assert.strictEqual(payload.headers.Referer, "https://videodownloader.site/");
  assert.strictEqual(payload.headers.Authorization, undefined);
});

test("media access: binds file capabilities to one job", () => {
  const token = media.issueFileToken("job-123", 60_000);
  assert.ok(media.verifyFileToken(token, "job-123"));
  assert.strictEqual(media.verifyFileToken(token, "job-456"), null);
});

test("media access: rejects non-HTTPS and private targets", async () => {
  assert.strictEqual((await media.validateMediaTarget("http://example.com/file.mp4")).ok, false);
  assert.strictEqual((await media.validateMediaTarget("https://127.0.0.1/file.mp4")).ok, false);
  assert.strictEqual((await media.validateMediaTarget("https://localhost/file.mp4")).ok, false);
});

test("anime proxies: no longer accept arbitrary user-supplied URL parameters", () => {
  const publicSite = fs.readFileSync(require.resolve("../src/animeSite"), "utf8");
  const ownerSite = fs.readFileSync(require.resolve("../src/animeBrowser"), "utf8");
  assert.doesNotMatch(publicSite, /req\.query\.u/);
  assert.doesNotMatch(ownerSite, /req\.query\.u/);
  assert.match(publicSite, /verifyMediaToken/);
  assert.match(ownerSite, /verifyMediaToken/);
});

test("pairing route: QR remains available only through dashboard auth", () => {
  const source = fs.readFileSync(require.resolve("../src/index"), "utf8");
  assert.match(source, /app\.get\("\/qr", checkAuth/);
  assert.match(source, /Pair with a code/);
  assert.match(source, /Scan with WhatsApp/);
});
