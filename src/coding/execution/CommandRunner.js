// Controlled Command Runner with Bounded Timeouts & Output Limits
const { exec } = require("child_process");
const ExecutionPolicy = require("../security/ExecutionPolicy");

class CommandRunner {
  constructor(workspacePath = process.cwd(), options = {}) {
    this.workspacePath = workspacePath;
    this.policy = new ExecutionPolicy(workspacePath);
    this.defaultTimeoutMs = options.defaultTimeoutMs || 60000;
    this.maxBufferBytes = options.maxBufferBytes || 1024 * 1024; // 1MB
  }

  runCommand(commandStr, timeoutMs = this.defaultTimeoutMs, options = {}) {
    return new Promise((resolve) => {
      const perm = this.policy.checkCommandPermission(commandStr, options.userAuthorized || false);
      if (!perm.allowed) {
        return resolve({
          success: false,
          exitCode: -1,
          stdout: "",
          stderr: this.policy.sanitizeOutput(perm.reason || "Command denied by security policy."),
          timedOut: false,
        });
      }

      const startTime = Date.now();
      exec(
        commandStr,
        {
          cwd: this.workspacePath,
          timeout: timeoutMs,
          maxBuffer: this.maxBufferBytes,
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          const duration = Date.now() - startTime;
          const timedOut = err && (err.killed || err.signal === "SIGTERM" || err.code === "ETIMEDOUT");

          resolve({
            success: !err,
            exitCode: err ? err.code || 1 : 0,
            stdout: this.policy.sanitizeOutput(String(stdout || "").slice(0, 10000)), // Bounded output
            stderr: this.policy.sanitizeOutput(String(stderr || "").slice(0, 10000)),
            duration,
            timedOut: Boolean(timedOut),
          });
        }
      );
    });
  }
}

module.exports = CommandRunner;
