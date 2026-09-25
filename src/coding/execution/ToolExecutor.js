// Tool Executor Dispatcher with Security Enforcement
const FileManager = require("./FileManager");
const CommandRunner = require("./CommandRunner");
const GitManager = require("./GitManager");
const ExecutionPolicy = require("../security/ExecutionPolicy");

class ToolExecutor {
  constructor(workspacePath = process.cwd()) {
    this.workspacePath = workspacePath;
    this.fileManager = new FileManager(workspacePath);
    this.commandRunner = new CommandRunner(workspacePath);
    this.gitManager = new GitManager(workspacePath);
    this.policy = new ExecutionPolicy(workspacePath);
  }

  async executeTool(toolName, args = {}) {
    switch (toolName) {
      case "read_file":
        return this.fileManager.readFile(args.path);
      case "write_file":
        return this.fileManager.writeFile(args.path, args.content);
      case "file_exists":
        return this.fileManager.fileExists(args.path);
      case "run_command":
        return await this.commandRunner.runCommand(args.command, args.timeoutMs);
      case "git_status":
        return await this.gitManager.getStatus();
      case "git_diff":
        return await this.gitManager.getDiff();
      default:
        throw new Error(`Unknown or unsupported tool: ${toolName}`);
    }
  }
}

module.exports = ToolExecutor;
