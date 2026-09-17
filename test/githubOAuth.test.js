const test = require("node:test");
const assert = require("node:assert/strict");
const oauth = require("../src/tools/githubOAuth");

test("GitHub OAuth parses JSON and form-encoded device responses", () => {
  assert.deepEqual(oauth._test.parseTokenResponse({ access_token: "gho_example" }), { access_token: "gho_example" });
  assert.deepEqual(oauth._test.parseTokenResponse("error=authorization_pending&error_description=wait"), { error: "authorization_pending", error_description: "wait" });
});

test("GitHub OAuth cancellation removes pending state", () => {
  const user = "oauth-test@s.whatsapp.net";
  oauth._test.pending.set(user, { timer: null });
  assert.equal(oauth.cancelDeviceFlow(user), true);
  assert.equal(oauth._test.pending.has(user), false);
  assert.equal(oauth.cancelDeviceFlow(user), false);
});
