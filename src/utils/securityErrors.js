const crypto = require("crypto");

const ERROR_STATUS_MAP = {
  AUTHENTICATION_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  SESSION_REVOKED: 401,
  SESSION_INVALID: 401,
  AUTHORIZATION_REQUIRED: 403,
  RESOURCE_ACCESS_DENIED: 403,
  CSRF_VALIDATION_FAILED: 403,
  ORIGIN_NOT_ALLOWED: 403,
  SECURITY_POLICY_VIOLATION: 403,
  RATE_LIMITED: 429,
  ACCOUNT_LOCKED: 423,
  SECURITY_SERVICE_UNAVAILABLE: 503,
};

const DEFAULT_MESSAGES = {
  AUTHENTICATION_REQUIRED: "Authentication is required.",
  INVALID_CREDENTIALS: "Invalid credentials.",
  SESSION_EXPIRED: "Your session has expired. Please authenticate again.",
  SESSION_REVOKED: "This session is no longer valid.",
  SESSION_INVALID: "The current session is invalid.",
  AUTHORIZATION_REQUIRED: "You are not authorized to perform this action.",
  RESOURCE_ACCESS_DENIED: "Access to this resource is not permitted.",
  CSRF_VALIDATION_FAILED: "The security token is invalid or missing.",
  ORIGIN_NOT_ALLOWED: "The request origin is not allowed.",
  SECURITY_POLICY_VIOLATION: "The requested operation is not permitted by security policy.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  ACCOUNT_LOCKED: "This account is temporarily unavailable.",
  SECURITY_SERVICE_UNAVAILABLE: "Security services are temporarily unavailable.",
};

function getRequestId(req) {
  const existing = req?.headers?.["x-request-id"];
  if (existing && typeof existing === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
    return existing;
  }
  return "req_" + crypto.randomBytes(12).toString("hex");
}

function createSecurityError(code, message = null, requestId = null, details = null) {
  const statusCode = ERROR_STATUS_MAP[code] || 400;
  const safeMessage = message || DEFAULT_MESSAGES[code] || "A security error occurred.";
  const reqId = requestId || "req_" + crypto.randomBytes(12).toString("hex");

  return {
    statusCode,
    body: {
      error: {
        code,
        message: safeMessage,
        requestId: reqId,
        details: details || null,
      },
    },
  };
}

function sendSecurityError(res, req, code, message = null, details = null, headers = {}) {
  const requestId = getRequestId(req);
  const err = createSecurityError(code, message, requestId, details);

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Request-ID", requestId);

  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  return res.status(err.statusCode).json(err.body);
}

module.exports = {
  ERROR_STATUS_MAP,
  DEFAULT_MESSAGES,
  getRequestId,
  createSecurityError,
  sendSecurityError,
};
