const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = path.join(__dirname, "../data/botSettings.json");
function wipe() { try { fs.rmSync(SETTINGS_FILE, { force: true }); } catch (_) {} }

test("botSettings: NSFW toggle persists", () => {
  wipe();
  const bs = require("../src/utils/botSettings");
  assert.strictEqual(bs.isNsfwEnabled(), false, "defaults off");
  bs.setNsfw(true);
  assert.strictEqual(bs.isNsfwEnabled(), true, "turns on");
  bs.setNsfw(false);
  assert.strictEqual(bs.isNsfwEnabled(), false, "turns off");
  // re-require a fresh module instance to confirm persistence
  bs.setNsfw(true);
  delete require.cache[require.resolve("../src/utils/botSettings")];
  const bs2 = require("../src/utils/botSettings");
  assert.strictEqual(bs2.isNsfwEnabled(), true, "persisted across reload");
  wipe();
});

test("commandRouter: !close / !open are registered + !nsfw lives in the plugin", () => {
  const cr = require("../src/utils/commandRouter");
  // The module registers all commands on load; check the registry indirectly
  // by confirming the file contains the registrations (they're static).
  const src = require("fs").readFileSync(path.join(__dirname, "../src/utils/commandRouter.js"), "utf8");
  assert.ok(src.includes('name: "close"'), "!close registered");
  assert.ok(src.includes('name: "open"'), "!open registered");
  // !nsfw was REMOVED from the core router — it lives in plugins/nsfw.js so its
  // per-chat toggle is the one the category commands actually read (fixes the
  // bug where core !nsfw said "ON" but !smallboobs still saw "off").
  const pluginSrc = require("fs").readFileSync(path.join(__dirname, "../plugins/nsfw.js"), "utf8");
  assert.ok(pluginSrc.includes('name: "nsfw"'), "!nsfw registered in the plugin");
});

test("commandRouter: natural NSFW phrases resolve to the plugin toggle operation", () => {
  const router = require("../src/utils/commandRouter");
  assert.deepStrictEqual(router._test.resolveNSFWPhrase("ARIA turn on NSFW"), { operation: "on" });
  assert.deepStrictEqual(router._test.resolveNSFWPhrase("hey Aria, enable nsfw mode"), { operation: "on" });
  assert.deepStrictEqual(router._test.resolveNSFWPhrase("ARIA turn off NSFW"), { operation: "off" });
  assert.equal(router._test.resolveNSFWPhrase("ARIA generate an image"), null);
});

test("NSFW plugin: gated categories are off by default and usage lists the available commands", () => {
  const plugin = require("../plugins/nsfw");
  plugin._test.nsfwToggles.clear();
  assert.equal(plugin._test.isNSFWEnabled("chat-a"), false);
  assert.match(plugin._test.NSFW_USAGE, /!milf/);
  assert.match(plugin._test.NSFW_USAGE, /!waifu/);
  plugin._test.nsfwToggles.set("chat-a", true);
  assert.equal(plugin._test.isNSFWEnabled("chat-a"), true);
  assert.equal(plugin._test.isNSFWEnabled("chat-b"), false);
  plugin._test.nsfwToggles.clear();
});
