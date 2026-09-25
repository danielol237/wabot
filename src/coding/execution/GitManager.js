// Git Workflow Manager with Safety Guards (No Force Push, Base Commit Tracking)
const CommandRunner = require("./CommandRunner");

class GitManager {
  constructor(workspacePath = process.cwd()) {
    this.cmd = new CommandRunner(workspacePath);
  }

  async getStatus() {
    const res = await this.cmd.runCommand("git status --porcelain");
    if (!res.success) return { ok: false, error: res.stderr };
    const lines = res.stdout.trim().split("\n").filter(Boolean);
    return {
      ok: true,
      dirty: lines.length > 0,
      files: lines,
    };
  }

  async getHeadCommit() {
    const res = await this.cmd.runCommand("git rev-parse HEAD");
    if (!res.success) return null;
    return res.stdout.trim();
  }

  async getDiff() {
    const res = await this.cmd.runCommand("git diff");
    if (!res.success) return "";
    return res.stdout;
  }

  async createBranch(branchName) {
    const res = await this.cmd.runCommand(`git checkout -b ${branchName}`);
    return res.success;
  }

  async commitChanges(message) {
    const addRes = await this.cmd.runCommand("git add -A");
    if (!addRes.success) return { ok: false, error: addRes.stderr };
    const cleanMsg = String(message || "aria: coding engine commit").replace(/"/g, '\\"');
    const commitRes = await this.cmd.runCommand(`git commit -m "${cleanMsg}"`);
    return {
      ok: commitRes.success,
      output: commitRes.stdout || commitRes.stderr,
    };
  }
}

module.exports = GitManager;
