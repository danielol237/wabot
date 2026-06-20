// Group administration tools — kick, promote, demote, tagall, purge, antilink, welcome.
// All require the bot itself to be a group admin to actually work (WhatsApp enforces this).

async function isBotAdmin(sock, groupId) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    const botNumber = sock.user.id.split(":")[0].split("@")[0];
    const botParticipant = metadata.participants.find((p) => p.id.split("@")[0] === botNumber);
    return botParticipant?.admin === "admin" || botParticipant?.admin === "superadmin";
  } catch (err) {
    console.error("isBotAdmin check failed:", err.message);
    return false;
  }
}

async function isSenderAdmin(sock, groupId, senderJid) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    const senderNumber = senderJid.split(":")[0].split("@")[0];
    const participant = metadata.participants.find((p) => p.id.split("@")[0] === senderNumber);
    return participant?.admin === "admin" || participant?.admin === "superadmin";
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

module.exports = {
  isBotAdmin,
  isSenderAdmin,
  kickUser,
  promoteUser,
  demoteUser,
  getAllParticipants,
  tagAll,
  hideTag,
  purgeMessages,
};
