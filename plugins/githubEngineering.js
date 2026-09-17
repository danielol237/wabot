const engineering = require("../src/tools/engineeringSystem");

const HELP = `🛠️ *ARIA GitHub Engineering*

I work in four guarded stages:

1. *Plan* — inspect the request and create a bounded proposal.
2. *Approve* — generate a branch, commit, and draft pull request.
3. *Verify* — read GitHub CI/status checks and block unsafe merges.
4. *Merge* — squash-merge only a verified PR into main.

*Commands*
• !github status — show repository, provider, and safety status
• !github list — list recent engineering proposals
• !github plan <what to change> — create a proposal; no files change
• !github approve <upgrade_id> — generate a branch and draft PR
• !github verify <upgrade_id> — check PR status and CI
• !github merge <upgrade_id> — merge only after verification is green

Each user uses only their own encrypted GitHub credential. ARIA never stores plaintext tokens, edits secrets, edits WhatsApp session files, or merges an unverified PR.`;

function text(args) {
  return Array.isArray(args) ? args.join(" ").trim() : String(args || "").trim();
}

function commandHelp() {
  return HELP;
}

async function handleGithub(sock, msg, args, ctx) {
  const raw = text(args);
  const match = raw.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const action = (match?.[1] || "help").toLowerCase();
  const rest = String(match?.[2] || "").trim();

  if (["help", "commands", "?"].includes(action)) return ctx.reply(commandHelp());
  if (["status", "inspect", "inventory"].includes(action)) {
    const result = await engineering.handleEngineeringRequest("status", ctx.senderName, ctx.chatId, ctx.senderJid);
    return ctx.reply(result.message || result.error || "Could not read engineering status.");
  }
  if (["list", "proposals", "upgrades"].includes(action)) {
    return ctx.reply(`🧾 *Recent engineering proposals*\n\n${engineering.listProposals()}`);
  }
  if (["plan", "propose", "implement", "build", "fix", "change"].includes(action)) {
    if (!rest) return ctx.reply("Tell me what should change after `!github plan`, for example: `!github plan add tests for the pairing flow`.");
    const result = await engineering.createUpgradePlan(rest, ctx.senderName, ctx.chatId, ctx.senderJid);
    return ctx.reply(result.message || `❌ ${result.error || "Could not create a proposal."}`);
  }
  if (["approve", "apply", "execute"].includes(action)) {
    if (!rest) return ctx.reply("Provide the proposal ID, for example: `!github approve upgrade_...`.");
    const result = await engineering.createGitHubUpgrade(rest.split(/\s+/)[0], ctx.senderName, ctx.senderJid);
    return ctx.reply(result.message || `❌ ${result.error || "Could not create the draft PR."}`);
  }
  if (["verify", "check", "test"].includes(action)) {
    if (!rest) return ctx.reply("Provide the proposal ID, for example: `!github verify upgrade_...`.");
    const result = await engineering.verifyUpgrade(rest.split(/\s+/)[0], ctx.senderJid);
    return ctx.reply(result.message || `❌ ${result.error || "Could not verify the PR."}`);
  }
  if (["merge", "ship"].includes(action)) {
    if (!rest) return ctx.reply("Provide the proposal ID, for example: `!github merge upgrade_...`.");
    const result = await engineering.mergeUpgrade(rest.split(/\s+/)[0], ctx.senderJid);
    return ctx.reply(result.message || `❌ ${result.error || "Could not merge the PR."}`);
  }
  return ctx.reply(`I don't know the GitHub action *${action}*.\n\n${commandHelp()}`);
}

module.exports = {
  name: "github-engineering",
  ownerOnly: false,
  commands: {
    github: handleGithub,
    gh: "github",
    codechange: "github",
  },
  _test: { commandHelp, text },
};
