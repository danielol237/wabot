const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const modulePath = path.resolve(__dirname, "../src/utils/sessionPersistence.js");

function enabledWith(vars) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const script = `process.stdout.write(String(require(${JSON.stringify(modulePath)}).syncEnabled()))`;
  const result = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() === "true";
}

test("session persistence requires the dedicated GitHub session token", () => {
  const base = {
    SESSION_GIT_REPO: "danielol237/aria-whatsapp-session",
    SESSION_ENCRYPT_KEY: "a".repeat(32),
  };
  assert.equal(enabledWith({ ...base, SESSION_GITHUB_TOKEN: "session-token", GITHUB_TOKEN: undefined }), true);
  assert.equal(enabledWith({ ...base, SESSION_GITHUB_TOKEN: undefined, GITHUB_TOKEN: "generic-token" }), false);
});
