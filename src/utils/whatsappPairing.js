// Secure phone-number pairing coordinator for the dashboard and Baileys socket.
// Pairing codes are intentionally kept in memory only and are never logged or persisted.

const CODE_TTL_MS = 3 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 30 * 1000;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_ACTOR = 5;
const MAX_NUMBER_LENGTH = 15;
const MIN_NUMBER_LENGTH = 8;

const state = {
  connection: "starting",
  ready: false,
  registered: false,
  mode: "qr",
  phoneNumber: null,
  code: null,
  codeIssuedAt: null,
  codeExpiresAt: null,
  requestSource: null,
  pendingPhoneNumber: null,
  pendingActorId: null,
  lastError: null,
  lastUpdatedAt: Date.now(),
};

let runtime = {
  getSocket: () => null,
  requestPairingCode: null,
};
const actorRequests = new Map();

function now() { return Date.now(); }

function normalizePhoneNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 32 || !/^[+\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < MIN_NUMBER_LENGTH || digits.length > MAX_NUMBER_LENGTH || digits.startsWith("0") || /^0+$/.test(digits)) return null;
  return digits;
}

function maskPhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length <= 4) return `••••${digits}`;
  return `${"•".repeat(Math.max(2, digits.length - 4))}${digits.slice(-4)}`;
}

function clearCode() {
  state.phoneNumber = null;
  state.code = null;
  state.codeIssuedAt = null;
  state.codeExpiresAt = null;
  state.requestSource = null;
}

function clearPendingRequest() {
  state.pendingPhoneNumber = null;
  state.pendingActorId = null;
}

function expireIfNeeded() {
  if (state.code && state.codeExpiresAt && state.codeExpiresAt <= now()) {
    clearCode();
    state.mode = "qr";
    state.lastError = "The previous pairing code expired. Request a new code.";
    state.lastUpdatedAt = now();
  }
}

function setRuntime(next = {}) {
  runtime = { ...runtime, ...next };
}

function updateConnection(connection, details = {}) {
  state.connection = String(connection || "unknown");
  if (typeof details.ready === "boolean") state.ready = details.ready;
  if (typeof details.registered === "boolean") state.registered = details.registered;
  if (state.ready) {
    clearCode();
    state.mode = "connected";
    state.lastError = null;
  } else if (state.connection === "close" && !activeCode()) {
    state.mode = "reconnecting";
  }
  state.lastUpdatedAt = now();
}

function setError(errorValue) {
  state.lastError = String(errorValue?.message || errorValue || "Pairing failed").slice(0, 240);
  state.lastUpdatedAt = now();
}

function activeCode() {
  expireIfNeeded();
  return Boolean(state.code && state.codeExpiresAt && state.codeExpiresAt > now());
}

function getStatus(options = {}) {
  expireIfNeeded();
  const active = activeCode();
  const status = {
    ready: state.ready,
    registered: state.registered,
    connection: state.connection,
    mode: state.ready ? "connected" : active ? "pairing-code" : state.mode,
    pending: active || state.connection === "connecting" || state.connection === "open" && state.mode === "pairing-code",
    phoneNumber: maskPhoneNumber(state.phoneNumber),
    codeIssuedAt: state.codeIssuedAt,
    codeExpiresAt: state.codeExpiresAt,
    secondsRemaining: active ? Math.max(0, Math.ceil((state.codeExpiresAt - now()) / 1000)) : 0,
    lastError: state.lastError,
    lastUpdatedAt: state.lastUpdatedAt,
  };
  if (options.includeCode && active) status.code = state.code;
  return status;
}

function isPending() {
  return Boolean(activeCode() && !state.ready && !state.registered);
}

function checkActorLimit(actorId) {
  const key = String(actorId || "dashboard").slice(0, 160);
  const current = now();
  const record = actorRequests.get(key);
  if (!record || current - record.windowStartedAt >= REQUEST_WINDOW_MS) {
    actorRequests.set(key, { windowStartedAt: current, count: 1, lastRequestedAt: current });
    return { ok: true };
  }
  if (record.count >= MAX_REQUESTS_PER_ACTOR) {
    return { ok: false, code: "rate_limited", retryAfterSeconds: Math.ceil((record.windowStartedAt + REQUEST_WINDOW_MS - current) / 1000) };
  }
  if (current - record.lastRequestedAt < REQUEST_COOLDOWN_MS) {
    return { ok: false, code: "cooldown", retryAfterSeconds: Math.ceil((record.lastRequestedAt + REQUEST_COOLDOWN_MS - current) / 1000) };
  }
  record.count += 1;
  record.lastRequestedAt = current;
  return { ok: true };
}

