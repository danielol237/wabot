const fs = require("fs");
const path = require("path");
const { log, error, warn } = require("./logger");

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

  // Respect the plugin manager's disabled list so !disable <name> actually
  // stops a plugin from being loaded (previously it was marked disabled in
  // state but the loader still require()'d every file).
  let disabled = [];
  try {
    const pm = require("../tools/pluginMarket");
    if (pm && pm.listInstalled) {
      const installed = pm.listInstalled();
      disabled = installed.filter((p) => p.enabled === false).map((p) => p.id);
    }
  } catch (_) {}

  for (const file of files) {
    const id = file.replace(/\.js$/, "");
    if (disabled.includes(id)) {
      const { warn } = require("./logger");
      warn(`Plugin ${file} is disabled — skipping.`);
      continue;
    }
    try {
      const pluginPath = path.join(PLUGINS_DIR, file);
      const plugin = require(pluginPath);
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

// Plugin commands that execute code, mutate server state, expose private data,
// or alter integrations must remain owner-only even though plugins are loaded
// through the general command path.
const OWNER_ONLY_COMMANDS = new Set([
  "agent", "team", "run", "generateplugin", "backup", "restore", "githubadmin",
  "plugins", "vpn", "job", "workspace", "resume", "evolve", "analytics",
]);

function resolvePluginHandler(commands, name) {
  let current = String(name || "").toLowerCase();
  const visited = new Set();
  for (let depth = 0; depth < 8 && !visited.has(current); depth += 1) {
    visited.add(current);
    const value = commands?.[current];
    if (typeof value === "function") return { handler: value, canonicalName: current };
    if (typeof value !== "string") return null;
    current = value.toLowerCase();
  }
  return null;
}

// Checks if a command (without prefix) matches any loaded plugin, resolves
// string aliases, and returns null instead of a non-callable handler.
function findPluginCommand(loadedPlugins, commandName) {
  const requested = String(commandName || "").toLowerCase();
  for (const plugin of loadedPlugins || []) {
    const resolved = resolvePluginHandler(plugin.commands, requested);
    if (resolved) {
      return {
        plugin,
        handler: resolved.handler,
        commandName: requested,
        canonicalName: resolved.canonicalName,
        ownerOnly: Boolean(plugin.ownerOnly || OWNER_ONLY_COMMANDS.has(resolved.canonicalName)),
      };
    }
  }
  return null;
}

module.exports = { loadPlugins, findPluginCommand, resolvePluginHandler, OWNER_ONLY_COMMANDS, PLUGINS_DIR };
