// Slimmed-down message handler — routes to commandRouter
// Previously 1669 lines, now ~150. New commands go in commandRouter, not here.

const { getMessageText, getSenderName, reply, react, sleep, hasMedia, hasVoiceNote, downloadMediaFromMsg, downloadQuotedMedia, findQuotedMediaReference, getQuotedMessageText, isQuotingBotMessage, isBotMentioned, getBotMentionJids } = require("../utils/baileysHelpers");
const { routeMessage, triggeredByName } = require("../utils/commandRouter");
const { checkGroupProtection } = require("../tools/groupProtection");
const { handleWcgReply } = require("../tools/pasquaCommands");
const { isBanned, isMuted, isOwner: checkOwner } = require("../utils/permissions");
const { trackInteraction } = require("../utils/userMemory");
const { getMemory, saveMemory } = require("../utils/memory");
const { createSticker, downloadStickerMedia } = require("../tools/sticker");
const { analyzeFile } = require("../tools/fileUnderstanding");
const { transcribeVoice } = require("../tools/voice");
const { getAIResponse } = require("../tools/ai");
const { getPreferences } = require("../utils/userPreferences");
const { getFactsContext } = require("../utils/learnedFacts");
const { log, error, warn } = require("../utils/logger");
const { updateMood, humanDelay, isSleeping, sleepResponseMode, getStateMessage } = require("../tools/humanity");

const BOT_NAME = (process.env.BOT_NAME || "aria").toLowerCase();
const RECENT_MESSAGE_TTL_MS = 5 * 60 * 1000;
const REPEATED_TEXT_WINDOW_MS = 5000;
const recentMessageIds = new Map();
const recentInboundTexts = new Map();

function claimInboundMessage(messageId, chatId, senderJid, text) {
  const now = Date.now();
  for (const [key, at] of recentMessageIds) if (now - at > RECENT_MESSAGE_TTL_MS) recentMessageIds.delete(key);
  for (const [key, at] of recentInboundTexts) if (now - at > REPEATED_TEXT_WINDOW_MS) recentInboundTexts.delete(key);
  if (messageId) {
    if (recentMessageIds.has(messageId)) return false;
    recentMessageIds.set(messageId, now);
  }
  const normalizedText = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalizedText) return true;
  const textKey = `${chatId || ""}:${senderJid || ""}:${normalizedText}`;
  if (recentInboundTexts.has(textKey)) return false;
  recentInboundTexts.set(textKey, now);
  return true;
}

function shouldReplyInGroup({ isGroup, mentioned, isReplyToBot, hasNameTrigger, isCommand }) {
  if (!isGroup) return true;
  // In groups, ARIA may be addressed by name, a valid command, a real
  // WhatsApp mention, or a direct reply. Do not let an active session alone
  // turn every unrelated group message into a response.
  return Boolean(mentioned || isReplyToBot || hasNameTrigger || isCommand);
}

