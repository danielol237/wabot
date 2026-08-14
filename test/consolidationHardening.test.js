const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

process.env.ANIME_DISABLE_WORKER = "1";
process.env.MEDIA_PROXY_SECRET = "test-media-secret";
process.env.PORTAL_SESSION_SECRET = "test-portal-secret";

const { validateOutboundUrl } = require("../src/utils/outboundUrlPolicy");
const { issueFileToken, verifyFileToken } = require("../src/utils/mediaAccess");
const { enqueueAnimeJob } = require("../src/tools/animeJobManager");
const reputation = require("../src/tools/sourceReputation");
const linking = require("../src/tools/portalLinking");
const semantic = require("../src/utils/semanticMemory");
const profileStore = require("../src/utils/profileStore");

const linkingFile = path.join(__dirname, "../data/portalLinks.json");
const originalLinkingFile = fs.existsSync(linkingFile) ? fs.readFileSync(linkingFile) : null;

test.after(() => {
  if (originalLinkingFile) fs.writeFileSync(linkingFile, originalLinkingFile, { mode: 0o600 });
  else if (fs.existsSync(linkingFile)) fs.unlinkSync(linkingFile);
});

test("shared outbound policy rejects private, mapped-private, and unresolved destinations", async () => {
  assert.equal((await validateOutboundUrl("http://127.0.0.1:3001")).ok, false);
  assert.equal((await validateOutboundUrl("http://[::ffff:127.0.0.1]:3001")).ok, false);
  assert.equal((await validateOutboundUrl("http://localhost:3001")).ok, false);
  assert.equal((await validateOutboundUrl("https://does-not-exist.invalid")).ok, false);
  assert.equal((await validateOutboundUrl("file:///etc/passwd")).ok, false);
});

test("file capabilities are bound to both the job and owner", () => {
  const token = issueFileToken("ANIME-owner-bound", undefined, "ip:203.0.113.10");
  assert.ok(token);
  assert.ok(verifyFileToken(token, "ANIME-owner-bound", "ip:203.0.113.10"));
  assert.equal(verifyFileToken(token, "ANIME-owner-bound", "ip:203.0.113.11"), null);
  assert.equal(verifyFileToken(token, "ANIME-other-job", "ip:203.0.113.10"), null);
});

test("public-style anime jobs retain full IDs and ownership metadata", () => {
  const job = enqueueAnimeJob({
    name: "Hardening Fixture",
    episode: 1,
    ownerId: "ip:203.0.113.20",
    sessionId: "ip:203.0.113.20",
    createdBy: "public-anime",
    sock: null,
    chatId: null,
  });
  assert.match(job.id, /^ANIME-[0-9A-F-]{36}$/);
  assert.equal(job.ownerId, "ip:203.0.113.20");
  assert.equal(job.createdBy, "public-anime");
});

test("portal link codes have 64 bits of hex entropy and expire through one-time consumption", () => {
  const issued = linking.issueCode("15551234567@s.whatsapp.net");
  assert.match(issued.code, /^[A-F0-9]{16}$/);
  assert.equal(linking.consumeCode(issued.code, "account-hardening", "203.0.113.21"), "15551234567");
  assert.equal(linking.consumeCode(issued.code, "account-hardening", "203.0.113.21"), null);
});

test("semantic memory respects opt-out, export, and clear controls", () => {
  const userId = "hardening-memory-user";
  semantic.setMemoryEnabled(userId, false);
  assert.equal(semantic.addMemory(userId, "This must not be saved."), null);
  assert.deepEqual(semantic.retrieveMemories(userId, "saved"), []);
  semantic.setMemoryEnabled(userId, true);
  const memory = semantic.addMemory(userId, "I am building a safer ARIA.", "project", 2);
  assert.ok(memory?.id);
  assert.equal(semantic.exportMemories(userId).memories.length, 1);
  semantic.clearMemories(userId);
  assert.equal(semantic.exportMemories(userId).memories.length, 0);
  delete profileStore._getDb()[userId];
  profileStore.save();
});

test("provider circuit enters open after consecutive failures", () => {
  const provider = "hardening-fixture-" + Date.now();
  reputation.record(provider, "http", false, { error: "fixture" });
  reputation.record(provider, "http", false, { error: "fixture" });
  const status = reputation.record(provider, "http", false, { error: "fixture" });
  assert.equal(status.circuit, "open");
  assert.ok(status.retryAfterMs > 0);
});
