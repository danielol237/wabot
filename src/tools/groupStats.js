// ── Group message statistics ─────────────────────────────────────
// Tracks how many messages each user sends in each group, persisted to disk
// so counts survive restarts AND a member leaving/rejoining the group. The
// key is the user's stable id (number/LID), not a group slot, so a member who
// leaves and comes back keeps their total.
//
// Performance: counts are mutated in memory and flushed to disk on a
// debounce (every ~5s of activity), NOT synchronously on every message, so a
// busy group doesn't block the event loop with a disk write per message.
//
// Commands:
//   !top [N]          — ranked leaderboard of who talks most in this group
//   !active [N]       — members who've sent >= N messages (default 5)
//   !inactive [N]     — members who've sent < N messages (default 5)
//   !purge [N]        — kick every non-admin member who sent < N messages

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/groupStats.json");
// Retention: cap stored users per group and total groups so the file can't
// grow forever. 2000 users/group and 500 groups is generous and bounds it.
const MAX_USERS_PER_GROUP = 2000;
const MAX_GROUPS = 500;
const FLUSH_MS = 5000; // debounce: persist at most every 5s

let store = { groups: {} };
let dirty = false;
let flushTimer = null;

function load() {
  try {
    if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, "utf8")) || { groups: {} };
  } catch (e) { store = { groups: {} }; }
}
function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(store)); } catch (e) {}
}
function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!dirty) return;
    dirty = false;
    save();
  }, FLUSH_MS);
  if (flushTimer.unref) flushTimer.unref();
}
// Flush immediately (e.g. on shutdown if we ever add that hook).
function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (dirty) { dirty = false; save(); }
}
load();

// Normalize a participant jid to a stable key (drops @s.whatsapp.net / @lid / :xxx).
function key(jid) {
  if (!jid) return "";
  return jid.split(":")[0].split("@")[0];
}

// Is this participant jid the bot itself? Compare the raw number AND the LID,
// since WhatsApp metadata may report either. Also guards against empty.
function isSelfJid(participantJid, botJid) {
  if (!participantJid || !botJid) return false;
  const p = key(participantJid);
  const b = key(botJid);
  return !!p && p === b;
}

// Record one message from a user in a group. Call on every inbound group message.
// In-memory only; disk flush is debounced.
function recordMessage(groupId, participantJid, senderName) {
  if (!groupId || !participantJid) return;
  const uid = key(participantJid);
  if (!uid) return;
  store.groups[groupId] = store.groups[groupId] || {};
  const rec = store.groups[groupId][uid] || { name: senderName || uid, count: 0 };
  rec.count += 1;
  if (senderName) rec.name = senderName;
  store.groups[groupId][uid] = rec;
  scheduleFlush();
}

// Sorted list of { uid, name, count } for a group, most talkative first.
function getTop(groupId) {
  const g = store.groups[groupId] || {};
  return Object.entries(g)
    .map(([uid, rec]) => ({ uid, name: rec.name || uid, count: rec.count || 0 }))
    .sort((a, b) => b.count - a.count);
}

function getGroupCount(groupId, participantJid) {
  const g = store.groups[groupId] || {};
  const rec = g[key(participantJid)];
  return rec ? rec.count : 0;
}

