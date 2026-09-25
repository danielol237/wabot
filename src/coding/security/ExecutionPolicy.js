// Security & Execution Policy Enforcer
const path = require("path");

class ExecutionPolicy {
  constructor(workspacePath = process.cwd()) {
    this.workspacePath = path.resolve(workspacePath);
    this.allowedOperations = new Set([
      "READ",
      "WRITE",
      "EDIT",
      "TEST",
      "BUILD",
      "LINT",
      "GIT_STATUS",
      "GIT_DIFF",
      "GIT_COMMIT",
    ]);

    this.restrictedOperations = new Set([
      "GIT_PUSH",
      "FORCE_PUSH",
      "DELETE_REPO",
      "DROP_DATABASE",
      "PROD_DEPLOY",
      "MODIFY_SECRETS",
      "UNRESTRICTED_SHELL",
    ]);
  }

  isPathSafe(targetPath) {
    if (!targetPath) return false;
    const resolved = path.resolve(this.workspacePath, targetPath);
    const relative = path.relative(this.workspacePath, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return false;
    }
    const rel = relative.replace(/\\/g, "/");
    const segments = rel.split("/");

    // Deny exact sensitive files and directories
    if (rel === ".env" || rel.startsWith(".env.") || rel === "credentials" || rel.startsWith("auth_info_baileys") || rel.startsWith(".git/config")) {
      return false;
    }
    if (segments.includes("auth_info_baileys") || segments.includes("credentials")) {
      return false;
    }

    return true;
  }

  checkPermission(operation) {
    if (this.restrictedOperations.has(operation)) {
      return {
        allowed: false,
        requiresAuthorization: true,
        reason: `Operation '${operation}' requires explicit authorization policy approval.`,
      };
    }

    if (this.allowedOperations.has(operation)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Unknown or unauthorized operation: '${operation}'.`,
    };
  }
}

module.exports = ExecutionPolicy;
