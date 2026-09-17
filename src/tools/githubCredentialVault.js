const DEFAULT_TTL_MS = 30 * 60 * 1000;

let active = null;
let expiryTimer = null;

function normalizeToken(value) {
  return String(value || "").trim().replace(/^[`'\"]|[`'\"]$/g, "");
}

function looksLikeGitHubToken(value) {
  const token = normalizeToken(value);
  return /^(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(token);
}

function setToken(token, options = {}) {
  const value = normalizeToken(token);
  if (!looksLikeGitHubToken(value)) return { success: false, error: "That does not look like a supported GitHub token." };
  clearToken();
  const ttlMs = Math.min(Math.max(Number(options.ttlMs) || DEFAULT_TTL_MS, 60_000), 24 * 60 * 60 * 1000);
  active = { value, source: "private-whatsapp", expiresAt: Date.now() + ttlMs };
  expiryTimer = setTimeout(() => clearToken(), ttlMs);
  expiryTimer.unref?.();
  return { success: true, expiresAt: active.expiresAt };
}

function getToken() {
  if (!active || active.expiresAt <= Date.now()) {
    clearToken();
    return "";
  }
  return active.value;
}

function clearToken() {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (active?.value) active.value = "";
  active = null;
}

function status() {
  const value = getToken();
  return { configured: Boolean(value), source: value ? "private-whatsapp" : null, expiresAt: active?.expiresAt || null };
}

module.exports = { setToken, getToken, clearToken, status, looksLikeGitHubToken, _test: { normalizeToken } };
