const test = require("node:test");
const assert = require("node:assert/strict");
const plugin = require("../plugins/githubEngineering");
const { findPluginCommand } = require("../src/utils/pluginLoader");

test("GitHub engineering plugin is owner-only and exposes safe aliases", () => {
  assert.equal(plugin.ownerOnly, true);
  const github = findPluginCommand([plugin], "github");
  const gh = findPluginCommand([plugin], "gh");
  const codechange = findPluginCommand([plugin], "codechange");
  assert.equal(github.ownerOnly, true);
  assert.equal(github.canonicalName, "github");
  assert.equal(gh.canonicalName, "github");
  assert.equal(codechange.canonicalName, "github");
});

test("GitHub engineering help documents the ordered approval workflow", () => {
  const help = plugin._test.commandHelp();
  assert.match(help, /Plan/);
  assert.match(help, /Approve/);
  assert.match(help, /Verify/);
  assert.match(help, /Merge/);
  assert.match(help, /never writes directly to main/i);
});

test("GitHub plugin normalizes array arguments without losing the request", () => {
  assert.equal(plugin._test.text(["plan", "add", "tests"]), "plan add tests");
  assert.equal(plugin._test.text([]), "");
});
