// Central Capability Router for Agentic Missions & Execution
const path = require("path");
const fs = require("fs");
const CommandRunner = require("./execution/CommandRunner");
const ExecutionPolicy = require("./security/ExecutionPolicy");
const DockerProbe = require("./execution/DockerProbe");

class CapabilityRouter {
  constructor(options = {}) {
    this.ariaRoot = path.resolve(__dirname, "../../");
    this.options = options;
  }

  detectCapabilities(request) {
    const text = String(request || "").toLowerCase();
    const capabilities = new Set();

    if (/\b(?:run|execute|cmd|terminal|command|bash|shell|pull|restart|pm2|git|npm)\b/i.test(text)) {
      capabilities.add("terminal");
    }
    if (/\b(?:git|pull|branch|commit|diff|checkout|status)\b/i.test(text)) {
      capabilities.add("git");
    }
    if (/\b(?:file|files|read|write|create|edit|directory|workspace|path)\b/i.test(text)) {
      capabilities.add("filesystem");
    }
    if (/\b(?:docker|container|dockerfile|image)\b/i.test(text)) {
      capabilities.add("docker");
    }
    if (/\b(?:build|website|app|code|fix|refactor|component|script)\b/i.test(text)) {
      capabilities.add("coding");
      capabilities.add("sandbox");
      capabilities.add("testing");
    }
    if (/\b(?:test|tests|jest|vitest|mocha)\b/i.test(text)) {
      capabilities.add("testing");
    }
    if (/\b(?:search|web|google|research)\b/i.test(text)) {
      capabilities.add("web_research");
    }

    if (capabilities.size === 0) {
      capabilities.add("terminal");
    }

    return Array.from(capabilities);
  }

  resolveExecutionBoundary(request) {
    const text = String(request || "").toLowerCase();
    if (
      /\b(?:~\/aria-wabot|aria-wabot|update\s+(?:yourself|aria)|pull\s+(?:origin\s+)?main|pm2\s+restart|restart\s+aria)\b/i.test(text)
    ) {
      return {
        domain: "HOST",
        workspacePath: path.resolve(process.env.HOME || "/home/daniel", "aria-wabot"),
        reason: "Operational VPS maintenance request targeting ARIA host repository.",
      };
    }

    const taskId = `task_${Date.now().toString(36)}`;
    const workspacePath = path.resolve(this.ariaRoot, "temp/workspaces", taskId);
    return {
      domain: "SANDBOX",
      workspacePath,
      reason: "Isolated task workspace created for project code execution.",
    };
  }

  async generateExecutionPlan(request, userAuthorized = false) {
    const boundary = this.resolveExecutionBoundary(request);
    const capabilities = this.detectCapabilities(request);

    const steps = [];
    const text = String(request || "").toLowerCase();

    if (boundary.domain === "HOST" && /\b(?:pull|update|restart)\b/i.test(text)) {
      steps.push({
        id: "step_git_status",
        capability: "git",
        command: "git status --porcelain",
        description: "Inspect repository working tree status",
        userAuthorized: true,
      });
      steps.push({
        id: "step_git_pull",
        capability: "git",
        command: "git pull origin main",
        description: "Pull latest updates from origin main",
        userAuthorized: true,
      });
      steps.push({
        id: "step_npm_install",
        capability: "terminal",
        command: "npm ci --omit=dev",
        description: "Install production dependencies",
        userAuthorized: true,
      });
      steps.push({
        id: "step_pm2_restart",
        capability: "terminal",
        command: "pm2 restart aria --update-env",
        description: "Restart ARIA process under PM2",
        userAuthorized: true,
      });
      steps.push({
        id: "step_verify_status",
        capability: "terminal",
        command: "pm2 status",
        description: "Verify ARIA process status",
        userAuthorized: true,
      });
    } else {
      steps.push({
        id: "step_exec_1",
        capability: capabilities[0] || "terminal",
        command: request,
        description: `Execute request: ${request.slice(0, 60)}`,
        userAuthorized,
      });
    }

    return {
      boundary,
      capabilities,
      steps,
    };
  }
}

module.exports = CapabilityRouter;
