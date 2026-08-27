const { randomUUID } = require("crypto");

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 2;

function errorMessage(error) {
  return String(error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || error || "operation failed").slice(0, 240);
}

function isRetryableError(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  const code = String(error?.code || "").toUpperCase();
  return status === 408 || status === 425 || status === 429 || status >= 500 || ["ECONNABORTED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN"].includes(code) || /timeout|temporar|network|socket|unavailable/i.test(errorMessage(error));
}

function resultFailureMessage(result) {
  return errorMessage(result?.error || "operation returned success:false");
}

function withTimeout(task, timeoutMs, name) {
  let timer;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${name} timed out after ${timeoutMs}ms`);
        error.code = "ETIMEDOUT";
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runOperation(name, task, options = {}) {
  const operation = String(name || "operation").slice(0, 80);
  const timeoutMs = Math.max(500, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const attempts = Math.max(1, Math.min(4, Number(options.attempts || DEFAULT_ATTEMPTS)));
  const retryIf = typeof options.retryIf === "function" ? options.retryIf : () => false;
  const correlationId = options.correlationId || randomUUID();
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await withTimeout(task, timeoutMs, operation);
      const semanticFailure = result && result.success === false;
      if (semanticFailure) {
        lastError = new Error(resultFailureMessage(result));
        const shouldRetry = retryIf(result, null);
        try { require("./eventLog").trackOperation("tool", operation, "attempt-failed", { attempt, attempts, retryable: shouldRetry, correlationId, error: resultFailureMessage(result) }); } catch (_) {}
        if (attempt < attempts && shouldRetry) {
          if (options.retryDelayMs) await new Promise((resolve) => setTimeout(resolve, Number(options.retryDelayMs)));
          continue;
        }
        try { require("./eventLog").trackOperation("tool", operation, "failed", { attempt, attempts, correlationId, error: resultFailureMessage(result) }); } catch (_) {}
        return result;
      }
      try { require("./eventLog").trackOperation("tool", operation, "succeeded", { attempt, attempts, correlationId }); } catch (_) {}
      return result;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error) || retryIf(null, error);
      try { require("./eventLog").trackOperation("tool", operation, "attempt-failed", { attempt, attempts, retryable, correlationId, error: errorMessage(error) }); } catch (_) {}
      if (!retryable || attempt >= attempts) break;
      if (options.retryDelayMs) await new Promise((resolve) => setTimeout(resolve, Number(options.retryDelayMs)));
    }
  }
  try { require("./eventLog").trackOperation("tool", operation, "failed", { attempts, correlationId, error: errorMessage(lastError) }); } catch (_) {}
  if (options.returnError) return options.returnError(lastError);
  throw lastError || new Error(`${operation} failed`);
}

module.exports = { runOperation, withTimeout, isRetryableError, _test: { errorMessage } };
