// ── ARIA Session Persistence (Git-backed) ─────────────────────
// Render free tier wipes the ephemeral filesystem on every restart/redeploy,
// so the WhatsApp session (sessions/) dies and forces a re-scan. This module
// backs the session up to a PRIVATE git repo and restores it on boot, so the
// WhatsApp link survives restarts — no more scanning QR codes repeatedly.
//
// Env vars:
//   SESSION_GIT_REPO   — e.g. "gh_username/aria-session" (private repo)
//   GITHUB_TOKEN       — a PAT with repo scope
//   SESSION_SYNC_INTERVAL — seconds between auto-sync (default 60)

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { log, error, warn } = require("../utils/logger");

const HOME = path.join(__dirname, "../..");
const SESSIONS_DIR = path.join(HOME, "sessions");
const GIT_DIR = path.join(HOME, ".session-sync");

const REPO = process.env.SESSION_GIT_REPO || "";
const TOKEN = process.env.GITHUB_TOKEN || "";

// Static askpass helper — reads the token from its own environment, so the
// secret never appears in the git process argv (which other users/processes
// could inspect via /proc/<pid>/cmdline). The script file itself holds no
// secret; the token travels only as an env var passed to the child.
const ASKPASS_FILE = path.join(HOME, ".session-askpass");
try {
  fs.writeFileSync(ASKPASS_FILE, "#!/bin/sh\necho \"$ARIA_SESSION_TOKEN\"\n", { mode: 0o700 });
} catch (_) {}

function syncEnabled() {
  return !!REPO && !!TOKEN;
}

// ── At-rest encryption ────────────────────────────────────────
// Session files are committed to a (private) git repo. Even private repos can
// leak — leaked PAT, compromised account, accidental visibility change. So we
// encrypt each file with AES-256-GCM before committing, using a key derived
// from SESSION_ENCRYPT_KEY (preferred) or GITHUB_TOKEN. Files are decrypted
// back to plaintext in the live sessions/ dir on restore, so Baileys is
// untouched. Envelope: [12-byte IV][16-byte authTag][ciphertext].
function deriveKey() {
  if (!process.env.SESSION_ENCRYPT_KEY) {
    warn("⚠️ SESSION_ENCRYPT_KEY not set — deriving session encryption key from GITHUB_TOKEN. Set a dedicated SESSION_ENCRYPT_KEY so rotating GITHUB_TOKEN doesn't make old backups undecryptable.");
  }
  const secret = process.env.SESSION_ENCRYPT_KEY || TOKEN;
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptBuffer(buf, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function decryptBuffer(buf, key) {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Encrypt every file under `dir` in place (used on the git-side copy before
// commit). Returns list of processed files.
function encryptTree(dir, key) {
  const processed = [];
  for (const p of walk(dir)) {
    try {
      fs.writeFileSync(p, encryptBuffer(fs.readFileSync(p), key));
      processed.push(p);
    } catch (e) { warn("Encrypt failed for " + p + ": " + e.message); }
  }
  return processed;
}

// Decrypt every file under `dir` in place (used after pulling the git copy
// before copying into the live sessions dir).
function decryptTree(dir, key) {
  for (const p of walk(dir)) {
    try {
      fs.writeFileSync(p, decryptBuffer(fs.readFileSync(p), key));
    } catch (e) { warn("Decrypt failed for " + p + ": " + e.message); }
  }
}

function git(args, cwd, timeout = 30000) {
  return new Promise((resolve) => {
    execFile("git", args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ARIA_SESSION_TOKEN: TOKEN, GIT_ASKPASS: ASKPASS_FILE, GIT_TERMINAL_PROMPT: "0" },
    }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, err: (stderr || err.message).trim() });
      else resolve({ ok: true, out: (stdout || "").trim() });
    });
  });
}

