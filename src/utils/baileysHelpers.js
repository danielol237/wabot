// Baileys-native helper functions for ARIA WhatsApp bot
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { wasSentByBot } = require("./botMessages");
const { log, error, warn } = require("./logger");

function getMessageText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ""
  );
}

function getSenderName(msg) {
  return msg.pushName || msg.key.participant || msg.key.remoteJid?.split("@")[0] || "User";
}

function getTargetJid(msg) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned?.length > 0) return mentioned[0];
  const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (quotedParticipant) return quotedParticipant;
  return null;
}

// True if the bot's own JID appears in the message's @mention list, OR the
// message is a reply to one of the bot's messages. Used to decide whether a
// group message is actually addressing ARIA.
function isBotMentioned(msg, botJid) {
  try {
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    if (Array.isArray(mentioned) && botJid) {
      const botNum = String(botJid).split(":")[0].split("@")[0];
      if (mentioned.some((m) => String(m).split(":")[0].split("@")[0] === botNum)) return true;
    }
    // Reply-to-our-message detection via tracked sent message ids.
    const { wasSentByBot } = require("./botMessages");
    const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
    if (quotedId && wasSentByBot(quotedId)) return true;
  } catch (_) {}
  return false;
}

async function reply(sock, msg, text, options = {}) {
  if (!text) return;
  const chatId = msg.key.remoteJid;
  const mentions = options.mentions || [];
  try {
    if (text.length <= 4000) {
      await sock.sendMessage(chatId, { text, mentions }, { quoted: msg });
      return;
    }
    const chunks = splitMessage(text, 3900);
    for (let i = 0; i < chunks.length; i++) {
      await sock.sendMessage(chatId, { text: chunks[i], mentions: i === 0 ? mentions : [] });
      await sleep(400);
    }
  } catch (err) {
    error("Reply error:", err.message);
  }
}

async function react(sock, msg, emoji) {
  // Emoji reactions were reported as annoying (the bot reacted to nearly every
  // message). They're disabled by default. Set EMOJI_REACTIONS=true in env to
  // re-enable them.
  if (process.env.EMOJI_REACTIONS !== "true") return;
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key },
    });
  } catch (_) {}
}

function splitMessage(text, maxLen) {
  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function isQuotingBotMessage(msg) {
  const contextInfo =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    msg.message?.audioMessage?.contextInfo;
  const stanzaId = contextInfo?.stanzaId;
  if (!stanzaId) return false;
  return wasSentByBot(stanzaId);
}

function getQuotedMessageText(msg) {
  const contextInfo =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    msg.message?.audioMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;
  if (!quoted) return null;
  return (
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption ||
    null
  );
}

function hasMedia(msg) {
  return !!(msg.message?.imageMessage || msg.message?.documentMessage || msg.message?.videoMessage);
}

function hasVoiceNote(msg) {
  return !!msg.message?.audioMessage;
}

async function downloadMediaFromMsg(sock, msg) {
  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {});
    const mediaMsg =
      msg.message?.imageMessage ||
      msg.message?.documentMessage ||
      msg.message?.videoMessage ||
      msg.message?.audioMessage;
    return {
      data: buffer.toString("base64"),
      buffer,
      mimetype: mediaMsg?.mimetype || "application/octet-stream",
      filename: mediaMsg?.fileName || null,
    };
  } catch (err) {
    error("Media download error:", err.message);
    return null;
  }
}

module.exports = {
  getMessageText, getSenderName, getTargetJid, isBotMentioned,
  reply, react, splitMessage, sleep,
  isQuotingBotMessage, getQuotedMessageText,
  hasMedia, hasVoiceNote, downloadMediaFromMsg,
};