async function handleMessage(sock, msg, loadedPlugins = []) {
  const chatId = msg.key.remoteJid;
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderName = getSenderName(msg);
  const isGroup = chatId?.includes("g.us");
  // WhatsApp may expose the bot as a phone JID, device JID, or LID. Use the
  // canonical helper so @mentions work across all three representations.
  const botJids = getBotMentionJids(sock);
  const text = getMessageText(msg);
  const lower = text.toLowerCase().trim();

  // ── BAN / MUTE check ───────────────────────────────────────
  if (isBanned(senderJid)) return;
  // Direct @mentions bypass mute so a muted group can still summon ARIA.
  const directlyMentioned = isBotMentioned(msg, botJids) || triggeredByName(text);
  if (isMuted(chatId) && !checkOwner(senderJid) && !directlyMentioned) return;

  // ── Ignore bot's own messages ──────────────────────────────
  if (msg.key.fromMe) return;
  // Baileys can redeliver the same event, and rapid case-only repeats such as
  // "Aria"/"ARIA" should not start multiple AI calls in the same group.
  if (!claimInboundMessage(msg.key?.id, chatId, senderJid, text)) return;

  // ── Dashboard telemetry and structured event memory ─────────
  try { require("../tools/dashboardTelemetry").record("message"); } catch (_) {}
  try {
    require("../utils/eventLog").trackConversationEvent(chatId, "inbound", isGroup ? "Group message received" : "Direct message received", {
      senderJid,
      hasText: Boolean(text),
      hasMedia: hasMedia(msg),
      hasVoice: hasVoiceNote(msg),
      addressed: Boolean(triggeredByName(text)),
    });
  } catch (_) {}

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

  // ── GROUP ADDRESSING GATE ──────────────────────────────────
  // Group messages must address ARIA by name, command, mention, or reply.
  // Keep the gate before conversational flow handlers so an active session
  // alone cannot make her reply to unrelated group traffic.
  const configuredPrefix = String(process.env.BOT_PREFIX || "").trim().toLowerCase();
  const isCommand = (configuredPrefix && lower.startsWith(configuredPrefix)) || lower.startsWith("!");
  const hasNameTrigger = triggeredByName(text);
  const mentioned = isBotMentioned(msg, botJids);
  const isReplyToBot = isQuotingBotMessage(msg);
  if (!shouldReplyInGroup({ isGroup, mentioned, isReplyToBot, hasNameTrigger, isCommand })) return;

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
    // Silent mode preserves the old behavior; reply mode avoids making normal
    // users believe ARIA is broken during configured sleep hours.
    if (sleepResponseMode() === "silent") return;
    return reply(sock, msg, "🌙 I’m offline for sleep right now, but I’ll be back soon.");
  }

  // ── DECIDE WHETHER TO REPLY (checked for text AND media/voice) ──
  // Direct commands, mentions, and named action requests should feel immediate.
  // Keep the optional typing delay only for ordinary conversational messages.
  if (!isCommand && !hasNameTrigger && !mentioned) {
    await humanDelay(sock, chatId, senderJid, text.length + 1);
  }

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

  // ── VISUAL MEDIA → CONVERSATIONAL VISION ────────────────────
  // Stickers and images are treated as part of the conversation. A bare
  // reaction gets a natural response; explicit questions get precise details.
  if (hasMedia(msg)) {
    const media = await downloadMediaFromMsg(sock, msg);
    if (media) {
      const visual = /^image\//i.test(String(media.mimetype || ""));
      if (visual) {
        const kind = /webp/i.test(String(media.mimetype || "")) && (msg.message?.stickerMessage || msg.message?.ephemeralMessage?.message?.stickerMessage || msg.message?.viewOnceMessage?.message?.stickerMessage) ? "sticker" : "image";
        const { respondToMedia } = require("../tools/visionAI");
        const visualBase64 = media.buffer.toString("base64");
        const result = await respondToMedia(visualBase64, media.mimetype, {
          kind,
          question: text,
          history: getMemory(chatId),
          quotedContext: getQuotedMessageText(msg) || "",
        });
        try { require("../tools/visualContext").remember(chatId, { base64: visualBase64, mimeType: media.mimetype, kind }); } catch (_) {}
        try {
          const { rememberObservation } = require("../tools/mediaMemory");
          rememberObservation(senderJid, result, { kind, mimeType: media.mimetype, question: text });
        } catch (_) {}
        return reply(sock, msg, result);
      }

      const question = text || "Analyze this file.";
      const result = await analyzeFile(media, question);
      return reply(sock, msg, result);
    }
  }

  // If the user replies to ARIA while referring to an earlier image/sticker,
  // recover the bounded quoted media chain and answer the follow-up directly.
  if (!hasMedia(msg) && text && findQuotedMediaReference(msg)) {
    const quotedMedia = await downloadQuotedMedia(sock, msg);
    if (quotedMedia && /^image\//i.test(String(quotedMedia.mimetype || ""))) {
      const { respondToMedia } = require("../tools/visionAI");
      const kind = /webp/i.test(String(quotedMedia.mimetype || "")) ? "sticker" : "image";
      const result = await respondToMedia(quotedMedia.buffer.toString("base64"), quotedMedia.mimetype, {
        kind,
        question: text,
        history: getMemory(chatId),
        quotedContext: getQuotedMessageText(msg) || "",
      });
      try {
        const { rememberObservation } = require("../tools/mediaMemory");
        rememberObservation(senderJid, result, { kind, mimeType: quotedMedia.mimetype, question: text });
      } catch (_) {}
      return reply(sock, msg, result);
    }
  }

  // Short follow-up continuity: if a user asks about the last visual in the
  // same chat without quoting it, reuse the bounded in-memory media reference.
  if (!hasMedia(msg) && text) {
    const previousVisual = (() => { try { return require("../tools/visualContext").get(chatId); } catch (_) { return null; } })();
    const visualFollowUp = /\b(?:what(?:'s| is)\s+(?:in|shown|happening|that|this|it)|describe\s+(?:that|this|it)|explain\s+(?:that|this|it)|read\s+(?:that|this|it)|how\s+(?:can|do)\s+you\s+(?:read|see|understand)|what\s+does\s+(?:it|that|this)\s+say|exact(?:ly)?\s+what)\b/i.test(text);
    if (previousVisual && visualFollowUp) {
      const { respondToMedia } = require("../tools/visionAI");
      const result = await respondToMedia(previousVisual.base64, previousVisual.mimeType, {
        kind: previousVisual.kind,
        question: text,
        history: getMemory(chatId),
      });
      try {
        const { rememberObservation } = require("../tools/mediaMemory");
        rememberObservation(senderJid, result, { kind: previousVisual.kind, mimeType: previousVisual.mimeType, question: text });
      } catch (_) {}
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
module.exports = { handleMessage, _test: { claimInboundMessage, shouldReplyInGroup } };
