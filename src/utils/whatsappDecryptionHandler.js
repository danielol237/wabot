// WhatsApp Session Decryption & Bad MAC Error Handler
// Structured tracking, rate-limiting, and session recovery for libsignal decryption failures.

const fs = require("fs");
const path = require("path");
const { log, warn, error } = require("./logger");

const failureCounts = new Map(); // key: jid/session -> { count: number, firstAt: number, lastAt: number, lastLoggedAt: number }
const LOG_COOLDOWN_MS = 30_000; // Log at most once every 30 seconds per session
const MAX_FAILURES_BEFORE_PAIRING_ALERT = 10;

function getSessionKey(err, context = {}) {
  const jid = context.jid || context.senderJid || context.chatId || "global_session";
  return jid;
}

function classifyDecryptionError(err) {
  const msg = String(err?.message || err || "");
  if (/Bad MAC/i.test(msg)) return "BAD_MAC";
  if (/Failed to decrypt/i.test(msg)) return "DECRYPTION_FAILED";
  if (/Session error/i.test(msg)) return "SESSION_ERROR";
  if (/No session/i.test(msg)) return "MISSING_SESSION";
  return "UNKNOWN_DECRYPTION_ERROR";
}

function isDecryptionError(err) {
  const msg = String(err?.message || err || "");
  return /Bad MAC|Failed to decrypt|Session error|libsignal/i.test(msg);
}

function handleDecryptionError(err, context = {}) {
  if (!isDecryptionError(err)) return false;

  const key = getSessionKey(err, context);
  const now = Date.now();
  const errorType = classifyDecryptionError(err);

  let record = failureCounts.get(key);
  if (!record) {
    record = { count: 0, firstAt: now, lastAt: now, lastLoggedAt: 0 };
    failureCounts.set(key, record);
  }

  record.count += 1;
  record.lastAt = now;

  const shouldLog = (now - record.lastLoggedAt) > LOG_COOLDOWN_MS;

  let action = "IGNORED_TRANSIENT";
  if (record.count >= MAX_FAILURES_BEFORE_PAIRING_ALERT) {
    action = "PAIRING_RELOAD_RECOMMENDED";
  } else if (record.count > 1) {
    action = "RATE_LIMITED_RETRY";
  } else {
    action = "LOGGED";
  }

  if (shouldLog) {
    record.lastLoggedAt = now;
    const structuredLog = {
      event: "WHATSAPP_SESSION_DECRYPT_FAILED",
      sessionId: context.sessionId || "default",
      jid: key,
      errorType,
      failureCount: record.count,
      action,
      timestamp: new Date(now).toISOString(),
      message: String(err?.message || err).slice(0, 200),
    };

    warn(`[WHATSAPP_SESSION_DECRYPT_FAILED] JID: ${key} | Type: ${errorType} | Count: ${record.count} | Action: ${action}`);

    try {
      require("./eventLog").track("whatsapp-decrypt-error", `${errorType} on ${key} (count: ${record.count})`, structuredLog);
    } catch (_) {}
  }

  return true;
}

function getFailureStats(key) {
  return failureCounts.get(key) || null;
}

function clearFailureStats(key) {
  if (key) failureCounts.delete(key);
  else failureCounts.clear();
}

module.exports = {
  isDecryptionError,
  classifyDecryptionError,
  handleDecryptionError,
  getFailureStats,
  clearFailureStats,
};
