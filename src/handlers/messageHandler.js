// Slimmed-down message handler — routes to commandRouter
// Previously 1669 lines, now ~150. New commands go in commandRouter, not here.

const { getMessageText, getSenderName, reply, react, sleep, hasMedia, hasVoiceNote, downloadMediaFromMsg, isBotMentioned } = require("../utils/baileysHelpers");
const { routeMessage, triggeredByName } = require("../utils/commandRouter");
const { checkGroupProtection } = require("../tools/groupProtection");
const { handleWcgReply } = require("../tools/pasquaCommands");
const { isBanned, isMuted, isOwner: checkOwner } = require("../utils/permissions");
const { trackInteraction } = require("../utils/userMemory");
const { getMemory, saveMemory } = require("../utils/memory");
const { startSession, endSession, isSessionActive, touchSession } = require("../utils/chatSessions");
const { createSticker, downloadStickerMedia } = require("../tools/sticker");
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
  const botJids = [sock?.user?.id, sock?.user?.jid, sock?.user?.lid, sock?.user?.phoneNumber].filter(Boolean);
  const text = getMessageText(msg);
  const lower = text.toLowerCase().trim();

  // ── BAN / MUTE check ───────────────────────────────────────
  if (isBanned(senderJid)) return;
  // Direct @mentions bypass mute so a muted group can still summon ARIA.
  const directlyMentioned = isBotMentioned(msg, botJids) || triggeredByName(text);
  if (isMuted(chatId) && !checkOwner(senderJid) && !directlyMentioned) return;

  // ── Ignore bot's own messages ──────────────────────────────
  if (msg.key.fromMe) return;

  // ── Dashboard telemetry (real inbound messages only) ────────
  try { require("../tools/dashboardTelemetry").record("message"); } catch (_) {}

  // ── Platform identity + usage bridge ───────────────────────
  // Contacts are normalized into platform identities, while message usage is
  // attributed to the owner workspace during the transitional single-tenant
  // phase. This does not grant contacts tenant membership or business access.
  let platformContext = null;
  let platformActor = null;
  let revenueContext = null;
  try {
    const platform = require("../core");
    const bridge = require("../core/productBridge");
    const revenue = bridge.revenueContextForWhatsApp({ senderJid: senderJid || chatId, senderName, chatId });
    platformContext = revenue.context;
    platformActor = revenue.actor;
    revenueContext = revenue;
    if (platformContext && platformActor && msg.key?.id) {
      platform.usage.record({
        tenantId: platformContext.tenantId,
        actorId: platformActor.id,
        category: "messages",
        metric: "inbound",
        units: 1,
        metadata: { chatId, isGroup, source: "whatsapp" },
        idempotencyKey: `whatsapp:${msg.key.id}`,
      });
      bridge.recordProductActivity({
        product: "whatsapp",
        action: "message.received",
        context: platformContext,
        actorId: platformActor.id,
        aggregateType: "conversation",
        aggregateId: chatId,
        metadata: { isGroup, hasText: Boolean(text), messageId: msg.key.id },
        idempotencyKey: `whatsapp-message:${msg.key.id}`,
      });
    }
  } catch (_) {}

  // ── Revenue Engine observer ────────────────────────────────
  // Only clear private sales-intent messages are captured. This creates a
  // customer/lead/conversation record but never sends a sales message by itself.
  let revenueObservation = null;
  try {
    revenueObservation = require("../core/business/observer").observeWhatsAppMessage({ text, senderJid, senderName, chatId, isGroup });
    if (revenueObservation?.observed && platformContext) {
      require("../core/productBridge").recordProductActivity({
        product: "revenue-engine",
        action: "sales-intent.observed",
        context: platformContext,
        actorId: platformActor?.id,
        aggregateType: "lead",
        aggregateId: revenueObservation.lead?.id,
        metadata: { customerId: revenueObservation.customer?.id, createdLead: revenueObservation.createdLead, channel: "whatsapp" },
        idempotencyKey: msg.key?.id ? `revenue-observed:${msg.key.id}` : null,
      });
    }
  } catch (_) {}

  // ── Build context ──────────────────────────────────────────
  const context = { text, lower, senderJid, senderName, chatId, isGroup, loadedPlugins, msg, platformContext, platformActor, revenueContext, revenueObservation };

  if (isGroup) {
    const protection = checkGroupProtection({ text, msg, chatId, senderJid, isGroup });
    if (protection) {
      if (protection.action === "delete") {
        try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (_) {}
      }
      await reply(sock, msg, `🛡️ ${protection.reason}`);
      return;
    }
    try {
      if (await handleWcgReply(sock, msg, text, context)) return;
    } catch (_) {}
  }

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
  // Update autonomous-mode "last interaction" so ARIA knows the user is actually
  // active (previously it only tracked her own proactive ticks).
  try { require("../tools/autonomous").noteInteraction(senderJid); } catch (_) {}
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
  const configuredPrefix = String(process.env.BOT_PREFIX || "").trim().toLowerCase();
  const isCommand = (configuredPrefix && lower.startsWith(configuredPrefix)) || lower.startsWith("!");
  const hasNameTrigger = triggeredByName(text);
  const sessionActive = isSessionActive(chatId);
  const mentioned = isBotMentioned(msg, botJids);
  // In groups, only act when actually addressed. In DMs, always act.
  const shouldReply = !isGroup || hasNameTrigger || isCommand || mentioned || sessionActive;
  if (!shouldReply) return;

  // ── STICKER AUTO-CREATE (attached or replied image/GIF/video) ──
  // Try this before generic file analysis. If no media is attached or quoted,
  // leave the message for commandRouter so it can return its normal guidance.
  if (lower.includes("sticker")) {
    const media = await downloadStickerMedia(sock, msg);
    if (media) {
      await react(sock, msg, "🎭");
      const result = await createSticker(media.buffer, { mimetype: media.mimetype, filename: media.filename });
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

  // ── NAME TRIGGER, LEGACY PREFIX, OR ACTIVE FLOW ────────────
  // Active academy flow: if the chat is mid-!academy and this is a plain
  // reply (number / next / prev / back / done / quiz letter), intercept before
  // normal AI chat so the adaptive learning system can advance the session.
  if (!isCommand && !hasMedia(msg) && !hasVoiceNote(msg)) {
    try {
      // Production incident simulator takes priority (free-form diagnosis/fix).
      const incident = require("../tools/academy/incidentSimulator");
      if (incident.hasActiveFlow(chatId)) {
        const out = await incident.handleReply(chatId, senderJid.split("@")[0], text.trim());
        if (out) { await react(sock, msg, "🚨"); return reply(sock, msg, out.text); }
      }
    } catch (_) {}
    try {
      // Standalone project submission (no academy session required).
      const pw = require("../tools/academy/projectWorkspace");
      if (pw.hasActiveProject(senderJid.split("@")[0])) {
        const out = await pw.handleProjectReply(chatId, senderJid.split("@")[0], text.trim());
        if (out) { await react(sock, msg, "🏗️"); return reply(sock, msg, out.text); }
      }
    } catch (_) {}
    try {
      const { hasActiveFlow, handleReply } = require("../tools/academy/academyOrchestrator");
      if (hasActiveFlow(chatId)) {
        const out = await handleReply(chatId, senderJid.split("@")[0], text.trim());
        if (out) { await react(sock, msg, "📚"); return reply(sock, msg, out.text); }
      }
    } catch (_) {}
    try {
      const review = require("../tools/academy/reviewCourt");
      if (review.hasActiveFlow(chatId)) {
        const out = await review.handleReply(chatId, senderJid.split("@")[0], text.trim());
        if (out) { await react(sock, msg, "⚖️"); return reply(sock, msg, out.text); }
      }
    } catch (_) {}
    try {
      const teach = require("../tools/academy/teachBack");
      if (teach.hasActiveFlow(chatId)) {
        const out = await teach.submitExplanation(chatId, senderJid.split("@")[0], text.trim());
        if (out) { await react(sock, msg, "🧑‍🏫"); return reply(sock, msg, out.text); }
      }
    } catch (_) {}
  }

  return routeMessage(sock, msg, context);
}

module.exports = { handleMessage };
