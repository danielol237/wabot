// Syntax and Build Script Verifier
const CommandRunner = require("../execution/CommandRunner");

class BuildVerifier {
  constructor(workspacePath = process.cwd()) {
    this.cmd = new CommandRunner(workspacePath);
  }

  async verifyBuild(buildScript = "npm run build") {
    const result = await this.cmd.runCommand(buildScript);
    return {
      success: result.success,
      command: buildScript,
      output: result.stdout || result.stderr,
    };
  }
}

module.exports = BuildVerifier;
