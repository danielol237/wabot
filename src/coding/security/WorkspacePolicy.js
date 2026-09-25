// Workspace Policy & Directory Sandbox
const path = require("path");
const fs = require("fs");

class WorkspacePolicy {
  constructor(workspacePath = process.cwd()) {
    this.workspacePath = path.resolve(workspacePath);
  }

  ensureWorkspace() {
    if (!fs.existsSync(this.workspacePath)) {
      fs.mkdirSync(this.workspacePath, { recursive: true });
    }
  }

  resolvePath(relPath) {
    const resolved = path.resolve(this.workspacePath, relPath);
    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error(`Path traversal denied: '${relPath}' is outside workspace '${this.workspacePath}'`);
    }
    return resolved;
  }
}

module.exports = WorkspacePolicy;
