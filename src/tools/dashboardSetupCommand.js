const auth = require("../utils/dashboardAuth");
const { isOwner } = require("../utils/permissions");

async function handleDashboardCommand(sock, msg, args, ctx) {
  const { reply, react } = require("../utils/baileysHelpers");

  // Check if sender is owner
  if (!isOwner(ctx.senderJid)) {
    return reply(sock, msg, "❌ Dashboard setup is restricted to ARIA's owner.");
  }

  const raw = String(args || "").trim();
  const setupMatch = raw.match(/(?:change|set|configure|update|setup)\s+(?:my\s+)?dashboard\s+password\s+(?:to|as)\s+(.+)$/i) ||
                     raw.match(/^(?:setup|configure|set|password)?\s*(?:dashboard\s+password\s+as|password\s+as|setup)?\s*(.+)$/i);

  if (!setupMatch || !setupMatch[1]) {
    return reply(sock, msg, "🔑 *ARIA Dashboard Setup*\n\nUsage:\n`ARIA, change my dashboard password to <your_password>`\nor\n`!dashboard setup <your_password>`\n\nMust be at least 8 characters.");
  }

  const password = setupMatch[1].trim();
  if (password.length < 8) {
    return reply(sock, msg, "❌ Password must be at least 8 characters long.");
  }

  if (auth.hasOwnerAccount()) {
    return reply(sock, msg, "⚠️ Dashboard owner account is already setup. Use `/dashboard/login` to sign in.");
  }

  try {
    const acc = await auth.createAccount("owner", password, "owner");
    await react(sock, msg, "🔐");
    return reply(sock, msg, `🔐 *ARIA Dashboard Owner Password Configured!*\n\nUsername: *owner*\nPassword: *(configured securely)*\n\nYou can now sign in at `/dashboard/login` using your password!`);
  } catch (err) {
    return reply(sock, msg, `❌ Setup failed: ${err.message}`);
  }
}

module.exports = {
  handleDashboardCommand
};
