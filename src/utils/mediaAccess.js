const crypto = require("crypto");
const { validateOutboundUrl } = require("./outboundUrlPolicy");

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

function issueFileToken(jobId, ttlMs = TOKEN_TTL_MS, ownerId = "") {
  if (!jobId || !secret()) return null;
  const body = encode({ purpose: "aria-file", jobId: String(jobId), ownerId: String(ownerId || ""), exp: Date.now() + ttlMs });
  const sig = sign(body);
  return sig ? `${body}.${sig}` : null;
}

function verifyFileToken(token, jobId, ownerId = "") {
  if (!token || !jobId || !secret()) return null;
  try {
    const [body, signature] = String(token).split(".");
    if (!body || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(body)))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.purpose !== "aria-file" || payload.jobId !== String(jobId) || String(payload.ownerId || "") !== String(ownerId || "") || !payload.exp || payload.exp < Date.now()) return null;
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

async function validateMediaTarget(target) {
  const allowlist = String(process.env.MEDIA_ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const result = await validateOutboundUrl(target, { protocols: ["https:"], allowHosts: allowlist });
  if (!result.ok) {
    const reason = result.reason === "host is not authorized" ? "media host is not authorized" :
      result.reason.includes("private") || result.reason.includes("unresolved") ? "private media host rejected" : result.reason;
    return { ok: false, reason };
  }
  return { ok: true, url: result.url, address: result.address, family: result.family };
}

module.exports = { issueMediaToken, verifyMediaToken, issueFileToken, verifyFileToken, validateMediaTarget, TOKEN_TTL_MS };
