const test = require("node:test");
const assert = require("node:assert/strict");
const vault = require("../src/tools/githubCredentialVault");

test.afterEach(() => vault.clearToken());

test("GitHub vault accepts supported token formats without exposing them in status", () => {
  assert.equal(vault.looksLikeGitHubToken("ghp_abcdefghijklmnopqrstuvwxyz123456"), true);
  assert.equal(vault.looksLikeGitHubToken("github_pat_abcdefghijklmnopqrstuvwxyz123456"), true);
  const result = vault.setToken("ghp_abcdefghijklmnopqrstuvwxyz123456", { ttlMs: 60_000 });
  assert.equal(result.success, true);
  assert.equal(vault.getToken(), "ghp_abcdefghijklmnopqrstuvwxyz123456");
  assert.deepEqual(vault.status().source, "private-whatsapp");
  assert.equal(vault.status().token, undefined);
});

test("GitHub vault rejects arbitrary text and clears credentials", () => {
  assert.equal(vault.setToken("not-a-token").success, false);
  vault.setToken("ghp_abcdefghijklmnopqrstuvwxyz123456", { ttlMs: 60_000 });
  vault.clearToken();
  assert.equal(vault.getToken(), "");
  assert.equal(vault.status().configured, false);
});

test("GitHub vault expires short-lived credentials", async () => {
  vault.setToken("ghp_abcdefghijklmnopqrstuvwxyz123456", { ttlMs: 60_000 });
  const originalNow = Date.now;
  Date.now = () => originalNow() + 61_000;
  try {
    assert.equal(vault.getToken(), "");
    assert.equal(vault.status().configured, false);
  } finally {
    Date.now = originalNow;
  }
});
