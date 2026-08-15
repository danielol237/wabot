// Group administration tools — kick, promote, demote, tagall, purge, antilink, welcome.
// All require the bot itself to be a group admin to actually work (WhatsApp enforces this).

function jidNumber(jid) {
  return String(jid || "").split(":")[0].split("@")[0];
}

function participantJids(participant) {
  if (!participant) return [];
  if (typeof participant === "string") return [participant.trim()].filter(Boolean);
  return [participant.id, participant.jid, participant.lid, participant.phoneNumber]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function identityMatches(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  return jidNumber(a) !== "" && jidNumber(a) === jidNumber(b);
}

function participantMatches(participant, identities) {
  const values = participantJids(participant);
  return values.some((value) => identities.some((identity) => identityMatches(value, identity)));
}

function isAdminParticipant(participant) {
  return participant?.admin === "admin" || participant?.admin === "superadmin";
}

function botIdentities(sock) {
  return [sock?.user?.id, sock?.user?.jid, sock?.user?.lid, sock?.user?.phoneNumber]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

async function isBotAdmin(sock, groupId) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    const identities = botIdentities(sock);
    if (!identities.length) return false;
    const botParticipant = metadata.participants.find((participant) => participantMatches(participant, identities));
    return isAdminParticipant(botParticipant);
  } catch (err) {
    console.error("isBotAdmin check failed:", err.message);
    return false;
  }
}

async function isSenderAdmin(sock, groupId, senderJid) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    const participant = metadata.participants.find((candidate) => participantMatches(candidate, [senderJid]));
    return isAdminParticipant(participant);
  } catch (err) {
    console.error("isSenderAdmin check failed:", err.message);
    return false;
  }
}

async function kickUser(sock, groupId, targetJid) {
  try {
    await sock.groupParticipantsUpdate(groupId, [targetJid], "remove");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function addUser(sock, groupId, targetJid) {
  try {
    await sock.groupParticipantsUpdate(groupId, [targetJid], "add");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function promoteUser(sock, groupId, targetJid) {
  try {
    await sock.groupParticipantsUpdate(groupId, [targetJid], "promote");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function demoteUser(sock, groupId, targetJid) {
  try {
    await sock.groupParticipantsUpdate(groupId, [targetJid], "demote");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getAllParticipants(sock, groupId) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    return { success: true, participants: metadata.participants.map((p) => p.id) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function tagAll(sock, msg, groupId, customMessage) {
  const result = await getAllParticipants(sock, groupId);
  if (!result.success) return { success: false, error: result.error };

  const text = customMessage
    ? `📢 ${customMessage}\n\n` + result.participants.map((p) => `@${p.split("@")[0]}`).join(" ")
    : "📢 " + result.participants.map((p) => `@${p.split("@")[0]}`).join(" ");

  await sock.sendMessage(groupId, { text, mentions: result.participants });
  return { success: true };
}

async function hideTag(sock, groupId, customMessage) {
  const result = await getAllParticipants(sock, groupId);
  if (!result.success) return { success: false, error: result.error };

  // Mentions everyone via metadata without visibly @-ing names in the text
  await sock.sendMessage(groupId, { text: customMessage || "📢 Attention", mentions: result.participants });
  return { success: true };
}

async function purgeMessages(sock, groupId, messageKeys) {
  let deleted = 0;
  for (const key of messageKeys) {
    try {
      await sock.sendMessage(groupId, { delete: key });
      deleted++;
    } catch (err) {
      console.error("Purge delete failed for one message:", err.message);
    }
  }
  return { success: true, deleted };
}

module.exports = { jidNumber, participantJids, identityMatches, participantMatches, isBotAdmin, isSenderAdmin, kickUser, addUser, promoteUser, demoteUser, tagAll, hideTag, purgeMessages };
