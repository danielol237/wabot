const crypto = require("crypto");

const SESSION_TTL_MS = 60 * 60 * 1000;
const SYNC_TIMEOUT_MS = 8_000;

function clean(value, max = 240) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  return { url, key, configured: Boolean(url && key) };
}

function sessionSecret() {
  return String(process.env.COMPANION_SESSION_SECRET || "");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function issueCompanionSession({ userId, tenantId, supabaseSubject, email = "" } = {}) {
  if (!sessionSecret()) throw new Error("COMPANION_SESSION_SECRET is not configured");
  if (!userId || !tenantId || !supabaseSubject) throw new Error("companion session identity is incomplete");
  const payload = base64url(JSON.stringify({
    sub: String(userId),
    tid: String(tenantId),
    sid: String(supabaseSubject),
    email: clean(email, 180),
    exp: Date.now() + SESSION_TTL_MS,
  }));
  return `${payload}.${sign(payload)}`;
}

function verifyCompanionSession(token) {
  if (!token || !sessionSecret()) return null;
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const received = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.exp > Date.now() ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function verifySupabaseAccessToken(accessToken) {
  const config = supabaseConfig();
  if (!config.configured) {
    const error = new Error("Supabase Companion authentication is not configured.");
    error.code = "SUPABASE_NOT_CONFIGURED";
    throw error;
  }
  const token = clean(accessToken, 12000);
  if (!token) {
    const error = new Error("Supabase access token is required.");
    error.code = "SUPABASE_TOKEN_MISSING";
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      const error = new Error("Supabase access token is invalid or expired.");
      error.code = "SUPABASE_TOKEN_INVALID";
      error.status = response.status;
      throw error;
    }
    let user;
    try {
      user = JSON.parse(body);
    } catch (_) {
      const error = new Error("Supabase returned an invalid JSON response.");
      error.code = "SUPABASE_RESPONSE_INVALID";
      throw error;
    }
    if (!user?.id) {
      const error = new Error("Supabase did not return a valid user.");
      error.code = "SUPABASE_USER_INVALID";
      throw error;
    }
    return {
      id: clean(user.id, 120),
      email: clean(user.email, 180).toLowerCase(),
      displayName: clean(user.user_metadata?.full_name || user.user_metadata?.name || user.email || "ARIA Companion user", 120),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function syncRow(table, row) {
  if (String(process.env.COMPANION_SYNC_MESSAGES || "").toLowerCase() !== "true") return { synced: false, reason: "disabled" };
  const config = supabaseConfig();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!config.configured || !serviceKey) return { synced: false, reason: "not-configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
      signal: controller.signal,
    });
    if (!response.ok) return { synced: false, reason: `http-${response.status}` };
    return { synced: true };
  } catch (_) {
    return { synced: false, reason: "network-error" };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { supabaseConfig, issueCompanionSession, verifyCompanionSession, verifySupabaseAccessToken, syncRow, SESSION_TTL_MS };
