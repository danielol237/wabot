const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ACCOUNTS_FILE = path.join(__dirname, "../../data/dashboardAccounts.json");
const SESSIONS_FILE = path.join(__dirname, "../../data/dashboardSessions.json");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N=16384, r=8, p=1
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;

const DEFAULT_ROLE_PERMISSIONS = {
  owner: [
    "dashboard.read", "activity.read", "system.read", "memory.read",
    "missions.read", "missions.create", "missions.cancel", "missions.retry",
    "github.read", "github.write", "github.commit", "github.pull_request",
    "connectors.read", "connectors.manage", "connectors.reconnect",
    "companion.read", "companion.manage", "research.read", "research.run",
    "files.read", "files.write", "services.read", "services.restart",
    "settings.read", "settings.write", "account.manage", "sessions.revoke"
  ],
  operator: [
    "dashboard.read", "activity.read", "system.read", "memory.read",
    "missions.read", "missions.create", "missions.cancel", "missions.retry",
    "connectors.read", "research.read", "research.run", "services.read"
  ],
  viewer: [
    "dashboard.read", "activity.read", "system.read", "memory.read",
    "missions.read", "connectors.read", "github.read", "companion.read",
    "research.read", "services.read"
  ]
};

// Rate limiting & Lockout state
const loginAttempts = new Map(); // key (username or IP) -> { count, resetAt, lockedUntil }

// Internal state maps
let accountsMap = new Map(); // username -> { username, role, passwordHash, salt, createdAt, updatedAt }
let sessionsMap = new Map();  // sessionHash -> { idHash, username, role, createdAt, expiresAt, lastSeenAt, userAgent, ip }

