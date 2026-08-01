// Slimmed-down message handler — routes to commandRouter
// Previously 1669 lines, now ~150. New commands go in commandRouter, not here.

const { getMessageText, getSenderName, reply, react, sleep, hasMedia, hasVoiceNote, downloadMediaFromMsg } = require("../utils/baileysHelpers");
const { routeMessage, triggeredByName } = require("../utils/commandRouter");
const { isBanned, isMuted, isOwner } = require("../utils/permissions");
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

const BOT_NAME = (process.env.BOT_NAME || "aria").toLowerCase();

async function handleMessage(sock, msg, loadedPlugins = []) {
  const chatId = msg.key.remoteJid;
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderName = getSenderName(msg);
  const isGroup = chatId?.includes("g.us");
  const text = getMessageText(msg);
  const lower = text.toLowerCase().trim();

  // ── BAN / MUTE check ───────────────────────────────────────
  if (isBanned(senderJid)) return;
  if (isMuted(chatId) && !isOwner(senderJid)) return;

  // ── Ignore bot's own messages ──────────────────────────────
  if (msg.key.fromMe) return;

  // ── Build context ──────────────────────────────────────────
  const context = { text, lower, senderJid, senderName, chatId, isGroup, loadedPlugins };

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
      await react(sock, msg, "📊");
      const question = text || "Analyze this file.";
      const result = await analyzeFile(media, question);
      return reply(sock, msg, result);
    }
  }

  // ── VOICE NOTE auto-transcription ──────────────────────────
  if (hasVoiceNote(msg)) {
    await react(sock, msg, "🎤");
    const media = await downloadMediaFromMsg(sock, msg);
    if (media) {
      const transcription = await transcribeVoice(media.buffer);
      if (transcription) {
        return reply(sock, msg, `📝 *Transcription:*\n${transcription}`);
      }
    }
  }

  // ── NAME TRIGGER or PREFIX COMMAND or NON-TRIVIAL TEXT ─────
  const hasNameTrigger = triggeredByName(text);
  const isCommand = lower.startsWith(process.env.BOT_PREFIX || "!");
  const isMeaningful = text.length >= 2;

  if (hasNameTrigger || isCommand || isMeaningful) {
    return routeMessage(sock, msg, context);
  }
}

module.exports = { handleMessage };
