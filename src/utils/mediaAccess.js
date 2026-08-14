const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");

const TOKEN_TTL_MS = Math.min(30 * 60 * 1000, Math.max(60 * 1000, Number(process.env.MEDIA_TOKEN_TTL_MS || 10 * 60 * 1000)));

function secret() {
  return process.env.MEDIA_PROXY_SECRET || process.env.PORTAL_SESSION_SECRET || process.env.DASHBOARD_CSRF_SECRET || process.env.DASHBOARD_PASSWORD || "";
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(body) {
  const key = secret();
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(body).digest("base64url");
}

function issueMediaToken({ url, headers = {}, provider = "", jobId = "" } = {}, ttlMs = TOKEN_TTL_MS) {
  if (!url || !secret()) return null;
  const body = encode({
    purpose: "aria-media",
    url: String(url),
    headers: Object.fromEntries(Object.entries(headers || {}).filter(([k]) => /^(user-agent|referer|origin)$/i.test(k))),
    provider: String(provider || ""),
    jobId: String(jobId || ""),
    exp: Date.now() + ttlMs,
  });
  const sig = sign(body);
  return sig ? `${body}.${sig}` : null;
}

function issueFileToken(jobId, ttlMs = TOKEN_TTL_MS) {
  if (!jobId || !secret()) return null;
  const body = encode({ purpose: "aria-file", jobId: String(jobId), exp: Date.now() + ttlMs });
  const sig = sign(body);
  return sig ? `${body}.${sig}` : null;
}

function verifyFileToken(token, jobId) {
  if (!token || !jobId || !secret()) return null;
  try {
    const [body, signature] = String(token).split(".");
    if (!body || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(body)))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.purpose !== "aria-file" || payload.jobId !== String(jobId) || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function verifyMediaToken(token) {
  if (!token || !secret()) return null;
  try {
    const [body, signature] = String(token).split(".");
    if (!body || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(body)))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.purpose !== "aria-media" || !payload.url || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function isPrivateAddress(address) {
  const normalized = String(address || "").toLowerCase();
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(normalized)) {
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
}

async function validateMediaTarget(target) {
  let parsed;
  try { parsed = new URL(String(target || "")); } catch (_) { return { ok: false, reason: "invalid media URL" }; }
  if (parsed.protocol !== "https:") return { ok: false, reason: "media source must use HTTPS" };
  if (!parsed.hostname || parsed.username || parsed.password) return { ok: false, reason: "invalid media host" };
  const allowlist = String(process.env.MEDIA_ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowlist.length && !allowlist.some((host) => parsed.hostname.toLowerCase() === host || parsed.hostname.toLowerCase().endsWith(`.${host}`))) {
    return { ok: false, reason: "media host is not authorized" };
  }
  try {
    const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) return { ok: false, reason: "private media host rejected" };
    const selected = addresses[0];
    return { ok: true, url: parsed, address: selected.address, family: selected.family };
  } catch (_) {
    return { ok: false, reason: "media host could not be resolved" };
  }
}

module.exports = { issueMediaToken, verifyMediaToken, issueFileToken, verifyFileToken, validateMediaTarget, TOKEN_TTL_MS };
