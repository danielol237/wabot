/**
 * Terminal Execution capability for MissionAgent and CapabilityRegistry.
 * Reuses existing CommandRunner and ExecutionPolicy for safe terminal command execution.
 */

const CommandRunner = require("../coding/execution/CommandRunner");
const ExecutionPolicy = require("../coding/security/ExecutionPolicy");

async function executeTerminal(inputs = {}, context = {}) {
  const command = inputs.command || inputs.cmd;
  if (!command) {
    throw new Error("Terminal execution requires a 'command' input.");
  }

  const cwd = inputs.cwd || process.cwd();
  const runner = new CommandRunner({ cwd });

  const result = await runner.run(command, {
    timeout: inputs.timeout || 30000,
    userAuthorized: context.userAuthorized || false
  });

  return result;
}

module.exports = {
  executeTerminal
};
