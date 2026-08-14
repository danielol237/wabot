const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "../../data/portalLinks.json");
const CODE_TTL = 15 * 60 * 1000;
let state = { codes: {}, accounts: {} };

function load() {
  try {
    state = JSON.parse(fs.readFileSync(FILE, "utf8")) || { codes: {}, accounts: {} };
    state.codes = state.codes || {};
    state.accounts = state.accounts || {};
  } catch (_) {
    state = { codes: {}, accounts: {} };
  }
}
function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
    try { fs.chmodSync(FILE, 0o600); } catch (_) {}
  } catch (_) {}
}
function clean() {
  const now = Date.now();
  for (const [code, entry] of Object.entries(state.codes)) {
    if (!entry || entry.expiresAt <= now) delete state.codes[code];
  }
}
function normalizeUid(jid) {
  return String(jid || "").split("@")[0].split(":")[0].trim();
}
function issueCode(jid) {
  clean();
  const uid = normalizeUid(jid);
  if (!uid) throw new Error("WhatsApp identity unavailable");
  let code;
  do { code = crypto.randomBytes(4).toString("hex").toUpperCase(); } while (state.codes[code]);
  state.codes[code] = { uid, expiresAt: Date.now() + CODE_TTL };
  save();
  return { code, expiresAt: state.codes[code].expiresAt };
}
function consumeCode(input) {
  clean();
  const code = String(input || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const entry = state.codes[code];
  if (!entry || entry.expiresAt <= Date.now()) { save(); return null; }
  delete state.codes[code];
  save();
  return entry.uid;
}
function linkAccount(accountId, uid) {
  const id = String(accountId || "").trim();
  const normalized = normalizeUid(uid);
  if (!id || !normalized) return false;
  state.accounts[id] = { uid: normalized, linkedAt: Date.now() };
  save();
  return true;
}
function unlinkAccount(accountId) {
  delete state.accounts[String(accountId || "").trim()];
  save();
}
function getLinkedUid(accountId) {
  clean();
  return state.accounts[String(accountId || "").trim()]?.uid || null;
}

load();
clean();
save();

module.exports = { issueCode, consumeCode, linkAccount, unlinkAccount, getLinkedUid, normalizeUid, CODE_TTL };
