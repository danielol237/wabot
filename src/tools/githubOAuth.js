const axios = require("axios");
const crypto = require("crypto");
const githubCredentialVault = require("./githubCredentialVault");

const DEVICE_ENDPOINT = "https://github.com/login/device/code";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const DEFAULT_SCOPE = "repo read:user";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_MS = 10 * 60 * 1000;
const pending = new Map();

function clientId() {
  return String(process.env.GITHUB_OAUTH_CLIENT_ID || "").trim();
}

function cleanError(value) {
  return String(value || "GitHub authorization failed").replace(/[\r\n]+/g, " ").slice(0, 240);
}

function normalizeDeviceResponse(data) {
  return Object.fromEntries(String(data || "").split("&").map((part) => part.split("=")).filter(([key]) => key).map(([key, value]) => [decodeURIComponent(key), decodeURIComponent(value || "")]));
}

function parseTokenResponse(data) {
  if (data && typeof data === "object") return data;
  return normalizeDeviceResponse(data);
}

function clearPending(actorJid) {
  const existing = pending.get(actorJid);
  if (existing) clearTimeout(existing.timer);
  pending.delete(actorJid);
}

async function requestDeviceCode() {
  if (!clientId()) throw new Error("GitHub OAuth is not configured. Add GITHUB_OAUTH_CLIENT_ID in the runtime environment.");
  const response = await axios.post(DEVICE_ENDPOINT, new URLSearchParams({ client_id: clientId(), scope: DEFAULT_SCOPE }).toString(), {
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300 || !response.data?.device_code) throw new Error(cleanError(response.data?.error_description || response.data?.message || `GitHub returned HTTP ${response.status}`));
  return response.data;
}

async function pollForToken(device, actorJid) {
  const deadline = Date.now() + MAX_POLL_MS;
  let interval = Math.max(Number(device.interval || 5) * 1000, POLL_INTERVAL_MS);
  while (Date.now() < deadline) {
    if (!pending.has(actorJid)) throw new Error("The GitHub authorization was cancelled.");
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (!pending.has(actorJid)) throw new Error("The GitHub authorization was cancelled.");
    const response = await axios.post(TOKEN_ENDPOINT, new URLSearchParams({ client_id: clientId(), device_code: device.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }).toString(), {
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
      validateStatus: () => true,
    });
    const result = parseTokenResponse(response.data);
    if (result.access_token) return result;
    if (result.error === "authorization_pending") continue;
    if (result.error === "slow_down") { interval += 5000; continue; }
    if (result.error === "expired_token") throw new Error("The GitHub authorization code expired. Start again.");
    if (result.error === "access_denied") throw new Error("GitHub authorization was denied.");
    throw new Error(cleanError(result.error_description || result.error || `GitHub returned HTTP ${response.status}`));
  }
  throw new Error("The GitHub authorization window expired. Start again when ready.");
}

async function startDeviceFlow({ actorJid, notify }) {
  const user = String(actorJid || "").trim();
  if (!user) return { success: false, error: "A WhatsApp user identity is required." };
  if (!clientId()) return { success: false, error: "GitHub OAuth is not configured yet. The administrator must add GITHUB_OAUTH_CLIENT_ID." };
  if (pending.has(user)) return { success: false, error: "A GitHub authorization is already waiting for you. Finish it or wait for it to expire." };
  try {
    const device = await requestDeviceCode();
    const state = crypto.randomBytes(16).toString("hex");
    const prompt = `🔐 *Connect GitHub securely*\n\n1. Open: ${device.verification_uri || device.verification_uri_complete}\n2. Enter this one-time code: *${device.user_code}*\n3. Approve ARIA’s requested GitHub access.\n\nThis code expires in about ${Math.round(Number(device.expires_in || 900) / 60)} minutes. ARIA will never ask you to paste a token.`;
    pending.set(user, { state, startedAt: Date.now(), timer: null });
    await notify(prompt);
    const run = async () => {
      try {
        const result = await pollForToken(device, user);
        const saved = githubCredentialVault.setTokenForUser(user, result.access_token);
        if (!saved.success) throw new Error("GitHub returned an unsupported credential format.");
        await notify("✅ GitHub is now securely linked to your WhatsApp account. ARIA stored the encrypted credential per user; no token was displayed or sent through WhatsApp.");
      } catch (error) {
        await notify(`❌ GitHub linking did not complete: ${cleanError(error.message)}`);
      } finally {
        clearPending(user);
      }
    };
    run().catch(() => clearPending(user));
    return { success: true, pending: true };
  } catch (error) {
    return { success: false, error: cleanError(error.message) };
  }
}

function cancelDeviceFlow(actorJid) {
  const user = String(actorJid || "").trim();
  const existed = pending.has(user);
  clearPending(user);
  return existed;
}

module.exports = {
  startDeviceFlow,
  cancelDeviceFlow,
  _test: { normalizeDeviceResponse, parseTokenResponse, pending, POLL_INTERVAL_MS, MAX_POLL_MS },
};
