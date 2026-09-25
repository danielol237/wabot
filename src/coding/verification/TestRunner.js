// Auto-discovers and executes project tests
const CommandRunner = require("../execution/CommandRunner");

class TestRunner {
  constructor(workspacePath = process.cwd()) {
    this.cmd = new CommandRunner(workspacePath);
  }

  async runTests(testCommand = "npm test", timeoutMs = 120000) {
    const result = await this.cmd.runCommand(testCommand, timeoutMs);
    return {
      success: result.success,
      exitCode: result.exitCode,
      command: testCommand,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      timedOut: result.timedOut,
    };
  }
}

module.exports = TestRunner;
