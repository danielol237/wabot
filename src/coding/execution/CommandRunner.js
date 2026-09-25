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

  runCommand(commandStr, timeoutMs = this.defaultTimeoutMs) {
    return new Promise((resolve) => {
      // Basic sanity check to prevent dangerous operations
      if (/\b(?:rm -rf \/|mkfs|dd if=)\b/i.test(commandStr)) {
        return resolve({
          success: false,
          exitCode: -1,
          stdout: "",
          stderr: "Command denied by security policy.",
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
          const timedOut = err && err.killed && err.signal === "SIGTERM";

          resolve({
            success: !err,
            exitCode: err ? err.code || 1 : 0,
            stdout: String(stdout || "").slice(0, 10000), // Bounded output
            stderr: String(stderr || "").slice(0, 10000),
            duration,
            timedOut,
          });
        }
      );
    });
  }
}

module.exports = CommandRunner;
