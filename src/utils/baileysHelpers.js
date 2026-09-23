const { downloadMediaMessage, normalizeMessageContent } = require("@whiskeysockets/baileys");
const { wasSentByBot } = require("./botMessages");
const { log, error, warn } = require("./logger");

const MEDIA_MESSAGE_TYPES = ["imageMessage", "videoMessage", "documentMessage", "audioMessage", "stickerMessage"];
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
    if (mentioned.length && botIds.length && mentioned.some((jid) => botIds.some((bot) => jidMatches(jid, bot)))) return true;

    if (infos.some((info) => info.stanzaId && wasSentByBot(info.stanzaId))) return true;
  } catch (_) {}
  return false;
}

function normalizeJid(value) {
  const raw = String(value || "").trim().toLowerCase();
  const bare = raw.split(":")[0].split("@")[0];
  return bare || raw;
}

function jidMatches(left, right) {
  const a = normalizeJid(left);
  const b = normalizeJid(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const digitsA = a.replace(/\D/g, "");
  const digitsB = b.replace(/\D/g, "");
  // Device suffixes and formatting can differ while the WhatsApp number is
  // identical. Compare the stable international-number tail, not display text.
  return digitsA.length >= 8 && digitsB.length >= 8 && (digitsA.endsWith(digitsB) || digitsB.endsWith(digitsA));
}

function getBotMentionJids(sock) {
  const candidates = [sock?.user?.id, sock?.user?.jid, sock?.user?.lid, sock?.user?.phoneNumber]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const seen = new Set();
  return candidates.filter((jid) => {
    const key = normalizeJid(jid);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 2);
}

function shouldSelfMention(inputText, responseText) {
  const input = String(inputText || "").trim();
  const response = String(responseText || "").trim();
  if (!response) return false;
  const openingSelfReference = /^(?:aria\b|i(?:'m| am)\s+aria\b|this\s+is\s+aria\b|here(?:'s| is)\s+aria\b)/i.test(response);
  const userSummoning = /\b(?:where(?:'s| is)\s+(?:my\s+)?aria|summon\s+aria|call\s+aria|aria\s*[!?.,]*\s*(?:are you|come|wake up|present))\b/i.test(input);
  return openingSelfReference || userSummoning;
}

function sanitizeOutboundText(text) {
  if (text && typeof text === "object") {
    if (typeof text.message === "string" && text.message.trim()) text = text.message;
    else if (typeof text.error === "string" && text.error.trim()) text = `❌ ${text.error}`;
    else if (text.success === true && text.kind) text = `✅ ${text.kind} published successfully.`;
    else if (text.success === true && text.fileName) text = `✅ File delivered: ${text.fileName}`;
    else if (text.success === true) text = "✅ Operation completed successfully.";
    else {
      try { text = JSON.stringify(text, null, 2); } catch (_) { text = "The operation returned an unreadable result."; }
    }
  }
  return String(text || "")
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<analysis\b[^>]*>[\s\S]*?(?:<\/analysis>|$)/gi, "")
    .trim();
}

async function reply(sock, msg, text, options = {}) {
  const cleanText = sanitizeOutboundText(text);
  if (!cleanText) return { success: false, error: "empty outbound text" };
  const chatId = msg.key.remoteJid;
  const mentions = options.mentions || [];
  try {
    if (cleanText.length <= 4000) {
      await sock.sendMessage(chatId, { text: cleanText, mentions }, { quoted: msg });
      return { success: true, chunks: 1 };
    }
    const chunks = splitMessage(cleanText, 3900);
    for (let i = 0; i < chunks.length; i++) {
      await sock.sendMessage(chatId, { text: chunks[i], mentions: i === 0 ? mentions : [] });
    }
    return { success: true, chunks: chunks.length };
  } catch (err) {
    const safeError = String(err?.message || "send failed").slice(0, 240);
    error("Reply error:", safeError);
    try {
      require("./eventLog").trackOperation("whatsapp-reply", "send", "failed", { chatId, error: safeError });
    } catch (_) {}
    return { success: false, error: safeError };
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
  getBotMentionJids, shouldSelfMention,
  reply, react, splitMessage, sleep,
  isQuotingBotMessage, getQuotedMessageText,
  hasMedia, hasVoiceNote, downloadMediaFromMsg, downloadQuotedMedia,
  findQuotedMediaReference,
  _test: { sanitizeOutboundText },
};
