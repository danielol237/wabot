const test = require("node:test");
const assert = require("node:assert/strict");
const vault = require("../src/tools/githubCredentialVault");

test.afterEach(() => {
  vault.clearToken();
  vault.clearTokenForUser("11111@s.whatsapp.net");
  vault.clearTokenForUser("22222@s.whatsapp.net");
  vault.clearWorkspaceForUser("11111@s.whatsapp.net");
  vault.clearWorkspaceForUser("22222@s.whatsapp.net");
});

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

test("GitHub vault isolates persistent credentials by WhatsApp user", () => {
  vault.setTokenForUser("11111@s.whatsapp.net", "ghp_abcdefghijklmnopqrstuvwxyz123456");
  vault.setTokenForUser("22222@s.whatsapp.net", "github_pat_abcdefghijklmnopqrstuvwxyz123456");
  assert.equal(vault.getTokenForUser("11111@s.whatsapp.net"), "ghp_abcdefghijklmnopqrstuvwxyz123456");
  assert.equal(vault.getTokenForUser("22222@s.whatsapp.net"), "github_pat_abcdefghijklmnopqrstuvwxyz123456");
  vault.clearTokenForUser("11111@s.whatsapp.net");
  assert.equal(vault.getTokenForUser("11111@s.whatsapp.net"), "");
  assert.equal(vault.getTokenForUser("22222@s.whatsapp.net"), "github_pat_abcdefghijklmnopqrstuvwxyz123456");
});

test("GitHub workspaces are isolated per WhatsApp user", () => {
  vault.setWorkspaceForUser("11111@s.whatsapp.net", "alice/project-one");
  vault.setWorkspaceForUser("22222@s.whatsapp.net", "bob/project-two");
  assert.equal(vault.getWorkspaceForUser("11111@s.whatsapp.net"), "alice/project-one");
  assert.equal(vault.getWorkspaceForUser("22222@s.whatsapp.net"), "bob/project-two");
  vault.clearWorkspaceForUser("11111@s.whatsapp.net");
  assert.equal(vault.getWorkspaceForUser("11111@s.whatsapp.net"), "");
  assert.equal(vault.getWorkspaceForUser("22222@s.whatsapp.net"), "bob/project-two");
});
