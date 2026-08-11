// ── Group message statistics ─────────────────────────────────────
// Tracks how many messages each user sends in each group, persisted to disk
// so counts survive restarts AND a member leaving/rejoining the group. The
// key is the user's stable id (number/LID), not a group slot, so a member who
// leaves and comes back keeps their total.
//
// Commands:
//   !top [N]          — ranked leaderboard of who talks most in this group
//   !active [N]       — members who've sent >= N messages (default 5)
//   !inactive [N]     — members who've sent < N messages (default 5)
//   !purge [N]        — kick every non-admin member who sent < N messages

const fs = require("fs");
const path = require("path");
const { log } = require("../utils/logger");

const FILE = path.join(__dirname, "../../data/groupStats.json");

let store = { groups: {} }; // { groups: { [groupId]: { [userId]: { name, count } } } }

function load() {
  try {
    if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, "utf8")) || { groups: {} };
  } catch (e) { store = { groups: {} }; }
}
function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(store)); } catch (e) {}
}
load();

// Normalize a participant jid to a stable key (drops @s.whatsapp.net / @lid / :xxx).
function key(jid) {
  if (!jid) return "";
  return jid.split(":")[0].split("@")[0];
}

// Record one message from a user in a group. Call on every inbound group message.
function recordMessage(groupId, participantJid, senderName) {
  if (!groupId || !participantJid) return;
  const uid = key(participantJid);
  if (!uid) return;
  store.groups[groupId] = store.groups[groupId] || {};
  const rec = store.groups[groupId][uid] || { name: senderName || uid, count: 0 };
  rec.count += 1;
  if (senderName) rec.name = senderName;
  store.groups[groupId][uid] = rec;
  save();
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

function formatTop(groupId, n) {
  const list = getTop(groupId);
  if (!list.length) return "No message data for this group yet.";
  const limit = Math.max(1, parseInt(n, 10) || 10);
  const medals = ["🥇", "🥈", "🥉"];
  const lines = list.slice(0, limit).map((u, i) => {
    const badge = medals[i] || `${i + 1}.`;
    return `${badge} ${u.name || u.uid} — ${u.count} msg${u.count === 1 ? "" : "s"}`;
  });
  return `📊 *Top talkers*\n\n${lines.join("\n")}`;
}

// Members of a group with count >= threshold (active) or < threshold (inactive).
function filterByThreshold(groupId, threshold, mode) {
  const t = Math.max(1, parseInt(threshold, 10) || 5);
  return getTop(groupId).filter((u) => (mode === "inactive" ? u.count < t : u.count >= t));
}

function formatActive(groupId, n) {
  const list = filterByThreshold(groupId, n, "active");
  if (!list.length) return `No active members (>= ${parseInt(n, 10) || 5} messages).`;
  return `🔥 *Active members* (>= ${parseInt(n, 10) || 5} msgs)\n\n` + list.map((u) => `• ${u.name || u.uid} — ${u.count} msgs`).join("\n");
}

function formatInactive(groupId, n) {
  const list = filterByThreshold(groupId, n, "inactive");
  if (!list.length) return `Everyone's active (nobody under ${parseInt(n, 10) || 5} messages). 🎉`;
  return `👻 *Inactive members* (< ${parseInt(n, 10) || 5} msgs)\n\n` + list.map((u) => `• ${u.name || u.uid} — ${u.count} msgs`).join("\n");
}

// Kick every non-admin, non-bot member whose count is below threshold.
// Returns { kicked, skipped, errors }.
async function purgeInactive(sock, groupId, threshold, opts = {}) {
  const t = Math.max(1, parseInt(threshold, 10) || 5);
  const { isBotAdmin, getAllParticipants } = require("./groupAdmin");
  const botAdmin = await isBotAdmin(sock, groupId);

  const meta = await sock.groupMetadata(groupId).catch(() => null);
  if (!meta) return { ok: false, error: "Couldn't load group metadata." };
  if (!botAdmin) return { ok: false, error: "I need to be a group admin to kick people." };

  const botNumber = (sock.user?.id || "").split(":")[0].split("@")[0];
  const adminIds = new Set(
    meta.participants.filter((p) => p.admin === "admin" || p.admin === "superadmin").map((p) => key(p.id))
  );

  const kicked = [];
  const skipped = [];
  const errors = [];

  for (const p of meta.participants) {
    const uid = key(p.id);
    if (!uid || uid === botNumber) continue;              // never the bot
    if (adminIds.has(uid)) { skipped.push({ uid, reason: "admin" }); continue; }  // never admins
    const count = getGroupCount(groupId, p.id);
    if (count >= t) { skipped.push({ uid, reason: `active (${count} msgs)` }); continue; }

    try {
      await sock.groupParticipantsUpdate(groupId, [p.id], "remove");
      kicked.push({ uid, name: p.id, count });
    } catch (e) {
      errors.push({ uid, error: e.message });
    }
  }

  return { ok: true, kicked, skipped, errors, threshold: t };
}

function formatPurgeResult(r) {
  if (!r.ok) return `❌ ${r.error}`;
  if (!r.kicked.length) return `No one under ${r.threshold} messages to kick. ${r.skipped.length} kept.`;
  const lines = r.kicked.map((k) => `• ${k.name} — ${k.count} msgs`);
  return `👢 Purged ${r.kicked.length} inactive member(s) (< ${r.threshold} msgs):\n\n${lines.join("\n")}`;
}

module.exports = { recordMessage, getTop, getGroupCount, formatTop, formatActive, formatInactive, purgeInactive, formatPurgeResult };
