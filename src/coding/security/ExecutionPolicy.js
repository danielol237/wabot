// Security & Execution Policy Enforcer for ARIA Execution Engine
const path = require("path");

class ExecutionPolicy {
  constructor(workspacePath = process.cwd(), executionDomain = "SANDBOX") {
    this.workspacePath = path.resolve(workspacePath);
    this.executionDomain = executionDomain; // "HOST" or "SANDBOX"
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
      "DESTRUCTIVE",
    ]);
  }

  isPathSafe(targetPath) {
    if (!targetPath) return false;
    try {
      const resolved = path.resolve(this.workspacePath, targetPath);
      const relative = path.relative(this.workspacePath, resolved);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return false;
      }
      const rel = relative.replace(/\\/g, "/");
      const segments = rel.split("/");

      // Deny direct access to secrets, credentials, or session data
      if (
        rel === ".env" ||
        rel.startsWith(".env.") ||
        rel === "credentials" ||
        rel.startsWith("data/dashboardAccounts.json") ||
        segments.includes("auth_info_baileys") ||
        segments.includes("credentials")
      ) {
        return false;
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  classifyCommand(commandStr) {
    const clean = String(commandStr || "").trim();

    // 1. Destructive / High-impact
    if (
      /(?:rm\s+-rf|mkfs|dd\s+if=|git\s+reset|git\s+clean|git\s+push.*--force|systemctl\s+stop|drop\s+database)/i.test(clean)
    ) {
      return "DESTRUCTIVE";
    }

    // 2. Read-only / Low-risk
    if (
      /^(?:pwd|ls\b|dir|cat\b|find\b|head\b|tail\b|echo\b|free|uptime|node\s+-v|npm\s+-v)/i.test(clean) ||
      /\b(?:git\s+(?:status|log|diff|branch|show)|pm2\s+(?:status|list|show)|docker\s+(?:ps|images|version))\b/i.test(clean)
    ) {
      return "READ";
    }

    // 3. Authorized Operational
    if (
      /\b(?:git\s+pull|npm\s+ci|npm\s+install|npm\s+run\s+\w+|npm\s+test|pm2\s+restart|pm2\s+reload|docker\s+run|docker\s+stop)\b/i.test(clean)
    ) {
      return "AUTHORIZED_WRITE";
    }

    return "EXECUTE";
  }

  checkPermission(operation) {
    const op = String(operation || "").toUpperCase();
    if (this.restrictedOperations.has(op)) {
      return {
        allowed: false,
        requiresAuthorization: true,
        reason: `Operation '${operation}' requires explicit authorization policy approval.`,
      };
    }
    if (this.allowedOperations.has(op)) {
      return { allowed: true };
    }
    return { allowed: true };
  }

  checkCommandPermission(commandStr, userAuthorized = false) {
    const classification = this.classifyCommand(commandStr);

    if (classification === "DESTRUCTIVE") {
      if (!userAuthorized) {
        return {
          allowed: false,
          classification,
          reason: `Command '${commandStr}' is classified as DESTRUCTIVE and requires explicit user authorization.`,
        };
      }
    }

    if (classification === "AUTHORIZED_WRITE" && this.executionDomain === "SANDBOX") {
      return { allowed: true, classification };
    }

    return { allowed: true, classification };
  }

  sanitizeOutput(text) {
    if (!text) return "";
    let str = String(text);
    // Redact tokens, keys, passwords, secrets
    str = str.replace(/(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIzaSy[A-Za-z0-9_-]{30,})/g, "[REDACTED_SECRET]");
    str = str.replace(/(?:[A-Za-z0-9+/]{40,}={0,2})/g, (match) => {
      if (match.length > 50 && !match.includes(" ")) return "[REDACTED_BLOB]";
      return match;
    });
    return str;
  }
}

module.exports = ExecutionPolicy;