// Clone (or open) the private session repo
async function ensureRepo() {
  if (!fs.existsSync(path.join(GIT_DIR, ".git"))) {
    if (fs.existsSync(GIT_DIR)) fs.rmSync(GIT_DIR, { recursive: true, force: true });
    fs.mkdirSync(GIT_DIR, { recursive: true });
    // No token in the URL: git asks GIT_ASKPASS (which reads the token from
    // env) for the password, so the secret never lands in argv.
    const url = `https://x-access-token@github.com/${REPO}.git`;
    const r = await git(["clone", url, "."], GIT_DIR);
    if (!r.ok) return { ok: false, err: r.err };
  }
  // Normalize the remote to the credential-free URL so later push/pull also
  // go through askpass (in case a previous run stored the tokenized URL).
  await git(["remote", "set-url", "origin", `https://x-access-token@github.com/${REPO}.git`], GIT_DIR);
  // Configure identity so commit works
  await git(["config", "user.email", "aria@wabot.local"], GIT_DIR);
  await git(["config", "user.name", "ARIA"], GIT_DIR);
  return { ok: true };
}

// Push the current session files to the repo
async function backupSession() {
  if (!syncEnabled()) return { ok: false, err: "session persistence not configured" };
  if (!fs.existsSync(SESSIONS_DIR)) return { ok: true }; // nothing to back up yet

  const ensure = await ensureRepo();
  if (!ensure.ok) return ensure;

  // Copy session files into the git dir
  fs.mkdirSync(path.join(GIT_DIR, "sessions"), { recursive: true });
  try {
    fs.rmSync(path.join(GIT_DIR, "sessions"), { recursive: true, force: true });
    fs.cpSync(SESSIONS_DIR, path.join(GIT_DIR, "sessions"), { recursive: true });
  } catch (e) {
    return { ok: false, err: "copy failed: " + e.message };
  }

  // Encrypt the git-side copy so the repo never holds plaintext session keys.
  encryptTree(path.join(GIT_DIR, "sessions"), deriveKey());

  await git(["add", "-A"], GIT_DIR);
  const status = await git(["status", "--porcelain"], GIT_DIR);
  if (status.out === "") return { ok: true, changed: false }; // nothing new

  const commit = await git(["commit", "-m", `session backup ${new Date().toISOString()}`], GIT_DIR);
  if (!commit.ok && !/nothing to commit/i.test(commit.err)) return { ok: false, err: commit.err };

  const push = await git(["push", "origin", "HEAD"], GIT_DIR);
  if (!push.ok) return { ok: false, err: push.err };
  return { ok: true, changed: true };
}

// Restore session files from the repo on boot
async function restoreSession() {
  if (!syncEnabled()) return { ok: false, err: "session persistence not configured" };

  const ensure = await ensureRepo();
  if (!ensure.ok) return ensure;

  const pull = await git(["pull", "origin", "HEAD"], GIT_DIR);
  if (!pull.ok) return { ok: false, err: pull.err };

  const backed = path.join(GIT_DIR, "sessions");
  if (!fs.existsSync(backed)) return { ok: false, err: "no backed-up session found" };

  // Decrypt into a staging directory (NOT in place in the git working tree).
  // Decrypting tracked files in-place would leave .session-sync dirty and make
  // the next `git pull` conflict with modified tracked files.
  const staging = path.join(HOME, ".session-restore");
  try {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.cpSync(backed, staging, { recursive: true });
    decryptTree(staging, deriveKey());
  } catch (e) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}
    return { ok: false, err: "staging copy failed: " + e.message };
  }

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  try {
    fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.cpSync(staging, SESSIONS_DIR, { recursive: true });
  } catch (e) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}
    return { ok: false, err: "restore copy failed: " + e.message };
  }
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) {}
  return { ok: true };
}

// Auto-sync loop
let syncInterval = null;
function startAutoSync() {
  if (!syncEnabled()) {
    warn("⚠️ Session persistence not configured — set SESSION_GIT_REPO + GITHUB_TOKEN to avoid re-scanning QR on every restart.");
    return;
  }
  if (syncInterval) clearInterval(syncInterval);
  const secs = Math.max(30, parseInt(process.env.SESSION_SYNC_INTERVAL || "60", 10));
  syncInterval = setInterval(() => {
    backupSession().catch((e) => error("Session backup failed:", e.message));
  }, secs * 1000);
  log(`💾 Session auto-sync started (every ${secs}s to ${REPO}).`);
}

function stopAutoSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = null;
}

module.exports = { backupSession, restoreSession, startAutoSync, stopAutoSync, syncEnabled };
