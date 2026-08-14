const crypto = require("crypto");
const dns = require("dns").promises;
const http = require("http");
const https = require("https");
const net = require("net");
const axios = require("axios");

const DEFAULT_MAX_REDIRECTS = 5;
const PUBLIC_PROTOCOLS = new Set(["http:", "https:"]);

function isPrivateAddress(address) {
  const value = String(address || "").toLowerCase().split("%")[0];
  if (net.isIPv4(value)) {
    const [a, b, c] = value.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) || (a === 198 && b >= 18 && b <= 19) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) ||
      a >= 224;
  }
  if (net.isIPv6(value)) {
    if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
    return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
      value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") ||
      value.startsWith("feb") || value.startsWith("2001:db8:") || value.startsWith("ff");
  }
  return true;
}

function hostAllowed(hostname, allowHosts = []) {
  if (!allowHosts.length) return true;
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return allowHosts.some((entry) => {
    const allowed = String(entry || "").trim().toLowerCase().replace(/\.$/, "");
    return allowed && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

function normalizeAllowHosts(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
}

async function resolvePublicAddress(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("private destination rejected");
    return { address: hostname, family: net.isIPv4(hostname) ? 4 : 6 };
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("private or unresolved destination rejected");
  }
  const selected = records[0];
  return { address: selected.address, family: selected.family };
}

async function validateOutboundUrl(rawUrl, options = {}) {
  let url;
  try { url = new URL(String(rawUrl || "")); } catch (_) { return { ok: false, reason: "invalid URL" }; }
  const protocols = options.protocols ? new Set(options.protocols) : PUBLIC_PROTOCOLS;
  if (!protocols.has(url.protocol)) return { ok: false, reason: "unsupported URL scheme" };
  if (!url.hostname || url.username || url.password) return { ok: false, reason: "credential-bearing URL rejected" };
  if (!hostAllowed(url.hostname, normalizeAllowHosts(options.allowHosts))) return { ok: false, reason: "host is not authorized" };
  try {
    const resolved = await resolvePublicAddress(url.hostname);
    return { ok: true, url, address: resolved.address, family: resolved.family };
  } catch (error) {
    return { ok: false, reason: error.message || "destination could not be resolved" };
  }
}

function pinnedAgent(target) {
  const Agent = target.url.protocol === "https:" ? https.Agent : http.Agent;
  return new Agent({
    keepAlive: false,
    lookup(_hostname, options, callback) { options?.all ? callback(null, [{ address: target.address, family: target.family }]) : callback(null, target.address, target.family); },
  });
}

async function requestWithPolicy(rawUrl, options = {}) {
  const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : DEFAULT_MAX_REDIRECTS;
  const policyOptions = options.policy || {};
  const requestOptions = { ...options };
  delete requestOptions.policy;
  delete requestOptions.maxRedirects;
  let current = String(rawUrl || "");
  let response;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const target = await validateOutboundUrl(current, policyOptions);
    if (!target.ok) throw new Error(target.reason);
    const agent = pinnedAgent(target);
    try {
      response = await axios.request({
        ...requestOptions,
        url: target.url.toString(),
        maxRedirects: 0,
        httpAgent: target.url.protocol === "http:" ? agent : requestOptions.httpAgent || undefined,
        httpsAgent: target.url.protocol === "https:" ? agent : requestOptions.httpsAgent || undefined,
        validateStatus: (status) => status >= 200 && status < 400,
      });
    } catch (error) {
      if (error.response) response = error.response;
      else throw error;
    }
    if (response.status < 300 || response.status >= 400) return { response, target };
    const location = response.headers?.location;
    if (!location) throw new Error("redirect without location rejected");
    current = new URL(location, target.url).toString();
    if (response.data && typeof response.data.destroy === "function") response.data.destroy();
  }
  throw new Error("too many redirects");
}

function safeHeaderValue(value) {
  return /^[\x20-\x7e\t]*$/.test(String(value || "")) && !/[\r\n]/.test(String(value || ""));
}

function sanitizeHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || !safeHeaderValue(value)) continue;
    out[key] = String(value);
  }
  return out;
}

function hashUrl(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex").slice(0, 16);
}

module.exports = {
  isPrivateAddress,
  validateOutboundUrl,
  requestWithPolicy,
  sanitizeHeaders,
  hashUrl,
};
