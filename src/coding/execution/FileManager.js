// Safe File Manager with Workspace Sandbox
const fs = require("fs");
const path = require("path");
const WorkspacePolicy = require("../security/WorkspacePolicy");
const ExecutionPolicy = require("../security/ExecutionPolicy");

class FileManager {
  constructor(workspacePath = process.cwd()) {
    this.workspace = new WorkspacePolicy(workspacePath);
    this.policy = new ExecutionPolicy(workspacePath);
  }

  readFile(relPath) {
    if (!this.policy.isPathSafe(relPath)) {
      throw new Error(`Security policy denied read access to: ${relPath}`);
    }
    const fullPath = this.workspace.resolvePath(relPath);
    return fs.readFileSync(fullPath, "utf8");
  }

  writeFile(relPath, content) {
    if (!this.policy.isPathSafe(relPath)) {
      throw new Error(`Security policy denied write access to: ${relPath}`);
    }
    const fullPath = this.workspace.resolvePath(relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf8");
  }

  fileExists(relPath) {
    if (!this.policy.isPathSafe(relPath)) return false;
    try {
      const fullPath = this.workspace.resolvePath(relPath);
      return fs.existsSync(fullPath);
    } catch (_) {
      return false;
    }
  }
}

module.exports = FileManager;
