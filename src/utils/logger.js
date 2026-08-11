// Structured logger using pino — already in dependencies.
// In production outputs JSON (perfect for log aggregation).
// In dev outputs readable format (pino-pretty optional).

const pino = require("pino");
const logStream = require("./logStream");

let transport;
try {
  if (process.env.NODE_ENV !== "production") {
    transport = pino.transport({
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
    });
  }
} catch (_) {
  // pino-pretty not installed — fall back to default pino output
  transport = undefined;
}

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV !== "production" ? "debug" : "info"),
}, transport);

// Drop-in replacements for console.log/error/warn
function log(...args) {
  logger.info(args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" "));
  logStream.push("info", args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" "));
}

function error(...args) {
  logger.error(args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" "));
  logStream.push("error", args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" "));
}

function warn(...args) {
  logger.warn(args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" "));
  logStream.push("warn", args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" "));
}

function debug(...args) {
  logger.debug(args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" "));
  logStream.push("debug", args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" "));
}

module.exports = { logger, log, error, warn, debug };
