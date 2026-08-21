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

test("botSettings: NSFW explicit on/off is idempotent and chat-scoped", () => {
  wipe();
  delete require.cache[require.resolve("../src/utils/botSettings")];
  const bs = require("../src/utils/botSettings");
  assert.strictEqual(bs.isNsfwEnabled("chat-a"), false);
  assert.strictEqual(bs.setNsfw(true, "chat-a"), true);
  assert.strictEqual(bs.setNsfw(true, "chat-a"), true, "repeating on stays on");
  assert.strictEqual(bs.isNsfwEnabled("chat-a"), true);
  assert.strictEqual(bs.isNsfwEnabled("chat-b"), false, "another chat stays off");
  assert.strictEqual(bs.setNsfw(false, "chat-a"), false);
  assert.strictEqual(bs.setNsfw(false, "chat-a"), false, "repeating off stays off");
  wipe();
});

test("commandRouter: natural Aria nsfw on resolves to explicit enable", () => {
  const cr = require("../src/utils/commandRouter");
  const resolved = cr.resolveNaturalAction("Aria nsfw on");
  assert.ok(resolved, "natural command resolves");
  assert.strictEqual(resolved.intent, "nsfw");
  assert.strictEqual(resolved.args, "on");
});
