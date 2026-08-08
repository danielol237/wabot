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
const { log, error, warn } = require("../utils/logger");

const HOME = path.join(__dirname, "../..");
const SESSIONS_DIR = path.join(HOME, "sessions");
const GIT_DIR = path.join(HOME, ".session-sync");

const REPO = process.env.SESSION_GIT_REPO || "";
const TOKEN = process.env.GITHUB_TOKEN || "";

function syncEnabled() {
  return !!REPO && !!TOKEN;
}

function git(args, cwd, timeout = 30000) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
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
    const url = `https://x-access-token:${TOKEN}@github.com/${REPO}.git`;
    const r = await git(["clone", url, "."], GIT_DIR);
    if (!r.ok) return { ok: false, err: r.err };
  }
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

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  try {
    fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.cpSync(backed, SESSIONS_DIR, { recursive: true });
  } catch (e) {
    return { ok: false, err: "restore copy failed: " + e.message };
  }
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
