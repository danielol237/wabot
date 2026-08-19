// ── AI Plugin Builder ──────────────────────────────────────
// !generateplugin <desc> — AI creates a plugin from description

const { getAIResponse } = require("./ai");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PLUGINS_DIR = path.join(__dirname, "../../plugins");

async function generatePlugin(description, senderName) {
  const prompt = `Create a WhatsApp bot plugin file based on this description: "${description}"

The plugin must:
- Export { name, commands: { commandName: async (sock, msg, args, ctx) => {} } }
- Use ctx.reply() to send messages
- Use ctx.react(emoji) for reactions
- Be self-contained (require dependencies at the top)
- Handle errors gracefully
- Have at least 2 commands

Respond ONLY with the complete JavaScript file content. No extra text or markdown.

Example structure:
module.exports = {
  name: "example",
  commands: {
    cmd1: async (sock, msg, args, ctx) => {
      try {
        ctx.reply("result");
      } catch (e) {
        ctx.reply("Error: " + e.message);
      }
    },
  },
};`;

  const content = await getAIResponse(prompt, senderName, [], null, "You are a WhatsApp bot plugin generator. Output ONLY valid JavaScript code.");

  // Extract plugin name from description
  const nameMatch = description.match(/^(\w+)/);
  const pluginName = (nameMatch ? nameMatch[1] : "custom").toLowerCase();

  const filePath = path.join(PLUGINS_DIR, pluginName + ".js");
  if (fs.existsSync(filePath)) {
    return { success: false, error: `A plugin named "${pluginName}" already exists. Choose a more specific name.` };
  }

  // Validate syntax without executing untrusted generated code.
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  try {
    execFileSync(process.execPath, ["--check", filePath], { stdio: "pipe" });
  } catch (e) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    return { success: false, error: "Generated plugin has syntax errors. Try a simpler description." };
  }

  // New generated code is not loaded automatically on the next restart. An
  // owner must explicitly enable it after reviewing the returned file.
  try { require("./pluginMarket").setPluginState(pluginName, false); } catch (_) {}
  return { success: true, name: pluginName, path: filePath, content, enabled: false };
}

module.exports = { generatePlugin };
