// Slimmed-down message handler — routes to commandRouter
// Previously 1669 lines, now ~150. New commands go in commandRouter, not here.

const { getMessageText, getSenderName, reply, react, sleep, hasMedia, hasVoiceNote, downloadMediaFromMsg, isBotMentioned } = require("../utils/baileysHelpers");
const { routeMessage, triggeredByName } = require("../utils/commandRouter");
const { isBanned, isMuted, isOwner: checkOwner } = require("../utils/permissions");
const { trackInteraction } = require("../utils/userMemory");
const { getMemory, saveMemory } = require("../utils/memory");
const { startSession, endSession, isSessionActive, touchSession } = require("../utils/chatSessions");
const { createSticker } = require("../tools/sticker");
const { analyzeFile } = require("../tools/fileUnderstanding");
const { transcribeVoice } = require("../tools/voice");
const { getAIResponse } = require("../tools/ai");
const { getPreferences } = require("../utils/userPreferences");
const { getFactsContext } = require("../utils/learnedFacts");
const { log, error, warn } = require("../utils/logger");
const { updateMood, humanDelay, isSleeping, getStateMessage } = require("../tools/humanity");

const BOT_NAME = (process.env.BOT_NAME || "aria").toLowerCase();

async function handleMessage(sock, msg, loadedPlugins = []) {
  const chatId = msg.key.remoteJid;
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderName = getSenderName(msg);
  const isGroup = chatId?.includes("g.us");
  const botJid = sock?.user?.id;
  const text = getMessageText(msg);
  const lower = text.toLowerCase().trim();

  // ── BAN / MUTE check ───────────────────────────────────────
  if (isBanned(senderJid)) return;
  if (isMuted(chatId) && !checkOwner(senderJid)) return;

  // ── Ignore bot's own messages ──────────────────────────────
  if (msg.key.fromMe) return;

  // ── Build context ──────────────────────────────────────────
  const context = { text, lower, senderJid, senderName, chatId, isGroup, loadedPlugins };

  // ── Group message stats ────────────────────────────────────
  // Count every group message (persisted) so !top/!active/!inactive/!purge
  // work and survive members leaving/rejoining. Only in groups, and only for
  // real users (not the bot itself — already filtered above).
  if (isGroup) {
    try {
      require("../tools/groupStats").recordMessage(chatId, senderJid, senderName);
    } catch (_) {}
  }

  // ── HUMANITY ENGINE ────────────────────────────────────────
  // Track interaction for bond/mood
  trackInteraction(senderJid, text, checkOwner(senderJid));
  // Update mood based on conversation
  updateMood(senderJid, text);

  // Sleep check — late night? she'll be drowsy
  if (isSleeping()) {
    if (checkOwner(senderJid)) {
      // The owner still gets a groggy reply during sleep hours (no emoji).
      return reply(sock, msg, getStateMessage());
    }
    // Everyone else is silently ignored while she's asleep — she doesn't reply
    // at all until she wakes up. This is the "true sleep" behavior.
    return;
  }

  // Human-like typing delay before any response
  await humanDelay(sock, chatId, senderJid, text.length + 1);

  // ── DECIDE WHETHER TO REPLY (checked for text AND media/voice) ──
  const isCommand = lower.startsWith(process.env.BOT_PREFIX || "!");
  const hasNameTrigger = triggeredByName(text);
  const sessionActive = isSessionActive(chatId);
  const mentioned = isBotMentioned(msg, botJid);
  // In groups, only act when actually addressed. In DMs, always act.
  const shouldReply = !isGroup || hasNameTrigger || isCommand || mentioned || sessionActive;
  if (!shouldReply) return;

  // ── STICKER AUTO-CREATE (replying to bot's image with "sticker") ──
  if (lower.includes("sticker") && hasMedia(msg)) {
    const media = await downloadMediaFromMsg(sock, msg);
    if (media?.mimetype.startsWith("image/")) {
      await react(sock, msg, "🎭");
      const result = await createSticker(media.buffer);
      if (result.success) {
        await sock.sendMessage(chatId, { sticker: result.buffer });
      } else {
        await reply(sock, msg, `❌ Sticker failed: ${result.error}`);
      }
      return;
    }
  }

  // ── FILE ANALYSIS (auto-analyze media) ─────────────────────
  if (hasMedia(msg)) {
    const media = await downloadMediaFromMsg(sock, msg);
    if (media) {
      // Remember image content for future context (media personality).
      if (media.mimetype?.startsWith("image/")) {
        try {
          const { rememberImage } = require("../tools/mediaMemory");
          rememberImage(senderJid, media.buffer.toString("base64"), media.mimetype, text).catch(() => {});
        } catch (_) {}
      }
      const question = text || "Analyze this file.";
      const result = await analyzeFile(media, question);
      return reply(sock, msg, result);
    }
  }

  // ── VOICE NOTE → VOICE CONVERSATION ──────────────────────
  if (hasVoiceNote(msg)) {
    const media = await downloadMediaFromMsg(sock, msg);
    if (media) {
      // Remember voice content for future context (media personality).
      try {
        const { rememberVoice } = require("../tools/mediaMemory");
        rememberVoice(senderJid, media.buffer, media.mimetype).catch(() => {});
      } catch (_) {}
      const { voiceConversation } = require("../tools/voice");
      const result = await voiceConversation(media.buffer, senderName, chatId, checkOwner(senderJid));
      
      if (result.error) {
        if (result.transcription) {
          await reply(sock, msg, `📝 *Transcribed:* ${result.transcription}\n\n❌ Reply failed: ${result.error}`);
        } else {
          await reply(sock, msg, `❌ Voice processing error: ${result.error}`);
        }
      } else if (result.audio) {
        // Send voice response
        await sock.sendMessage(chatId, { audio: result.audio, mimetype: "audio/mpeg", ptt: true });
        // Also send the transcriptions so the user can see what was said
        await reply(sock, msg, `🎤 *You said:* ${result.transcription}\n\n🤖 *ARIA replied:* ${result.text}`);
      } else if (result.text) {
        // TTS failed, send text response with transcription
        await react(sock, msg, "💬");
        await reply(sock, msg, `🎤 *You said:* ${result.transcription}\n\n${result.text}`);
      }
      return;
    }
  }

  // ── NAME TRIGGER or PREFIX COMMAND ────────────────────────
  // Active academy flow: if the chat is mid-!academy and this is a plain
  // reply (number / next / prev / back / done / quiz letter), intercept before
  // normal AI chat so the adaptive learning system can advance the session.
  if (!isCommand && !hasMedia(msg) && !hasVoiceNote(msg)) {
    try {
      // Production incident simulator takes priority (free-form diagnosis/fix).
      const incident = require("../tools/academy/incidentSimulator");
      if (incident.hasActiveFlow(chatId)) {
        const out = incident.handleReply(chatId, senderJid.split("@")[0], text.trim());
        if (out) { await react(sock, msg, "🚨"); return reply(sock, msg, out.text); }
      }
    } catch (_) {}
    try {
      const { hasActiveFlow, handleReply } = require("../tools/academy/academyOrchestrator");
      if (hasActiveFlow(chatId)) {
        const out = await handleReply(chatId, senderJid.split("@")[0], text.trim());
        if (out) { await react(sock, msg, "📚"); return reply(sock, msg, out.text); }
      }
    } catch (_) {}
  }

  return routeMessage(sock, msg, context);
}

module.exports = { handleMessage };
