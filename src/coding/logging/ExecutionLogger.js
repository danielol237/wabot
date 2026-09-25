// Centralized VPS Terminal Execution Logger for ARIA Agentic Engine
const ExecutionPolicy = require("../security/ExecutionPolicy");

class ExecutionLogger {
  constructor() {
    this.policy = new ExecutionPolicy();
  }

  logEvent(event) {
    const timestamp = event.timestamp || new Date().toISOString();
    const level = (event.level || "INFO").toUpperCase();
    const taskId = event.taskId || event.id || "system";
    const stage = event.stage || event.state || "PROCESSING";
    const capability = event.capability || "engine";
    const step = event.step !== undefined ? `step=${event.step}` : "";
    const command = event.command ? `command="${this.policy.sanitizeOutput(event.command)}"` : "";
    const duration = event.durationMs !== undefined ? `duration=${event.durationMs}ms` : "";
    const exitCode = event.exitCode !== undefined ? `exitCode=${event.exitCode}` : "";
    const msg = event.message ? `message="${this.policy.sanitizeOutput(event.message)}"` : "";
    const err = event.error ? `error="${this.policy.sanitizeOutput(event.error)}"` : "";

    const parts = [
      `[ARIA_EXEC]`,
      timestamp,
      level,
      `task=${taskId}`,
      `stage=${stage}`,
      `capability=${capability}`,
      step,
      command,
      duration,
      exitCode,
      msg,
      err,
    ].filter(Boolean);

    const formattedLog = parts.join(" ");
    if (level === "ERROR") {
      console.error(formattedLog);
    } else if (level === "WARN") {
      console.warn(formattedLog);
    } else {
      console.log(formattedLog);
    }
  }
}

const executionLogger = new ExecutionLogger();
module.exports = executionLogger;
