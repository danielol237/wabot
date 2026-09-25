// Git Diff Analyzer for Evidence Gathering
const GitManager = require("../execution/GitManager");

class DiffAnalyzer {
  constructor(workspacePath = process.cwd()) {
    this.git = new GitManager(workspacePath);
  }

  async analyzeDiff() {
    const rawDiff = await this.git.getDiff();
    const status = await this.git.getStatus();

    const changedFiles = (status.files || []).map((f) => f.slice(3).trim());
    const insertions = (rawDiff.match(/^\+[^+]/gm) || []).length;
    const deletions = (rawDiff.match(/^-[^-]/gm) || []).length;

    return {
      hasChanges: changedFiles.length > 0 || rawDiff.length > 0,
      changedFiles,
      insertions,
      deletions,
      rawDiff: rawDiff.slice(0, 10000), // Bounded diff output
    };
  }
}

module.exports = DiffAnalyzer;
