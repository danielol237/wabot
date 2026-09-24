"use strict";

/**
 * Per-user encrypted store for Macaly sign-ins (same approach as githubCredentialVault).
 * Each WhatsApp user has their own record; nothing is shared between users.
 *
 * Key: ARIA_CREDENTIAL_ENCRYPTION_KEY if set, otherwise a local key file next to the store.
 * Location: ./data (override with MACALY_DATA_DIR).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_ENV = "ARIA_CREDENTIAL_ENCRYPTION_KEY";

function dataDir() { return process.env.MACALY_DATA_DIR || path.join(__dirname, "../../data"); }
function storeFile() { return path.join(dataDir(), "macalyCredentials.enc"); }
function keyFile() { return path.join(dataDir(), "macalyCredentials.key"); }

function normalizeUser(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9@._:-]/g, "").slice(0, 180);
}

function encryptionKey() {
  const configured = String(process.env[KEY_ENV] || "").trim();
  if (configured) return crypto.createHash("sha256").update(configured).digest();
  fs.mkdirSync(dataDir(), { recursive: true });
  if (!fs.existsSync(keyFile())) fs.writeFileSync(keyFile(), crypto.randomBytes(32).toString("base64url") + "\n", { mode: 0o600 });
  return crypto.createHash("sha256").update(String(fs.readFileSync(keyFile(), "utf8")).trim()).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: data.toString("base64url") };
}

function decrypt(record) {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(record.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(record.data, "base64url")), decipher.final()]).toString("utf8");
  } catch (_) {
    return "";
  }
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    if (parsed && parsed.version === 1) return { users: parsed.users || {}, clients: parsed.clients || {} };
  } catch (_) { /* first run or unreadable store */ }
  return { users: {}, clients: {} };
}

function writeStore(store) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const temp = `${storeFile()}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, ...store }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, storeFile());
}

function open(record) {
  if (!record) return null;
  const text = decrypt(record);
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

function setForUser(userJid, credential) {
  const user = normalizeUser(userJid);
  if (!user || !credential || typeof credential !== "object") return { success: false, error: "A user identity and credential are required." };
  const store = readStore();
  store.users[user] = { ...encrypt(JSON.stringify(credential)), updatedAt: Date.now() };
  writeStore(store);
  return { success: true };
}

function getForUser(userJid) {
  return open(readStore().users[normalizeUser(userJid)]);
}

function clearForUser(userJid) {
  const user = normalizeUser(userJid);
  const store = readStore();
  if (store.users[user]) {
    delete store.users[user];
    writeStore(store);
  }
}

function setClient(key, client) {
  const store = readStore();
  store.clients[String(key)] = encrypt(JSON.stringify(client));
  writeStore(store);
}

function getClient(key) {
  return open(readStore().clients[String(key)]);
}

module.exports = { setForUser, getForUser, clearForUser, setClient, getClient, _test: { normalizeUser, storeFile } };
