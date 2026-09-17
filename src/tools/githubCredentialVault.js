const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "githubCredentials.enc");
const LOCAL_KEY_FILE = path.join(DATA_DIR, "githubCredentials.key");
const ALGORITHM = "aes-256-gcm";
const KEY_ENV = "ARIA_CREDENTIAL_ENCRYPTION_KEY";

function normalizeUser(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9@._:-]/g, "").slice(0, 180);
}

function normalizeToken(value) {
  return String(value || "").trim().replace(/^[`'\"]|[`'\"]$/g, "");
}

function looksLikeGitHubToken(value) {
  const token = normalizeToken(value);
  return /^(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(token);
}

function githubCredentialType(value) {
  const token = normalizeToken(value);
  if (/^github_pat_/.test(token)) return "fine-grained-pat";
  if (/^ghp_/.test(token)) return "classic-pat";
  if (/^gho_/.test(token)) return "oauth-token";
  if (/^ghu_/.test(token)) return "user-to-server-token";
  if (/^ghs_/.test(token)) return "server-to-server-token";
  if (/^ghr_/.test(token)) return "refresh-token";
  return null;
}

function keyFromEnvironment() {
  const raw = String(process.env[KEY_ENV] || "").trim();
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptionKey() {
  const configured = keyFromEnvironment();
  if (configured) return { key: configured, source: "environment" };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOCAL_KEY_FILE)) {
    fs.writeFileSync(LOCAL_KEY_FILE, crypto.randomBytes(32).toString("base64url") + "\n", { mode: 0o600 });
  }
  const local = String(fs.readFileSync(LOCAL_KEY_FILE, "utf8")).trim();
  return { key: crypto.createHash("sha256").update(local).digest(), source: "local-key-file" };
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return parsed && typeof parsed === "object" && parsed.version === 1 ? parsed.users || {} : {};
  } catch (_) {
    return {};
  }
}

function writeStore(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, users }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, STORE_FILE);
}

function encrypt(value) {
  const { key } = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: ciphertext.toString("base64url") };
}

function decrypt(record) {
  try {
    const { key } = encryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(record.data, "base64url")), decipher.final()]).toString("utf8");
  } catch (_) {
    return "";
  }
}

function setTokenForUser(userJid, token) {
  const user = normalizeUser(userJid);
  const value = normalizeToken(token);
  if (!user) return { success: false, error: "A user identity is required." };
  if (!looksLikeGitHubToken(value)) return { success: false, error: "That does not look like a supported GitHub token." };
  const users = readStore();
  users[user] = { ...(users[user] || {}), ...encrypt(value), credentialType: githubCredentialType(value), updatedAt: Date.now(), source: "private-whatsapp" };
  writeStore(users);
  return { success: true, source: encryptionKey().source };
}

function setWorkspaceForUser(userJid, repository) {
  const user = normalizeUser(userJid);
  const repo = String(repository || "").trim();
  if (!user || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { success: false, error: "Use a repository in owner/repo format." };
  const users = readStore();
  users[user] = { ...(users[user] || {}), workspace: repo, workspaceUpdatedAt: Date.now() };
  writeStore(users);
  return { success: true, repository: repo };
}

function getWorkspaceForUser(userJid) {
  return readStore()[normalizeUser(userJid)]?.workspace || "";
}

function getTokenForUser(userJid) {
  const record = readStore()[normalizeUser(userJid)];
  if (!record) return "";
  return decrypt(record);
}

function clearTokenForUser(userJid) {
  const user = normalizeUser(userJid);
  const users = readStore();
  if (users[user]) {
    const workspace = users[user].workspace;
    const workspaceUpdatedAt = users[user].workspaceUpdatedAt;
    users[user] = workspace ? { workspace, workspaceUpdatedAt } : undefined;
    if (!users[user]) delete users[user];
    writeStore(users);
  }
}

function clearWorkspaceForUser(userJid) {
  const user = normalizeUser(userJid);
  const users = readStore();
  if (users[user]?.workspace) {
    delete users[user].workspace;
    delete users[user].workspaceUpdatedAt;
    writeStore(users);
  }
}

function statusForUser(userJid) {
  const token = getTokenForUser(userJid);
  const record = readStore()[normalizeUser(userJid)];
  return { configured: Boolean(token), source: token ? "private-whatsapp" : null, credentialType: token ? (record?.credentialType || githubCredentialType(token)) : null, updatedAt: record?.updatedAt || null, encryption: encryptionKey().source };
}

// Backward-compatible single-user helpers used only by older tests/callers.
function setToken(token, options = {}) { return setTokenForUser("legacy", token, options); }
function getToken() { return getTokenForUser("legacy"); }
function clearToken() { clearTokenForUser("legacy"); }
function status() { return statusForUser("legacy"); }

module.exports = {
  setTokenForUser,
  getTokenForUser,
  clearTokenForUser,
  statusForUser,
  setWorkspaceForUser,
  getWorkspaceForUser,
  clearWorkspaceForUser,
  looksLikeGitHubToken,
  githubCredentialType,
  setToken,
  getToken,
  clearToken,
  status,
  _test: { normalizeToken, normalizeUser, encrypt, decrypt, STORE_FILE, LOCAL_KEY_FILE },
};