function atomicWriteJson(filepath, data) {
  try {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tmp = `${filepath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, filepath);
    try { fs.chmodSync(filepath, 0o600); } catch (_) {}
  } catch (err) {
    console.error(`[dashboardAuth] Atomic write failed for ${filepath}:`, err.message);
  }
}

function loadAccounts() {
  accountsMap.clear();
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
      if (Array.isArray(raw)) {
        for (const acc of raw) {
          if (acc && acc.username && acc.passwordHash && acc.salt) {
            accountsMap.set(acc.username.toLowerCase(), acc);
          }
        }
      }
    }
  } catch (err) {
    console.error("[dashboardAuth] Error loading accounts:", err.message);
  }
}

function persistAccounts() {
  const list = Array.from(accountsMap.values());
  atomicWriteJson(ACCOUNTS_FILE, list);
}

function loadSessions() {
  sessionsMap.clear();
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
      const now = Date.now();
      if (typeof raw === "object" && raw !== null) {
        for (const [hash, sess] of Object.entries(raw)) {
          if (sess && sess.expiresAt && sess.expiresAt > now) {
            sessionsMap.set(hash, sess);
          }
        }
      }
    }
  } catch (err) {
    console.error("[dashboardAuth] Error loading sessions:", err.message);
  }
}

function persistSessions() {
  const now = Date.now();
  const out = {};
  for (const [hash, sess] of sessionsMap.entries()) {
    if (sess.expiresAt > now) {
      out[hash] = sess;
    } else {
      sessionsMap.delete(hash);
    }
  }
  atomicWriteJson(SESSIONS_FILE, out);
}

// Initial load
loadAccounts();
loadSessions();

// Password hashing helpers
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELISM },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(derivedKey.toString("hex"));
      }
    );
  });
}

function hashPasswordSync(password, salt) {
  const derivedKey = crypto.scryptSync(
    password,
    salt,
    SCRYPT_KEYLEN,
    { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELISM }
  );
  return derivedKey.toString("hex");
}

function timingSafeEqualHex(aHex, bHex) {
  try {
    const bufA = Buffer.from(aHex, "hex");
    const bufB = Buffer.from(bHex, "hex");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (_) {
    return false;
  }
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex"); // 256 bits
}

// Dummy salt for timing-safe failed attempts
const DUMMY_SALT = "00112233445566778899aabbccddeeff";
const DUMMY_HASH = hashPasswordSync("dummy_password_verification", DUMMY_SALT);

// Account setup & Management
function hasOwnerAccount() {
  for (const acc of accountsMap.values()) {
    if (acc.role === "owner") return true;
  }
  return false;
}

function getAccountCount() {
  return accountsMap.size;
}

async function createAccount(username, password, role = "owner") {
  const cleanUser = String(username || "").trim().toLowerCase();
  if (!cleanUser || cleanUser.length < 3 || cleanUser.length > 50) {
    throw new Error("Username must be between 3 and 50 characters.");
  }
  if (role === "owner" && hasOwnerAccount()) {
    throw new Error("Owner account already setup.");
  }
  if (accountsMap.has(cleanUser)) {
    throw new Error("Account already exists.");
  }
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(password, salt);
  const now = Date.now();

  const account = {
    username: cleanUser,
    role: role || "owner",
    passwordHash,
    salt,
    createdAt: now,
    updatedAt: now
  };

  accountsMap.set(cleanUser, account);
  persistAccounts();
  return { username: account.username, role: account.role, createdAt: account.createdAt };
}

// Login Throttling / Rate Limiting
function getLoginAttemptKey(ip, username) {
  return `${ip || "unknown"}_${(username || "").toLowerCase()}`;
}

function checkLoginThrottled(ip, username) {
  const key = getLoginAttemptKey(ip, username);
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec) return { throttled: false };

  if (rec.lockedUntil && now < rec.lockedUntil) {
    const secondsLeft = Math.ceil((rec.lockedUntil - now) / 1000);
    return { throttled: true, lockedUntil: rec.lockedUntil, secondsLeft };
  }

  if (now > rec.resetAt) {
    loginAttempts.delete(key);
    return { throttled: false };
  }

  if (rec.count >= 8) {
    // 8 failed attempts = 15 minute lock
    rec.lockedUntil = now + 15 * 60 * 1000;
    const secondsLeft = Math.ceil(15 * 60);
    return { throttled: true, lockedUntil: rec.lockedUntil, secondsLeft };
  }

  return { throttled: false };
}

function recordLoginFailure(ip, username) {
  const key = getLoginAttemptKey(ip, username);
  const now = Date.now();
  const rec = loginAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000, lockedUntil: null };
  rec.count++;
  if (rec.count >= 8 && !rec.lockedUntil) {
    rec.lockedUntil = now + 15 * 60 * 1000;
  }
  loginAttempts.set(key, rec);
}

function clearLoginFailures(ip, username) {
  const key = getLoginAttemptKey(ip, username);
  loginAttempts.delete(key);
}

// Authentication Verification
async function verifyCredentials(username, password) {
  const cleanUser = String(username || "").trim().toLowerCase();
  const account = accountsMap.get(cleanUser);

  if (!account) {
    // Dummy check to prevent timing attacks
    await hashPassword(password || "", DUMMY_SALT);
    return null;
  }

  const computedHash = await hashPassword(password || "", account.salt);
  const match = timingSafeEqualHex(computedHash, account.passwordHash);

  if (!match) return null;

  return {
    username: account.username,
    role: account.role
  };
}

// Session Management
function createSession(username, role, options = {}) {
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const expiresAt = now + (options.ttlMs || SESSION_TTL_MS);

  const session = {
    idHash: tokenHash,
    username: username.toLowerCase(),
    role: role || "owner",
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
    userAgent: options.userAgent || "",
    ip: options.ip || ""
  };

  sessionsMap.set(tokenHash, session);
  persistSessions();

  return {
    rawToken,
    session
  };
}

function validateSessionToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const tokenHash = hashToken(rawToken);
  const session = sessionsMap.get(tokenHash);
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt <= now) {
    sessionsMap.delete(tokenHash);
    persistSessions();
    return null;
  }

  session.lastSeenAt = now;
  return session;
}

function revokeSessionByToken(rawToken) {
  if (!rawToken) return false;
  const tokenHash = hashToken(rawToken);
  const deleted = sessionsMap.delete(tokenHash);
  if (deleted) persistSessions();
  return deleted;
}

function revokeSessionByHash(idHash) {
  if (!idHash) return false;
  const deleted = sessionsMap.delete(idHash);
  if (deleted) persistSessions();
  return deleted;
}

function listActiveSessionsForUser(username) {
  const cleanUser = String(username || "").toLowerCase();
  const now = Date.now();
  const list = [];
  for (const [hash, sess] of sessionsMap.entries()) {
    if (sess.expiresAt > now && sess.username === cleanUser) {
      list.push({
        idHash: hash,
        username: sess.username,
        role: sess.role,
        createdAt: sess.createdAt,
        expiresAt: sess.expiresAt,
        lastSeenAt: sess.lastSeenAt,
        userAgent: sess.userAgent,
        ip: sess.ip
      });
    }
  }
  return list;
}

function getPermissionsForRole(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.viewer;
}

function hasPermission(role, permission) {
  const perms = getPermissionsForRole(role);
  return perms.includes(permission);
}

// CSRF tokens tied to session token
function generateCsrfToken(rawSessionToken) {
  const secret = process.env.DASHBOARD_CSRF_SECRET || "aria_csrf_secret_key";
  return crypto.createHmac("sha256", secret).update(rawSessionToken || "").digest("hex").slice(0, 32);
}

function validateCsrfToken(rawSessionToken, csrfGiven) {
  if (!csrfGiven || !rawSessionToken) return false;
  const expected = generateCsrfToken(rawSessionToken);
  return crypto.timingSafeEqual(Buffer.from(csrfGiven), Buffer.from(expected));
}

module.exports = {
  hasOwnerAccount,
  getAccountCount,
  createAccount,
  checkLoginThrottled,
  recordLoginFailure,
  clearLoginFailures,
  verifyCredentials,
  createSession,
  validateSessionToken,
  revokeSessionByToken,
  revokeSessionByHash,
  listActiveSessionsForUser,
  getPermissionsForRole,
  hasPermission,
  generateCsrfToken,
  validateCsrfToken,
  hashToken,
  // exported for testing
  _resetForTesting: () => {
    accountsMap.clear();
    sessionsMap.clear();
    loginAttempts.clear();
  }
};
