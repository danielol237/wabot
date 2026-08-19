const assert = require("node:assert/strict");
const test = require("node:test");
const { loadPlugins, findPluginCommand, resolvePluginHandler } = require("../src/utils/pluginLoader");

function enhancedPlugin() {
  const plugin = loadPlugins().find((item) => item.name === "enhanced");
  assert.ok(plugin, "enhanced plugin should load");
  return plugin;
}

test("plugin loader resolves callable string aliases", () => {
  const plugin = enhancedPlugin();
  for (const alias of ["song", "youtube", "manhwa", "novel", "sticker"]) {
    const found = findPluginCommand([plugin], alias);
    assert.equal(typeof found?.handler, "function", `${alias} should resolve to a function`);
  }
  assert.equal(resolvePluginHandler({ loop: "loop" }, "loop"), null, "alias cycles are rejected");
});

test("plugin loader marks sensitive enhanced commands owner-only", () => {
  const plugin = enhancedPlugin();
  for (const command of ["run", "agent", "team", "generateplugin", "backup", "restore", "githubadmin", "plugins", "vpn", "job", "workspace", "resume", "evolve", "analytics"]) {
    const found = findPluginCommand([plugin], command);
    assert.equal(found?.ownerOnly, true, `${command} should be owner-only`);
  }
  assert.equal(findPluginCommand([plugin], "music")?.ownerOnly, false, "ordinary media command remains available");
});

test("enhanced plugin keeps message scheduling and anime schedule as separate commands", () => {
  const plugin = enhancedPlugin();
  assert.equal(typeof plugin.commands.messageschedule, "function");
  assert.equal(plugin.commands.msgschedule, "messageschedule");
  assert.equal(typeof plugin.commands.animeschedule, "function");
  assert.equal(Object.keys(plugin.commands).filter((name) => name === "say").length, 1);
});

test("enhanced lottery uses the sender context without throwing", async () => {
  const plugin = enhancedPlugin();
  const replies = [];
  await plugin.commands.lottery({}, { key: { remoteJid: "audit-chat" } }, [], {
    senderJid: "audit-user",
    reply: (text) => { replies.push(String(text)); },
    react: () => Promise.resolve(),
  });
  assert.ok(replies.length >= 1, "lottery should reply");
  assert.ok(!replies.some((text) => /lottery error/i.test(text)), "lottery should not hit its error path");
});
