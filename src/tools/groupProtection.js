const { getGroupSettings, isAntiAdminBlocked } = require("../utils/groupSettings");
const { jidNumber, isBotAdmin } = require("./groupAdmin");

const slowmodeLast = new Map();

function mentionedJids(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

function enabled(settings, name) {
  return !!settings?.protections?.[name];
}

function protectionResult(action, reason) {
  return { action, reason };
}

function checkGroupProtection({ text, msg, chatId, senderJid, isGroup }) {
  if (!isGroup || !chatId) return null;
  const settings = getGroupSettings(chatId);
  const mentions = mentionedJids(msg);
  const value = String(text || "");
  const lower = value.toLowerCase();

  if (enabled(settings, "antimention") && mentions.length) return protectionResult("delete", "Mentions are disabled in this group.");
  if (enabled(settings, "antigroupmention") && mentions.length >= 3) return protectionResult("delete", "Mass mentions are disabled in this group.");

  if (enabled(settings, "antihijack") && /(give|make|promote|add)\s+(me|\w+)\s+(admin|owner)|take\s+over\s+(this|the)\s+group|group\s+hijack/i.test(value)) {
    return protectionResult("delete", "Group-hijack bait is disabled in this group.");
  }
  if (enabled(settings, "antibot") && /(?:^|\s)(?:bot|automated|scraper|spam bot)(?:\s|$)/i.test(value) && /(join|click|send|dm|verify|claim|promote)/i.test(value)) {
    return protectionResult("delete", "Suspicious bot-like promotion was blocked.");
  }

  const seconds = Number(settings.slowmodeSeconds || 0);
  if (seconds > 0 && senderJid) {
    const key = `${chatId}:${jidNumber(senderJid)}`;
    const now = Date.now();
    const previous = slowmodeLast.get(key) || 0;
    if (now - previous < seconds * 1000) return protectionResult("delete", `Slowmode is enabled. Wait ${Math.ceil((seconds * 1000 - (now - previous)) / 1000)}s.`);
    slowmodeLast.set(key, now);
  }
  return null;
}

async function handleParticipantUpdate(sock, update) {
  const chatId = update?.id;
  if (!chatId) return;
  const settings = getGroupSettings(chatId);
  const botId = jidNumber(sock?.user?.id);
  const ownerNumber = String(process.env.OWNER_NUMBER || "").replace(/\D/g, "");
  const actor = jidNumber(update.author);
  const ownerWasRemoved = update.action === "remove" && ownerNumber && (update.participants || []).some((participant) => jidNumber(participant) === ownerNumber);
  if (update.action === "add" && settings.introCard?.text) {
    for (const participant of update.participants || []) {
      await sock.sendMessage(chatId, { text: settings.introCard.text.replace("{user}", `@${jidNumber(participant)}`), mentions: [participant] }).catch(() => {});
    }
  }
  if (!(await isBotAdmin(sock, chatId))) return;
  if (ownerWasRemoved) {
    const ownerJid = (update.participants || []).find((participant) => jidNumber(participant) === ownerNumber);
    if (ownerJid) await sock.groupParticipantsUpdate(chatId, [ownerJid], "add").catch(() => {});
    if (actor && actor !== botId && actor !== ownerNumber) await sock.groupParticipantsUpdate(chatId, [`${actor}@s.whatsapp.net`], "demote").catch(() => {});
    await sock.sendMessage(chatId, { text: "🛡️ Owner protection restored the owner and reversed the removal attempt." }).catch(() => {});
  }
  for (const participant of update.participants || []) {
    const id = jidNumber(participant);
    if (!id || id === botId || id === ownerNumber) continue;
    if (update.action === "promote" && isAntiAdminBlocked(chatId, participant)) {
      await sock.groupParticipantsUpdate(chatId, [participant], "demote").catch(() => {});
      await sock.sendMessage(chatId, { text: `🛡️ Anti-admin denylist enforced: @${id} was demoted immediately.`, mentions: [participant] }).catch(() => {});
      continue;
    }
    if (update.action === "promote" && enabled(settings, "antipromote")) {
      await sock.groupParticipantsUpdate(chatId, [participant], "demote").catch(() => {});
      await sock.sendMessage(chatId, { text: `🛡️ Anti-promote reverted an unauthorized promotion for @${id}.`, mentions: [participant] }).catch(() => {});
    }
    if (update.action === "demote" && enabled(settings, "antidemote")) {
      await sock.groupParticipantsUpdate(chatId, [participant], "promote").catch(() => {});
      await sock.sendMessage(chatId, { text: `🛡️ Anti-demote restored admin status for @${id}.`, mentions: [participant] }).catch(() => {});
    }
  }
}

module.exports = { checkGroupProtection, handleParticipantUpdate, _slowmodeLast: slowmodeLast };