// Parse a positive integer arg; returns default if missing/invalid.
function parseN(arg, def) {
  const n = parseInt(Array.isArray(arg) ? arg[0] : arg, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function formatTop(groupId, arg) {
  const list = getTop(groupId);
  if (!list.length) return "No message data for this group yet.";
  const limit = parseN(arg, 10);
  const medals = ["🥇", "🥈", "🥉"];
  const lines = list.slice(0, limit).map((u, i) => {
    const badge = medals[i] || `${i + 1}.`;
    return `${badge} ${u.name || u.uid} — ${u.count} msg${u.count === 1 ? "" : "s"}`;
  });
  return `📊 *Top talkers*\n\n${lines.join("\n")}`;
}

// Members of a group with count >= threshold (active) or < threshold (inactive).
function filterByThreshold(groupId, arg, mode) {
  const t = parseN(arg, 5);
  return getTop(groupId).filter((u) => (mode === "inactive" ? u.count < t : u.count >= t));
}

function formatActive(groupId, arg) {
  const t = parseN(arg, 5);
  const list = filterByThreshold(groupId, arg, "active");
  if (!list.length) return `No active members (>= ${t} messages).`;
  return `🔥 *Active members* (>= ${t} msgs)\n\n` + list.map((u) => `• ${u.name || u.uid} — ${u.count} msgs`).join("\n");
}

function formatInactive(groupId, arg) {
  const t = parseN(arg, 5);
  const list = filterByThreshold(groupId, arg, "inactive");
  if (!list.length) return `Everyone's active (nobody under ${t} messages). 🎉`;
  return `👻 *Inactive members* (< ${t} msgs)\n\n` + list.map((u) => `• ${u.name || u.uid} — ${u.count} msgs`).join("\n");
}

// Trim the store to retention bounds. Call defensively from purge or on load.
function enforceRetention() {
  const groupIds = Object.keys(store.groups);
  if (groupIds.length > MAX_GROUPS) {
    // Drop the least-recently-touched groups by total count (proxy for activity).
    const ranked = groupIds
      .map((gid) => ({ gid, total: Object.values(store.groups[gid]).reduce((s, r) => s + (r.count || 0), 0) }))
      .sort((a, b) => a.total - b.total);
    for (let i = 0; i < ranked.length - MAX_GROUPS; i++) delete store.groups[ranked[i].gid];
  }
  for (const gid of Object.keys(store.groups)) {
    const keys = Object.keys(store.groups[gid]);
    if (keys.length > MAX_USERS_PER_GROUP) {
      const ranked = keys
        .map((uid) => ({ uid, count: store.groups[gid][uid].count || 0 }))
        .sort((a, b) => a.count - b.count);
      for (let i = 0; i < ranked.length - MAX_USERS_PER_GROUP; i++) delete store.groups[gid][ranked[i].uid];
    }
  }
}

// Kick every non-admin, non-bot member whose count is below threshold.
// Returns { kicked, skipped, errors }.
async function purgeInactive(sock, groupId, arg) {
  const t = parseN(arg, 5);
  const { isBotAdmin, getAllParticipants, kickUser } = require("./groupAdmin");
  const botAdmin = await isBotAdmin(sock, groupId);

  const meta = await sock.groupMetadata(groupId).catch(() => null);
  if (!meta) return { ok: false, error: "Couldn't load group metadata." };
  if (!botAdmin) return { ok: false, error: "I need to be a group admin to kick people." };

  const adminIds = new Set(
    meta.participants.filter((p) => p.admin === "admin" || p.admin === "superadmin").map((p) => key(p.id))
  );

  const kicked = [];
  const skipped = [];
  const errors = [];

  for (const p of meta.participants) {
    const uid = key(p.id);
    if (!uid || isSelfJid(p.id, sock.user?.id)) continue; // never the bot
    if (adminIds.has(uid)) { skipped.push({ uid, reason: "admin" }); continue; } // never admins
    const count = getGroupCount(groupId, p.id);
    if (count >= t) { skipped.push({ uid, reason: `active (${count} msgs)` }); continue; }

    try {
      const r = await kickUser(sock, groupId, p.id); // reuse the centralized kick
      if (r.success === false) throw new Error(r.error || "kick failed");
      kicked.push({ uid, name: p.id, count });
    } catch (e) {
      errors.push({ uid, error: e.message });
    }
  }

  enforceRetention();
  flushNow();
  return { ok: true, kicked, skipped, errors, threshold: t };
}

function formatPurgeResult(r) {
  if (!r.ok) return `❌ ${r.error}`;
  if (!r.kicked.length) return `No one under ${r.threshold} messages to kick. ${r.skipped.length} kept.`;
  const lines = r.kicked.map((k) => `• ${k.name} — ${k.count} msgs`);
  return `👢 Purged ${r.kicked.length} inactive member(s) (< ${r.threshold} msgs):\n\n${lines.join("\n")}`;
}

module.exports = { recordMessage, getTop, getGroupCount, formatTop, formatActive, formatInactive, purgeInactive, formatPurgeResult, flushNow, enforceRetention };