async function requestPairingCode(value, options = {}) {
  expireIfNeeded();
  if (state.ready || (state.registered && state.connection === "open")) return { success: false, code: "already_connected", error: "WhatsApp is already connected." };
  const phoneNumber = normalizePhoneNumber(value);
  if (!phoneNumber) {
    return { success: false, code: "invalid_number", error: "Enter a valid international WhatsApp number with country code, for example +2348012345678." };
  }
  if (activeCode()) {
    if (state.phoneNumber === phoneNumber) return { success: true, reused: true, ...getStatus({ includeCode: true }) };
    return { success: false, code: "pairing_in_progress", error: "A pairing code is already active. Use it or wait for it to expire before starting another number." };
  }
  const limit = checkActorLimit(options.actorId || "dashboard");
  if (!limit.ok) {
    return { success: false, ...limit, error: `Too many pairing attempts. Try again in about ${limit.retryAfterSeconds} seconds.` };
  }
  const socket = runtime.getSocket?.();
  if (!socket || typeof runtime.requestPairingCode !== "function") {
    return { success: false, code: "socket_unavailable", error: "WhatsApp is still starting. Keep this page open and try again when the session is online." };
  }
  state.mode = "pairing-code";
  state.phoneNumber = phoneNumber;
  state.requestSource = String(options.source || "dashboard").slice(0, 24);
  state.lastError = null;
  state.lastUpdatedAt = now();
  if (state.connection !== "open") {
    state.pendingPhoneNumber = phoneNumber;
    state.pendingActorId = String(options.actorId || "dashboard").slice(0, 160);
    // The runtime wrapper waits for Baileys' underlying WebSocket. This avoids
    // depending on the later high-level `connection === "open"` event, which
    // can be delayed until after phone pairing has already started.
    const request = issuePairingCode(phoneNumber);
    clearPendingRequest();
    return request;
  }
  return issuePairingCode(phoneNumber);
}

async function issuePairingCode(phoneNumber) {
  try {
    const code = await runtime.requestPairingCode(phoneNumber);
    if (!code) throw new Error("WhatsApp returned an empty pairing code.");
    clearPendingRequest();
    state.code = String(code).replace(/\s+/g, "").slice(0, 32);
    state.codeIssuedAt = now();
    state.codeExpiresAt = state.codeIssuedAt + CODE_TTL_MS;
    state.lastUpdatedAt = now();
    return { success: true, reused: false, ...getStatus({ includeCode: true }) };
  } catch (err) {
    clearPendingRequest();
    state.mode = "qr";
    state.lastError = "WhatsApp could not issue a pairing code. Check the number and try again.";
    state.lastUpdatedAt = now();
    return { success: false, code: "request_failed", error: state.lastError };
  }
}

async function issuePendingPairingCode() {
  const number = state.pendingPhoneNumber;
  if (!number || state.ready || state.registered || !["connecting", "open"].includes(state.connection)) return null;
  return issuePairingCode(number);
}

function resetPending() {
  if (state.ready || state.registered) return false;
  clearCode();
  clearPendingRequest();
  state.mode = "qr";
  state.lastError = null;
  state.lastUpdatedAt = now();
  return true;
}

module.exports = {
  normalizePhoneNumber,
  maskPhoneNumber,
  setRuntime,
  updateConnection,
  setError,
  requestPairingCode,
  issuePendingPairingCode,
  resetPending,
  isPending,
  getStatus,
  _test: {
    state,
    actorRequests,
    clearCode,
    expireIfNeeded,
    constants: { CODE_TTL_MS, REQUEST_COOLDOWN_MS, REQUEST_WINDOW_MS, MAX_REQUESTS_PER_ACTOR },
  },
};

module.exports._test.reset = () => {
  state.connection = "starting";
  state.ready = false;
  state.registered = false;
  state.mode = "qr";
  state.lastError = null;
  state.lastUpdatedAt = now();
  clearCode();
  clearPendingRequest();
  actorRequests.clear();
};
