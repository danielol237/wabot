const fs = require("fs");
const path = require("path");

const PLUGINS_DIR = path.join(__dirname, "../../plugins");

if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });

// Loads every .js file in /plugins at startup. Each plugin file must export:
//   { name: string, commands: { [commandName]: async (sock, msg, args, ctx) => {} } }
// "ctx" gives plugins access to shared things they might need (chatId, senderJid,
// reply helper) without each plugin having to reimplement message parsing.
//
// This loads from local files only — there's no "install from URL" or "eval
// downloaded code" path here. Adding a plugin means putting a .js file in this
// folder yourself (via SSH/nano), same trust level as editing any other file
// in the project. That's a deliberate choice, not an oversight.
function loadPlugins() {
  const loaded = [];
  const files = fs.readdirSync(PLUGINS_DIR).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    try {
      const pluginPath = path.join(PLUGINS_DIR, file);
      const plugin = require(pluginPath);
      const { log, error, warn } = require("./logger");

      if (!plugin.name || !plugin.commands) {
        error(`Plugin ${file} is missing required "name" or "commands" export, skipping.`);
        continue;
      }

      loaded.push(plugin);
      log(`🧩 Loaded plugin: ${plugin.name} (${Object.keys(plugin.commands).join(", ")})`);
    } catch (err) {
      // A broken plugin should never take down the whole bot — log it and move on
      error(`Failed to load plugin ${file}:`, err.message);
    }
  }

  return loaded;
}

// Checks if a command (without prefix) matches any loaded plugin, returns the
// handler function if so, otherwise null.
function findPluginCommand(loadedPlugins, commandName) {
  for (const plugin of loadedPlugins) {
    if (plugin.commands[commandName]) {
      return { plugin, handler: plugin.commands[commandName] };
    }
  }
  return null;
}

module.exports = { loadPlugins, findPluginCommand, PLUGINS_DIR };
