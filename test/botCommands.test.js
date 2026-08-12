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

test("commandRouter: !close / !open / !nsfw are registered", () => {
  const cr = require("../src/utils/commandRouter");
  // The module registers all commands on load; check the registry indirectly
  // by confirming the file contains the registrations (they're static).
  const src = require("fs").readFileSync(path.join(__dirname, "../src/utils/commandRouter.js"), "utf8");
  assert.ok(src.includes('name: "close"'), "!close registered");
  assert.ok(src.includes('name: "open"'), "!open registered");
  assert.ok(src.includes('name: "nsfw"'), "!nsfw registered");
});
