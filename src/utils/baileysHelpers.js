const { downloadMediaMessage, normalizeMessageContent } = require("@whiskeysockets/baileys");
const { wasSentByBot } = require("./botMessages");
const { log, error, warn } = require("./logger");

const MEDIA_MESSAGE_TYPES = ["imageMessage", "videoMessage", "documentMessage", "audioMessage"];
const MAX_QUOTED_MEDIA_DEPTH = 6;

/**
 * Baileys can wrap the actual payload in ephemeral/view-once/document-caption
 * containers. Always normalize before inspecting message types.
 */
function normalizedContent(value) {
  const raw = value?.message && typeof value.message === "object" ? value.message : value;
  return normalizeMessageContent(raw) || raw || {};
}

function contextInfos(value) {
  const content = normalizedContent(value);
  return Object.values(content)
    .filter((node) => node && typeof node === "object" && node.contextInfo)
    .map((node) => node.contextInfo)
    .filter(Boolean);
}

function firstContextInfo(value) {
  return contextInfos(value)[0] || null;
}

function mediaNode(value) {
  const content = normalizedContent(value);
  for (const type of MEDIA_MESSAGE_TYPES) {
    if (content[type]) return { type, media: content[type], content };
  }
  return null;
}

function mediaFilename(media) {
  return media?.fileName || media?.filename || media?.title || null;
}

/**
 * Find media in the current message's reply chain. This deliberately walks
 * more than one quote level because ARIA replies quote the user's command,
 * and the user may then reply to ARIA's reply. In that case the GIF is nested
 * inside: current message -> ARIA reply -> original user media message.
 */
function findQuotedMediaReference(msg) {
  let container = normalizedContent(msg);
  let contextInfo = firstContextInfo(container);
  let quoted = contextInfo?.quotedMessage;

  for (let depth = 1; depth <= MAX_QUOTED_MEDIA_DEPTH && quoted; depth += 1) {
    const candidate = mediaNode(quoted);
    if (candidate) {
      return {
        ...candidate,
        contextInfo,
        depth,
      };
    }

    container = normalizedContent(quoted);
    contextInfo = firstContextInfo(container);
    quoted = contextInfo?.quotedMessage;
  }

  return null;
}

function getMessageText(msg) {
  const content = normalizedContent(msg);
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ""
  );
}

function getSenderName(msg) {
  return msg.pushName || msg.key.participant || msg.key.remoteJid?.split("@")[0] || "User";
}

function getTargetJid(msg) {
  const contextInfo = firstContextInfo(msg);
  if (contextInfo?.mentionedJid?.length > 0) return contextInfo.mentionedJid[0];
  if (contextInfo?.participant) return contextInfo.participant;
  return null;
}

// True if ARIA is directly @mentioned in any supported WhatsApp message
// container, or the message replies to one of ARIA's tracked messages.
function isBotMentioned(msg, botJid) {
  try {
    const infos = contextInfos(msg);
    const mentioned = infos.flatMap((info) => Array.isArray(info.mentionedJid) ? info.mentionedJid : []);
    const botIds = (Array.isArray(botJid) ? botJid : [botJid]).filter(Boolean).map(normalizeJid);
    if (mentioned.length && botIds.length && mentioned.some((jid) => botIds.includes(normalizeJid(jid)))) return true;

    if (infos.some((info) => info.stanzaId && wasSentByBot(info.stanzaId))) return true;
  } catch (_) {}
  return false;
}

function normalizeJid(value) {
  const raw = String(value || "").trim().toLowerCase();
  const bare = raw.split(":")[0].split("@")[0];
  return bare || raw;
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
  const contextInfo = firstContextInfo(msg);
  const stanzaId = contextInfo?.stanzaId;
  if (!stanzaId) return false;
  return wasSentByBot(stanzaId);
}

function getQuotedMessageText(msg) {
  let quoted = firstContextInfo(msg)?.quotedMessage;
  if (!quoted) return null;

  const parts = [];
  for (let depth = 0; depth < MAX_QUOTED_MEDIA_DEPTH && quoted; depth += 1) {
    const text = getMessageText({ message: quoted });
    if (text) parts.push(text);
    quoted = firstContextInfo(quoted)?.quotedMessage;
  }
  return parts.length ? parts.join("\n") : null;
}

function hasMedia(msg) {
  const reference = mediaNode(msg);
  return Boolean(reference && reference.type !== "audioMessage");
}

function hasVoiceNote(msg) {
  return Boolean(normalizedContent(msg).audioMessage);
}

function mediaResult(buffer, media) {
  return {
    data: buffer.toString("base64"),
    buffer,
    mimetype: media?.mimetype || "application/octet-stream",
    filename: mediaFilename(media),
  };
}

async function downloadMediaFromMsg(sock, msg) {
  try {
    const reference = mediaNode(msg);
    if (!reference) return null;
    const downloadMsg = { ...msg, message: reference.content };
    const buffer = await downloadMediaMessage(downloadMsg, "buffer", {});
    return mediaResult(buffer, reference.media);
  } catch (err) {
    error("Media download error:", err.message);
    return null;
  }
}

// Download media from the message this one is REPLYING TO (including a bounded
// nested reply chain). Needed when a user replies to ARIA's response, because
// ARIA's response itself quotes the original command that referenced the GIF.
async function downloadQuotedMedia(sock, msg) {
  const reference = findQuotedMediaReference(msg);
  if (!reference?.contextInfo?.stanzaId) return null;

  try {
    const quotedMsg = {
      key: {
        remoteJid: reference.contextInfo.remoteJid || msg.key?.remoteJid,
        id: reference.contextInfo.stanzaId,
        participant: reference.contextInfo.participant,
      },
      message: reference.content,
    };
    const buffer = await downloadMediaMessage(quotedMsg, "buffer", {});
    return mediaResult(buffer, reference.media);
  } catch (err) {
    error("Quoted media download error:", err.message);
    return null;
  }
}

module.exports = {
  getMessageText, getSenderName, getTargetJid, isBotMentioned,
  reply, react, splitMessage, sleep,
  isQuotingBotMessage, getQuotedMessageText,
  hasMedia, hasVoiceNote, downloadMediaFromMsg, downloadQuotedMedia,
  findQuotedMediaReference,
};
