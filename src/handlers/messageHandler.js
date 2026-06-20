const axios = require("axios");
const { getAIResponse } = require("../tools/ai");
const { searchWeb } = require("../tools/webSearch");
const { generateImage } = require("../tools/imageGen");
const { downloadMedia } = require("../tools/downloader");
const { runCode } = require("../tools/codeRunner");
const { setReminder } = require("../tools/reminders");
const { analyzeFile } = require("../tools/fileAnalyzer");
const { scrapeUrl } = require("../tools/scraper");
const { sendFile, extractCodeBlock } = require("../tools/fileSender");
const { readFromLink, detectFileLink } = require("../tools/linkReader");
const { createSticker } = require("../tools/sticker");
const { transcribeVoice } = require("../tools/voice");
const { textToSpeech } = require("../tools/tts");
const { translateText, convertCurrency, convertUnit, getWeather, weatherCodeToDescription } = require("../tools/utilities");
const { getNewsDigest } = require("../tools/news");
const { setRecurringReminder, cancelRecurringReminder, listRecurringReminders } = require("../tools/recurringReminders");
const { runAgentTask } = require("../tools/agent");
const { buildProject, continueProject, getProjectStatus, listProjects, cancelProject } = require("../tools/appBuilder");
const { getMemory, saveMemory } = require("../utils/memory");
const { wasSentByBot } = require("../utils/botMessages");
const { startSession, endSession, isSessionActive, touchSession } = require("../utils/chatSessions");
const { isOwner, isAdmin, addAdmin, removeAdmin, listAdmins, banUser, unbanUser, isBanned, muteChat, unmuteChat, isMuted } = require("../utils/permissions");
const { getStats, getRecentErrors, logError, broadcastToAll } = require("../tools/botAdmin");
const { isBotAdmin, isSenderAdmin, kickUser, promoteUser, demoteUser, tagAll, hideTag } = require("../tools/groupAdmin");
const { getGroupSettings, setAntilink, setWelcome, setWelcomeMessage, setLeaveMessage, addWarning, resetWarnings, getWarnings } = require("../utils/groupSettings");
const { getJoke, getTruth, getDare, getWouldYouRather, getRoast, getShipPercentage, getShipEmoji } = require("../tools/funGames");
const { startTicTacToe, playTicTacToe, hasActiveGame, endGame, rollDice, flipCoin } = require("../tools/simpleGames");
const { drawCard, getBalance, claimDaily, getInventory, sellCard, getLeaderboard, RARITY_VALUE } = require("../tools/cardEconomy");
const { renderCodeImage } = require("../tools/carbon");
const { extractText } = require("../tools/visionAI");
const { getLyrics } = require("../tools/lyricsSearch");
const { searchWallpaper } = require("../tools/wallpaperSearch");

const BOT_NAME = (process.env.BOT_NAME || "aria").toLowerCase();
const PREFIX = process.env.BOT_PREFIX || "!";

const NAME_TRIGGERS = [BOT_NAME, BOT_NAME + ",", BOT_NAME + "!", "hey " + BOT_NAME, "ok " + BOT_NAME, "yo " + BOT_NAME];

const INTENTS = {
  image: ["generate an image", "generate a picture", "create an image", "make an image", "draw me", "draw a", "imagine a", "imagine an", "paint a", "paint me", "design an image", "give me an image", "show me a picture", "make a picture"],
  search: ["search for", "look up", "google", "search the web", "find info on"],
  download: ["download", "dl this", "get this video", "save this"],
  scrape: ["read this link", "open this link", "check this site", "visit", "browse", "summarize this link", "what's on this site"],
  remind: ["remind me", "set a reminder", "alert me", "notify me in"],
  clear: ["clear memory", "reset chat", "forget everything", "start over"],
  help: ["help", "show commands", "what can you do", "menu"],
  sticker: ["make this a sticker", "sticker this", "turn into sticker", "create sticker"],
  voiceReply: ["say this", "voice note", "speak this", "read this out", "say it out loud"],
  translate: ["translate", "say this in", "how do you say"],
  weather: ["weather in", "weather for", "what's the weather"],
  news: ["news about", "latest news", "news on", "what's happening with"],
  agent: ["figure out", "plan and", "research and", "find and compare", "deep dive on"],
  build: ["build me a", "build an app", "build a website", "create an app", "create a website", "make me an app", "make me a website", "code me", "create a project"],
};

// ── Baileys helper functions (replaces whatsapp-web.js msg.reply / msg.react) ──

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

// Gets the JID of whoever was @mentioned in the message, or who the message
// is replying to — used for kick/promote/demote/warn targeting.
function getTargetJid(msg) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned && mentioned.length > 0) return mentioned[0];
  const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (quotedParticipant) return quotedParticipant;
  return null;
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
    // Split long messages
    const chunks = splitMessage(text, 3900);
    for (let i = 0; i < chunks.length; i++) {
      await sock.sendMessage(chatId, { text: chunks[i], mentions: i === 0 ? mentions : [] });
      await sleep(400);
    }
  } catch (err) {
    console.error("Reply error:", err.message);
  }
}

async function react(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key },
    });
  } catch (_) {
    // Reactions can fail silently, not critical
  }
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

// Checks if this message is a WhatsApp "reply" (quote) pointing at a message
// ARIA itself sent. Uses the stanzaId (the quoted message's own ID) checked against
// our own tracked sent-message IDs — this is reliable regardless of DM/group context,
// unlike trying to guess which JID field WhatsApp populated for the quoted sender.
function isQuotingBotMessage(msg, sock) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo
    || msg.message?.audioMessage?.contextInfo;

  const stanzaId = contextInfo?.stanzaId;
  if (!stanzaId) return false;

  return wasSentByBot(stanzaId);
}

function hasMedia(msg) {
  return !!(msg.message?.imageMessage || msg.message?.documentMessage || msg.message?.videoMessage);
}

function hasVoiceNote(msg) {
  return !!(msg.message?.audioMessage);
}

async function downloadMediaFromMsg(sock, msg) {
  const { downloadMediaMessage } = require("@whiskeysockets/baileys");
  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {});
    const mediaMsg = msg.message?.imageMessage || msg.message?.documentMessage || msg.message?.videoMessage || msg.message?.audioMessage;
    return {
      data: buffer.toString("base64"),
      buffer,
      mimetype: mediaMsg?.mimetype || "application/octet-stream",
      filename: mediaMsg?.fileName || null,
    };
  } catch (err) {
    console.error("Media download error:", err.message);
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────
async function handleMessage(sock, msg) {
  const chatId = msg.key.remoteJid;
  if (chatId === "status@broadcast") return;

  const senderJid = msg.key.participant || msg.key.remoteJid;

  // Banned users get nothing, no matter what they send
  if (isBanned(senderJid)) return;

  const body = getMessageText(msg).trim();
  const lower = body.toLowerCase();
  const senderName = getSenderName(msg);
  const isGroup = chatId.endsWith("@g.us");
  const isReplyToBot = isQuotingBotMessage(msg, sock);
  if (process.env.DEBUG_REPLIES === "true") {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    console.log("DEBUG quoted contextInfo:", JSON.stringify(ctx, null, 2)?.slice(0, 500));
    console.log("DEBUG isReplyToBot result:", isReplyToBot);
  }

  console.log(`[${senderName}${isGroup ? " (grp)" : ""}] ${body.slice(0, 80)}`);

  let activeBody = body;
  const sessionActive = isSessionActive(chatId);

  if (isGroup) {
    const namedTrigger = NAME_TRIGGERS.find((t) => lower.startsWith(t));
    const prefixTrigger = lower.startsWith(PREFIX) || new RegExp(`^\\${PREFIX}\\s`).test(lower);
    // Replying directly to one of ARIA's messages, or having an active !chat session,
    // both count as addressing it — same as saying its name, no prefix needed either way.
    if (!namedTrigger && !prefixTrigger && !isReplyToBot && !sessionActive && !hasMedia(msg)) return;
    if (namedTrigger) {
      activeBody = body.slice(namedTrigger.length).trim();
      if (!activeBody) return reply(sock, msg, `Yeah? What do you need? 👀`);
    }
  } else {
    const namedTrigger = NAME_TRIGGERS.find((t) => lower.startsWith(t));
    if (namedTrigger) {
      activeBody = body.slice(namedTrigger.length).trim();
      if (!activeBody) return reply(sock, msg, `Yeah? What do you need? 👀`);
    }
  }

  if (sessionActive) touchSession(chatId); // keep the 30-min window alive on each message

  // Normalize "! command" to "!command" — a space after the prefix shouldn't
  // silently break every command and fall through to AI chat with no explanation.
  const prefixSpaceRegex = new RegExp(`^(\\${PREFIX})\\s+`);
  if (prefixSpaceRegex.test(activeBody)) {
    activeBody = activeBody.replace(prefixSpaceRegex, PREFIX);
  }

  const activeLower = activeBody.toLowerCase();

  // Muted chats — owner/admin commands still work, everything else is silenced
  if (isMuted(chatId) && !isAdmin(senderJid)) return;

  // Antilink enforcement — delete messages containing links if enabled and sender isn't admin
  if (isGroup && getGroupSettings(chatId).antilink && !(await isSenderAdmin(sock, chatId, senderJid))) {
    const hasLink = /https?:\/\/|wa\.me\/|chat\.whatsapp\.com/i.test(body);
    if (hasLink) {
      try {
        await sock.sendMessage(chatId, { delete: msg.key });
        await reply(sock, msg, `🔗 @${senderJid.split("@")[0]}, links aren't allowed here.`, { mentions: [senderJid] });
      } catch (err) {
        console.error("Antilink delete failed:", err.message);
      }
      return;
    }
  }

  // ── OWNER & ADMIN COMMANDS ───────────────────────────────────
  if (activeLower.startsWith(`${PREFIX}stats`) && isAdmin(senderJid)) {
    const s = getStats();
    return reply(sock, msg, `*📊 ARIA Stats*\n\n⏱️ Uptime: ${s.uptime}\n💬 Total chats: ${s.totalChats}\n🧠 Stored messages: ${s.totalStoredMessages}\n💾 RAM used: ${s.ramUsedMB}MB\n⚙️ Node: ${s.nodeVersion}`);
  }

  if (activeLower.startsWith(`${PREFIX}broadcast`) && isAdmin(senderJid)) {
    const message = activeBody.split(" ").slice(1).join(" ");
    if (!message) return reply(sock, msg, `Usage: \`${PREFIX}broadcast Your message here\``);
    await reply(sock, msg, "📢 Broadcasting...");
    const result = await broadcastToAll(sock, message);
    return reply(sock, msg, `✅ Sent to ${result.sent}/${result.total} chats (${result.failed} failed).`);
  }

  if (activeLower.startsWith(`${PREFIX}debug`) && isAdmin(senderJid)) {
    const errors = getRecentErrors(5);
    if (errors.length === 0) return reply(sock, msg, "✅ No recent errors logged.");
    const text = errors.map((e) => `*${e.time}*\n[${e.context}] ${e.error}`).join("\n\n");
    return reply(sock, msg, `*🐛 Recent Errors:*\n\n${text}`);
  }

  if (activeLower.startsWith(`${PREFIX}ban`) && isAdmin(senderJid)) {
    const number = activeBody.split(" ")[1];
    if (!number) return reply(sock, msg, `Usage: \`${PREFIX}ban 2376XXXXXXXX\``);
    banUser(number);
    return reply(sock, msg, `🚫 Banned ${number}.`);
  }

  if (activeLower.startsWith(`${PREFIX}unban`) && isAdmin(senderJid)) {
    const number = activeBody.split(" ")[1];
    if (!number) return reply(sock, msg, `Usage: \`${PREFIX}unban 2376XXXXXXXX\``);
    unbanUser(number);
    return reply(sock, msg, `✅ Unbanned ${number}.`);
  }

  if (activeLower.startsWith(`${PREFIX}mute`) && isAdmin(senderJid)) {
    muteChat(chatId);
    return reply(sock, msg, `🔇 Muted in this chat. Admins can still use commands.`);
  }

  if (activeLower.startsWith(`${PREFIX}unmute`) && isAdmin(senderJid)) {
    unmuteChat(chatId);
    return reply(sock, msg, `🔊 Unmuted. Back to normal.`);
  }

  if (activeLower.startsWith(`${PREFIX}addadmin`) && isOwner(senderJid)) {
    const number = activeBody.split(" ")[1];
    if (!number) return reply(sock, msg, `Usage: \`${PREFIX}addadmin 2376XXXXXXXX\``);
    addAdmin(number);
    return reply(sock, msg, `✅ ${number} is now an admin.`);
  }

  if (activeLower.startsWith(`${PREFIX}removeadmin`) && isOwner(senderJid)) {
    const number = activeBody.split(" ")[1];
    if (!number) return reply(sock, msg, `Usage: \`${PREFIX}removeadmin 2376XXXXXXXX\``);
    removeAdmin(number);
    return reply(sock, msg, `✅ Removed ${number} from admins.`);
  }

  if (activeLower.startsWith(`${PREFIX}admins`) && isAdmin(senderJid)) {
    const list = listAdmins();
    return reply(sock, msg, list.length ? `*Admins:*\n${list.join("\n")}` : "No admins added yet.");
  }

  if (activeLower === `${PREFIX}whoami`) {
    if (isOwner(senderJid)) return reply(sock, msg, `👑 You're my creator. Full access, always.`);
    if (isAdmin(senderJid)) return reply(sock, msg, `🛡️ You're an admin.`);
    return reply(sock, msg, `👤 You're a regular user.`);
  }

  if (activeLower === `${PREFIX}model`) {
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasGroq = !!process.env.GROQ_API_KEY;
    const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
    return reply(
      sock,
      msg,
      `*🧠 AI Provider Chain*\n\n1. Gemini 2.0 Flash ${hasGemini ? "✅ configured" : "❌ no key set"}\n2. Groq (gpt-oss-120b) ${hasGroq ? "✅ configured" : "❌ no key set"}\n3. OpenRouter ${hasOpenRouter ? "✅ configured" : "❌ no key set"}\n\nTries each in order until one responds successfully.`
    );
  }

  if (activeLower === `${PREFIX}health`) {
    await react(sock, msg, "🩺");
    const checks = await runHealthCheck();
    const text = checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`).join("\n");
    return reply(sock, msg, `*🩺 Health Check*\n\n${text}`);
  }

  // ── VOICE NOTE TRANSCRIPTION ─────────────────────────────────
  if (hasVoiceNote(msg)) {
    const mediaData = await downloadMediaFromMsg(sock, msg);
    if (mediaData) {
      await react(sock, msg, "🎤");
      const result = await transcribeVoice(mediaData.buffer, mediaData.mimetype);
      if (result.success) {
        await reply(sock, msg, `🎤 *Transcription:*\n_"${result.text}"_`);
        // Also let the AI respond to what was said, like a normal message
        const history = getMemory(chatId);
        const response = await getAIResponse(result.text, senderName, history);
        saveMemory(chatId, [...history, { role: "user", content: result.text }, { role: "assistant", content: response }]);
        await handleResponseWithFile(sock, msg, response);
      } else {
        await reply(sock, msg, `❌ Couldn't transcribe that: ${result.error}`);
      }
    }
    return;
  }

  // ── STICKER CONVERSION (image + sticker intent) ─────────────
  if (hasMedia(msg) && INTENTS.sticker.some((k) => activeLower.includes(k))) {
    const mediaData = await downloadMediaFromMsg(sock, msg);
    if (mediaData && mediaData.mimetype.startsWith("image/")) {
      await react(sock, msg, "🎭");
      const result = await createSticker(mediaData.buffer);
      if (result.success) {
        await sock.sendMessage(chatId, { sticker: result.buffer });
      } else {
        await reply(sock, msg, `❌ Sticker creation failed: ${result.error}`);
      }
      return;
    }
  }

  // ── FILE ANALYSIS ───────────────────────────────────────────
  if (hasMedia(msg)) {
    const mediaData = await downloadMediaFromMsg(sock, msg);
    if (mediaData) {
      await react(sock, msg, "📊");
      const question = activeBody || "Analyze this file and tell me everything about it.";
      const result = await analyzeFile(mediaData, question);
      return reply(sock, msg, result);
    }
  }

  // ── PREFIX COMMANDS ─────────────────────────────────────────
  if (activeLower.startsWith(`${PREFIX}imagine`) || activeLower.startsWith(`${PREFIX}img`)) {
    return handleImageGen(sock, msg, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower.startsWith(`${PREFIX}search`) || activeLower.startsWith(`${PREFIX}web`)) {
    return handleSearch(sock, msg, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower.startsWith(`${PREFIX}dl`) || activeLower.startsWith(`${PREFIX}download`)) {
    return handleDownload(sock, msg, activeBody.split(" ")[1]);
  }
  if (activeLower.startsWith(`${PREFIX}run`) || activeLower.startsWith(`${PREFIX}exec`)) {
    const parts = activeBody.split("\n");
    return handleCode(sock, msg, parts.slice(1).join("\n"), parts[0].split(" ")[1] || "js");
  }
  if (activeLower.startsWith(`${PREFIX}build`) || activeLower.startsWith(`${PREFIX}agent`)) {
    const request = activeBody.split(" ").slice(1).join(" ");
    return handleBuild(sock, msg, request);
  }
  if (activeLower.startsWith(`${PREFIX}continue`) || activeLower.startsWith(`${PREFIX}resume`)) {
    const projectId = activeBody.split(" ")[1] || null;
    return handleContinue(sock, msg, projectId);
  }
  if (activeLower.startsWith(`${PREFIX}status`)) {
    const projectId = activeBody.split(" ")[1] || null;
    return handleProjectStatus(sock, msg, projectId);
  }
  if (activeLower.startsWith(`${PREFIX}projects`)) {
    return handleProjectList(sock, msg);
  }
  if (activeLower.startsWith(`${PREFIX}cancelbuild`)) {
    const projectId = activeBody.split(" ")[1] || null;
    return handleProjectCancel(sock, msg, projectId);
  }
  if (activeLower.startsWith(`${PREFIX}scrape`) || activeLower.startsWith(`${PREFIX}read`)) {
    return handleScrape(sock, msg, activeBody.split(" ")[1]);
  }
  if (activeLower.startsWith(`${PREFIX}remind`)) {
    return handleRemind(sock, msg, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower.startsWith(`${PREFIX}every`)) {
    const text = activeBody.split(" ").slice(1).join(" ");
    const result = setRecurringReminder(sock, chatId, "every " + text);
    return reply(sock, msg, result.message);
  }
  if (activeLower.startsWith(`${PREFIX}cancelreminder`)) {
    const id = activeBody.split(" ")[1];
    const cancelled = cancelRecurringReminder(id);
    return reply(sock, msg, cancelled ? "✅ Recurring reminder cancelled." : "❌ Couldn't find that reminder ID.");
  }
  if (activeLower === `${PREFIX}reminders`) {
    const list = listRecurringReminders(chatId);
    if (list.length === 0) return reply(sock, msg, "No active recurring reminders in this chat.");
    const text = list.map((r) => `• ${r.label} — _"${r.message}"_\n  ID: \`${r.id}\``).join("\n\n");
    return reply(sock, msg, `*🔁 Active Recurring Reminders:*\n\n${text}`);
  }
  if (activeLower.startsWith(`${PREFIX}weather`)) {
    return handleWeather(sock, msg, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower.startsWith(`${PREFIX}translate`)) {
    const parts = activeBody.split(" ").slice(1);
    const targetLang = parts[0];
    const text = parts.slice(1).join(" ");
    return handleTranslate(sock, msg, text, targetLang);
  }
  if (activeLower.startsWith(`${PREFIX}news`)) {
    return handleNews(sock, msg, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower.startsWith(`${PREFIX}convert`)) {
    return handleConvert(sock, msg, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower.startsWith(`${PREFIX}say`)) {
    return handleTTS(sock, msg, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower.startsWith(`${PREFIX}poll`)) {
    return handlePoll(sock, msg, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower === `${PREFIX}help` || activeLower === `${PREFIX}menu`) {
    return reply(sock, msg, getHelpMenu(senderJid));
  }
  if (activeLower === `${PREFIX}clear` || activeLower === `${PREFIX}reset`) {
    saveMemory(chatId, []);
    return reply(sock, msg, "🧹 Memory cleared. Fresh start!");
  }
  if (activeLower === `${PREFIX}chat`) {
    startSession(chatId);
    return reply(sock, msg, "💬 Chat mode enabled. Talk normally, no need to say my name or use prefixes. Send `!exit` to leave this mode (auto-expires after 30 min of inactivity).");
  }
  if (activeLower === `${PREFIX}exit`) {
    endSession(chatId);
    return reply(sock, msg, "👋 Chat mode disabled. Back to normal — say my name or use ! commands.");
  }

  // ── GROUP ADMIN COMMANDS (only work in groups, need bot+sender to be admin) ──
  if (isGroup && activeLower.startsWith(`${PREFIX}kick`)) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    if (!(await isBotAdmin(sock, chatId))) return reply(sock, msg, "❌ I need to be a group admin to do that.");
    const target = getTargetJid(msg);
    if (!target) return reply(sock, msg, "Tag or reply to the person you want to kick.");
    const result = await kickUser(sock, chatId, target);
    return reply(sock, msg, result.success ? "👋 Kicked." : `❌ ${result.error}`);
  }

  if (isGroup && activeLower.startsWith(`${PREFIX}promote`)) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    if (!(await isBotAdmin(sock, chatId))) return reply(sock, msg, "❌ I need to be a group admin to do that.");
    const target = getTargetJid(msg);
    if (!target) return reply(sock, msg, "Tag or reply to the person you want to promote.");
    const result = await promoteUser(sock, chatId, target);
    return reply(sock, msg, result.success ? "⬆️ Promoted to admin." : `❌ ${result.error}`);
  }

  if (isGroup && activeLower.startsWith(`${PREFIX}demote`)) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    if (!(await isBotAdmin(sock, chatId))) return reply(sock, msg, "❌ I need to be a group admin to do that.");
    const target = getTargetJid(msg);
    if (!target) return reply(sock, msg, "Tag or reply to the person you want to demote.");
    const result = await demoteUser(sock, chatId, target);
    return reply(sock, msg, result.success ? "⬇️ Demoted." : `❌ ${result.error}`);
  }

  if (isGroup && (activeLower.startsWith(`${PREFIX}tagall`) || activeLower.startsWith(`${PREFIX}hidetag`))) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    const customMsg = activeBody.split(" ").slice(1).join(" ");
    const fn = activeLower.startsWith(`${PREFIX}hidetag`) ? hideTag : tagAll;
    const result = await fn(sock, msg, chatId, customMsg);
    if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
    return;
  }

  if (isGroup && activeLower.startsWith(`${PREFIX}warn`) && !activeLower.startsWith(`${PREFIX}warnings`)) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    const target = getTargetJid(msg);
    if (!target) return reply(sock, msg, "Tag or reply to the person you want to warn.");
    const count = addWarning(chatId, target);
    return reply(sock, msg, `⚠️ Warned @${target.split("@")[0]} (${count}/3 warnings).`, { mentions: [target] });
  }

  if (isGroup && activeLower.startsWith(`${PREFIX}resetwarn`)) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    const target = getTargetJid(msg);
    if (!target) return reply(sock, msg, "Tag or reply to the person whose warnings you want to reset.");
    resetWarnings(chatId, target);
    return reply(sock, msg, `✅ Warnings reset for @${target.split("@")[0]}.`, { mentions: [target] });
  }

  if (isGroup && activeLower.startsWith(`${PREFIX}antilink`)) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    const arg = activeBody.split(" ")[1]?.toLowerCase();
    if (arg === "on") { setAntilink(chatId, true); return reply(sock, msg, "🔗 Antilink enabled. I'll remove messages with links."); }
    if (arg === "off") { setAntilink(chatId, false); return reply(sock, msg, "🔗 Antilink disabled."); }
    return reply(sock, msg, `Usage: \`${PREFIX}antilink on\` or \`${PREFIX}antilink off\``);
  }

  if (isGroup && activeLower.startsWith(`${PREFIX}setwelcome`)) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    const message = activeBody.split(" ").slice(1).join(" ");
    if (!message) return reply(sock, msg, `Usage: \`${PREFIX}setwelcome Welcome {user} to the group!\` (use {user} as a placeholder)`);
    setWelcomeMessage(chatId, message);
    setWelcome(chatId, true);
    return reply(sock, msg, "✅ Welcome message set and enabled.");
  }

  if (isGroup && activeLower.startsWith(`${PREFIX}welcome`)) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    const arg = activeBody.split(" ")[1]?.toLowerCase();
    if (arg === "on") { setWelcome(chatId, true); return reply(sock, msg, "👋 Welcome messages enabled."); }
    if (arg === "off") { setWelcome(chatId, false); return reply(sock, msg, "👋 Welcome messages disabled."); }
    return reply(sock, msg, `Usage: \`${PREFIX}welcome on\` or \`${PREFIX}welcome off\``);
  }

  if (isGroup && activeLower.startsWith(`${PREFIX}setleave`)) {
    if (!(await isSenderAdmin(sock, chatId, senderJid))) return reply(sock, msg, "❌ You need to be a group admin to use this.");
    const message = activeBody.split(" ").slice(1).join(" ");
    setLeaveMessage(chatId, message || null);
    return reply(sock, msg, "✅ Leave message set.");
  }

  // ── FUN / PARTY COMMANDS ─────────────────────────────────────
  if (activeLower === `${PREFIX}joke`) return reply(sock, msg, `😂 ${getJoke()}`);
  if (activeLower === `${PREFIX}truth`) return reply(sock, msg, `🤔 *Truth:* ${getTruth()}`);
  if (activeLower === `${PREFIX}dare`) return reply(sock, msg, `🔥 *Dare:* ${getDare()}`);
  if (activeLower === `${PREFIX}wyr`) return reply(sock, msg, `🤯 *Would you rather:* ${getWouldYouRather()}`);

  if (activeLower.startsWith(`${PREFIX}roast`)) {
    const target = getTargetJid(msg);
    const roastText = getRoast();
    if (target) return reply(sock, msg, `🔥 @${target.split("@")[0]}, ${roastText}`, { mentions: [target] });
    return reply(sock, msg, `🔥 ${roastText}`);
  }

  if (activeLower.startsWith(`${PREFIX}ship`)) {
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length >= 2) {
      const pct = getShipPercentage(mentioned[0], mentioned[1]);
      return reply(sock, msg, `💘 @${mentioned[0].split("@")[0]} + @${mentioned[1].split("@")[0]} = *${pct}%*\n${getShipEmoji(pct)}`, { mentions: mentioned });
    }
    return reply(sock, msg, `Tag two people: \`${PREFIX}ship @person1 @person2\``);
  }

  // ── SIMPLE GAMES ──────────────────────────────────────────────
  if (activeLower === `${PREFIX}dice`) return reply(sock, msg, `🎲 You rolled a *${rollDice()}*!`);
  if (activeLower === `${PREFIX}coinflip` || activeLower === `${PREFIX}cf`) return reply(sock, msg, `🪙 *${flipCoin()}*!`);

  if (isGroup && activeLower.startsWith(`${PREFIX}ttt`)) {
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (hasActiveGame(chatId)) return reply(sock, msg, "A game is already running in this chat. Finish it first or wait it out.");
    if (mentioned.length < 1) return reply(sock, msg, `Tag someone to challenge: \`${PREFIX}ttt @person\``);
    const board = startTicTacToe(chatId, senderJid, mentioned[0]);
    return reply(sock, msg, board, { mentions: [mentioned[0]] });
  }

  if (isGroup && hasActiveGame(chatId) && /^[1-9]$/.test(activeBody.trim())) {
    const result = playTicTacToe(chatId, senderJid, parseInt(activeBody.trim()));
    if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
    return reply(sock, msg, result.message);
  }

  // ── CARD ECONOMY GAME ────────────────────────────────────────
  if (activeLower === `${PREFIX}daily`) {
    const result = claimDaily(senderJid);
    return reply(sock, msg, result.success ? `✅ Claimed *${result.reward}* coins! Come back tomorrow.` : `❌ ${result.error}`);
  }

  if (activeLower === `${PREFIX}balance` || activeLower === `${PREFIX}bal`) {
    return reply(sock, msg, `💰 Your balance: *${getBalance(senderJid)}* coins`);
  }

  if (activeLower.startsWith(`${PREFIX}draw`) || activeLower.startsWith(`${PREFIX}gacha`)) {
    const result = drawCard(senderJid, 50);
    if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
    const c = result.card;
    return reply(sock, msg, `${c.emoji} You drew *${c.name}*! (${c.rarity}, ${c.element})`);
  }

  if (activeLower === `${PREFIX}inventory` || activeLower === `${PREFIX}inv` || activeLower === `${PREFIX}mycards`) {
    const inv = getInventory(senderJid);
    if (inv.length === 0) return reply(sock, msg, `Empty inventory. Use \`${PREFIX}draw\` to get cards!`);
    const text = inv.map((c) => `${c.emoji} *${c.name}* x${c.count} (${c.rarity})`).join("\n");
    return reply(sock, msg, `*🎴 Your Collection:*\n\n${text}`);
  }

  if (activeLower.startsWith(`${PREFIX}sellcard`)) {
    const cardId = activeBody.split(" ")[1]?.toLowerCase();
    if (!cardId) return reply(sock, msg, `Usage: \`${PREFIX}sellcard cardid\` (check \`${PREFIX}inventory\` for IDs)`);
    const result = sellCard(senderJid, cardId);
    if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
    return reply(sock, msg, `💰 Sold ${result.card.emoji} *${result.card.name}* for *${result.value}* coins.`);
  }

  if (activeLower === `${PREFIX}cardleaderboard` || activeLower === `${PREFIX}richlist`) {
    const lb = getLeaderboard(10);
    if (lb.length === 0) return reply(sock, msg, "No one's played yet.");
    const text = lb.map((u, i) => `${i + 1}. @${u.userId.split("@")[0]} — ${u.balance} coins`).join("\n");
    const mentions = lb.map((u) => u.userId);
    return reply(sock, msg, `*🏆 Richest Players:*\n\n${text}`, { mentions });
  }

  // ── CODE-TO-IMAGE (carbon) ───────────────────────────────────
  if (activeLower.startsWith(`${PREFIX}carbon`)) {
    const code = activeBody.split("\n").slice(1).join("\n") || activeBody.replace(/^\S+\s*/, "");
    if (!code) return reply(sock, msg, `Usage:\n\`${PREFIX}carbon\`\n\`\`\`\nyour code here\n\`\`\``);
    await react(sock, msg, "🎨");
    const result = await renderCodeImage(code);
    if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
    await sock.sendMessage(chatId, { image: result.buffer, caption: "📸 Code snippet" });
    return;
  }

  // ── LYRICS ────────────────────────────────────────────────────
  if (activeLower.startsWith(`${PREFIX}lyrics`)) {
    const query = activeBody.split(" ").slice(1).join(" ");
    if (!query) return reply(sock, msg, `Usage: \`${PREFIX}lyrics artist - song name\``);
    await react(sock, msg, "🎵");
    const result = await getLyrics(query);
    if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
    return reply(sock, msg, `🎵 *${result.title}*\n\n${result.lyrics.slice(0, 3500)}`);
  }

  // ── WALLPAPER SEARCH ──────────────────────────────────────────
  if (activeLower.startsWith(`${PREFIX}wallpaper`)) {
    const query = activeBody.split(" ").slice(1).join(" ");
    if (!query) return reply(sock, msg, `Usage: \`${PREFIX}wallpaper mountains\``);
    await react(sock, msg, "🖼️");
    const result = await searchWallpaper(query);
    if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
    await sock.sendMessage(chatId, { image: { url: result.url }, caption: `🖼️ ${query}` });
    return;
  }

  // ── OCR ───────────────────────────────────────────────────────
  if (hasMedia(msg) && (activeLower.includes("ocr") || activeLower.includes("extract text") || activeLower.includes("read the text"))) {
    const mediaData = await downloadMediaFromMsg(sock, msg);
    if (mediaData && mediaData.mimetype.startsWith("image/")) {
      await react(sock, msg, "🔠");
      const text = await extractText(mediaData.data, mediaData.mimetype);
      return reply(sock, msg, `📝 *Extracted text:*\n\n${text}`);
    }
  }

  // ── AUTO FILE LINK DETECTION ────────────────────────────────
  const fileLink = detectFileLink(activeBody);
  if (fileLink) {
    const wantsRead =
      INTENTS.scrape.some((k) => activeLower.includes(k)) ||
      activeLower.replace(fileLink, "").trim().length < 15 ||
      activeLower.includes("read") ||
      activeLower.includes("check") ||
      activeLower.includes("fix") ||
      activeLower.includes("review") ||
      activeLower.includes("analyze") ||
      activeLower.includes("what");

    if (wantsRead) {
      await react(sock, msg, "📎");
      const linkResult = await readFromLink(fileLink);
      if (linkResult.success) {
        const question = activeBody.replace(fileLink, "").trim() || "Analyze this file and tell me what it does.";
        const aiPrompt = `The user shared a file: *${linkResult.filename}*\n\nFile content:\n\`\`\`${linkResult.ext}\n${linkResult.content}\n\`\`\`\n\nUser's request: "${question}"\n\nRespond helpfully. If they want a fix or edit, return the full corrected file in a code block.`;
        const history = getMemory(chatId);
        const response = await getAIResponse(aiPrompt, senderName, history);
        saveMemory(chatId, [...history, { role: "user", content: activeBody }, { role: "assistant", content: response }]);
        await handleResponseWithFile(sock, msg, response, linkResult.filename);
        return;
      }
      return handleScrape(sock, msg, fileLink);
    }
  }

  // ── NATURAL LANGUAGE INTENTS ────────────────────────────────
  if (INTENTS.image.some((k) => activeLower.includes(k))) {
    const prompt = stripIntent(activeLower, activeBody, INTENTS.image);
    if (prompt.length > 3) return handleImageGen(sock, msg, prompt);
  }

  const urlMatch = activeBody.match(/https?:\/\/[^\s]+/);
  if (urlMatch && !fileLink) {
    const wantsScrape = INTENTS.scrape.some((k) => activeLower.includes(k)) || activeLower.replace(urlMatch[0], "").trim().length < 10;
    if (wantsScrape) return handleScrape(sock, msg, urlMatch[0]);
  }

  if (INTENTS.search.some((k) => activeLower.includes(k))) {
    const query = stripIntent(activeLower, activeBody, INTENTS.search);
    if (query.length > 2) return handleSearch(sock, msg, query);
  }

  if (INTENTS.remind.some((k) => activeLower.includes(k))) {
    return handleRemind(sock, msg, activeBody);
  }

  if (INTENTS.weather.some((k) => activeLower.includes(k))) {
    const city = stripIntent(activeLower, activeBody, INTENTS.weather);
    if (city.length > 1) return handleWeather(sock, msg, city);
  }

  if (INTENTS.news.some((k) => activeLower.includes(k))) {
    const topic = stripIntent(activeLower, activeBody, INTENTS.news);
    return handleNews(sock, msg, topic || "world");
  }

  if (INTENTS.translate.some((k) => activeLower.includes(k))) {
    // "translate hello to french" / "how do you say hello in french"
    const toMatch = activeBody.match(/(?:to|in)\s+(\w+)\s*$/i);
    const targetLang = toMatch ? toMatch[1] : "en";
    const textToTranslate = activeBody.replace(/translate|how do you say|say this in/gi, "").replace(toMatch?.[0] || "", "").trim();
    if (textToTranslate.length > 0) return handleTranslate(sock, msg, textToTranslate, targetLang);
  }

  if (INTENTS.voiceReply.some((k) => activeLower.includes(k))) {
    const textToSpeak = stripIntent(activeLower, activeBody, INTENTS.voiceReply);
    if (textToSpeak.length > 1) return handleTTS(sock, msg, textToSpeak);
  }

  // Broader pattern alongside the phrase list above — catches phrasing like
  // "create a node api" or "develop a discord bot" that the fixed phrases miss
  const BUILD_INTENT_REGEX = /(build|create|make|develop|generate)\s+(me\s+|an?\s+)?.*(app|website|site|api|bot|game|calculator|dashboard|project|script)/i;

  if (INTENTS.build.some((k) => activeLower.includes(k)) || BUILD_INTENT_REGEX.test(activeBody)) {
    return handleBuild(sock, msg, activeBody);
  }

  if (INTENTS.agent.some((k) => activeLower.includes(k))) {
    await react(sock, msg, "🧩");
    const result = await runAgentTask(activeBody, senderName);
    return handleResponseWithFile(sock, msg, result);
  }

  if (INTENTS.help.some((k) => activeLower === k)) {
    return reply(sock, msg, getHelpMenu(senderJid));
  }

  if (INTENTS.clear.some((k) => activeLower.includes(k))) {
    saveMemory(chatId, []);
    return reply(sock, msg, "🧹 Memory cleared. Fresh start!");
  }

  // ── DEFAULT: AI CHAT ─────────────────────────────────────────
  if (activeBody.length > 0) {
    await react(sock, msg, "🧠");
    const history = getMemory(chatId);
    const ownerContext = isOwner(senderJid)
      ? "\n\nThe person you're talking to right now is Daniel, your creator who built and maintains you. You can acknowledge this naturally if it's relevant, without being weird or robotic about it."
      : "";
    const response = await getAIResponse(activeBody, senderName, history, null, ownerContext);
    saveMemory(chatId, [...history, { role: "user", content: activeBody }, { role: "assistant", content: response }]);
    await handleResponseWithFile(sock, msg, response);
  }
}

async function handleResponseWithFile(sock, msg, response, hintFilename = null) {
  await reply(sock, msg, response);
  const codeBlock = extractCodeBlock(response);
  if (codeBlock && codeBlock.code.split("\n").length >= 10) {
    let filename = hintFilename ? hintFilename.replace(/\.[^.]+$/, `.${codeBlock.ext}`) : `code.${codeBlock.ext}`;
    await sendFile(sock, msg.key.remoteJid, filename, codeBlock.code, `📎 *${filename}* — tap to open`);
  }
}

async function handleImageGen(sock, msg, prompt) {
  if (!prompt || prompt.length < 2) return reply(sock, msg, `Give me a prompt. Example: _${BOT_NAME} imagine a dark futuristic city_`);
  await react(sock, msg, "🎨");
  const result = await generateImage(prompt);
  if (result.success) {
    await sock.sendMessage(msg.key.remoteJid, { image: { url: result.url }, caption: `🎨 *${prompt}*` });
  } else {
    await reply(sock, msg, `❌ Image gen failed: ${result.error}`);
  }
}

async function handleSearch(sock, msg, query) {
  if (!query || query.length < 2) return reply(sock, msg, `What should I search?`);
  await react(sock, msg, "🔍");
  await reply(sock, msg, await searchWeb(query));
}

async function handleDownload(sock, msg, url) {
  if (!url) return reply(sock, msg, `Give me a URL to download.`);
  await react(sock, msg, "📥");
  const result = await downloadMedia(url, msg.key.remoteJid, sock);
  if (!result.success) await reply(sock, msg, `❌ Download failed: ${result.error}`);
}

async function handleCode(sock, msg, code, lang) {
  if (!code) return reply(sock, msg, "Send code like:\n`!run js`\n`console.log('hello')`");
  await react(sock, msg, "⚙️");
  const result = await runCode(code, lang);
  await reply(sock, msg, `\`\`\`\n${result}\n\`\`\``);
}

async function handleBuild(sock, msg, request) {
  if (!request || request.length < 3) {
    return reply(sock, msg, `Tell me what to build. Example: \`${PREFIX}build a todo app in html css js\`\n\nKeep it realistic — small apps, landing pages, simple games, calculators, APIs. Not full AAA games 😅`);
  }

  const chatId = msg.key.remoteJid;
  await react(sock, msg, "🏗️");
  await reply(sock, msg, `🏗️ Building: *${request}*\nThis can take a minute or two for bigger requests...`);

  const onProgress = async (text) => {
    try {
      await sock.sendMessage(chatId, { text });
    } catch (err) {
      console.error("Build progress message failed:", err.message);
    }
  };

  try {
    const result = await buildProject(request, getSenderName(msg), chatId, onProgress);
    return handleBuildResult(sock, msg, result);
  } catch (err) {
    console.error("Build error:", err.message);
    return reply(sock, msg, `❌ Something went wrong during the build: ${err.message}`);
  }
}

async function handleContinue(sock, msg, projectId) {
  const chatId = msg.key.remoteJid;
  await react(sock, msg, "▶️");

  const onProgress = async (text) => {
    try {
      await sock.sendMessage(chatId, { text });
    } catch (err) {
      console.error("Continue progress message failed:", err.message);
    }
  };

  try {
    const result = await continueProject(chatId, getSenderName(msg), onProgress, projectId);
    return handleBuildResult(sock, msg, result);
  } catch (err) {
    console.error("Continue error:", err.message);
    return reply(sock, msg, `❌ Something went wrong continuing the build: ${err.message}`);
  }
}

// Shared result handler for both fresh builds and continues — paused/done/failed all look the same either way
async function handleBuildResult(sock, msg, result) {
  if (!result.success) {
    return reply(sock, msg, `❌ Build failed: ${result.error}`);
  }
  if (result.paused) {
    return reply(sock, msg, result.message);
  }

  const fileList = result.files.map((f) => `• ${f}`).join("\n");
  const warningNote = result.warnings && result.warnings.length > 0
    ? `\n\n⚠️ These files had issues even after an auto-fix attempt, double check them: ${result.warnings.join(", ")}`
    : "";
  const buildWarningNote = result.buildWarning ? `\n\n🔨 *Build verification:* ${result.buildWarning}` : "";

  return reply(
    sock,
    msg,
    `✅ *Built successfully!* (${result.fileCount} files)\n\n${fileList}\n\n📦 Download:\n${result.downloadUrl}${warningNote}${buildWarningNote}`
  );
}

async function handleProjectStatus(sock, msg, projectId) {
  const chatId = msg.key.remoteJid;
  const statusResult = getProjectStatus(chatId, projectId);
  if (!statusResult) return reply(sock, msg, "No project found. Start one with `!build [description]`.");

  const { project, progress } = statusResult;
  return reply(
    sock,
    msg,
    `*📊 Project Status*\nID: \`${project.id}\`\nGoal: ${project.goal}\nStatus: ${project.status}\nProgress: ${progress.done}/${progress.total} files (${progress.percent}%)`
  );
}

async function handleProjectList(sock, msg) {
  const chatId = msg.key.remoteJid;
  const projects = listProjects(chatId);
  if (projects.length === 0) return reply(sock, msg, "No projects yet. Start one with `!build [description]`.");

  const text = projects
    .slice(0, 10)
    .map((p) => `\`${p.id}\` — ${p.goal} (${p.status}, ${p.progress.percent}%)`)
    .join("\n");
  return reply(sock, msg, `*📁 Your Projects:*\n\n${text}`);
}

async function handleProjectCancel(sock, msg, projectId) {
  const chatId = msg.key.remoteJid;
  const cancelled = cancelProject(chatId, projectId);
  return reply(sock, msg, cancelled ? "🛑 Project cancelled." : "❌ No active project found to cancel.");
}

async function handleScrape(sock, msg, url) {
  if (!url) return reply(sock, msg, `Give me a URL.`);
  await react(sock, msg, "🕷️");
  await reply(sock, msg, await scrapeUrl(url));
}

async function handleRemind(sock, msg, text) {
  if (!text) return reply(sock, msg, `Example: _remind me in 10m to call dad_`);
  await react(sock, msg, "⏰");
  await reply(sock, msg, await setReminder(sock, msg.key.remoteJid, text));
}

async function handleWeather(sock, msg, city) {
  if (!city) return reply(sock, msg, `Which city? Example: _weather in Douala_`);
  await react(sock, msg, "🌤️");
  const result = await getWeather(city);
  if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
  const desc = weatherCodeToDescription(result.weatherCode);
  await reply(
    sock,
    msg,
    `*🌤️ Weather in ${result.location}*\n\n${desc}\n🌡️ ${result.temp}°C\n💧 Humidity: ${result.humidity}%\n💨 Wind: ${result.windSpeed} km/h`
  );
}

async function handleTranslate(sock, msg, text, targetLang) {
  if (!text) return reply(sock, msg, `What should I translate? Example: _translate hello to french_`);
  await react(sock, msg, "🌐");
  const result = await translateText(text, targetLang || "en");
  if (!result.success) return reply(sock, msg, `❌ Translation failed: ${result.error}`);
  await reply(sock, msg, `🌐 *Translation:*\n${result.translated}`);
}

async function handleNews(sock, msg, topic) {
  await react(sock, msg, "📰");
  const result = await getNewsDigest(topic);
  if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
  const text = result.items.map((item, i) => `*${i + 1}.* ${item.title}\n🔗 ${item.link}`).join("\n\n");
  await reply(sock, msg, `*📰 News: ${topic}*\n\n${text}`);
}

async function handleConvert(sock, msg, text) {
  // Try currency first: "100 USD to EUR"
  const currencyMatch = text.match(/^([\d.]+)\s*([a-zA-Z]{3})\s*(to|in)\s*([a-zA-Z]{3})$/i);
  if (currencyMatch) {
    await react(sock, msg, "💱");
    const result = await convertCurrency(parseFloat(currencyMatch[1]), currencyMatch[2], currencyMatch[4]);
    if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
    return reply(sock, msg, `💱 ${currencyMatch[1]} ${currencyMatch[2].toUpperCase()} = *${result.result} ${currencyMatch[4].toUpperCase()}*`);
  }

  // Try unit conversion: "10 km to mi"
  const unitMatch = text.match(/^([\d.]+)\s*(\w+)\s*(to|in)\s*(\w+)$/i);
  if (unitMatch) {
    await react(sock, msg, "📐");
    const result = convertUnit(parseFloat(unitMatch[1]), unitMatch[2], unitMatch[4]);
    if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
    return reply(sock, msg, `📐 ${unitMatch[1]} ${unitMatch[2]} = *${result.result} ${unitMatch[4]}*`);
  }

  return reply(sock, msg, `Format: _!convert 100 usd to eur_ or _!convert 10 km to mi_`);
}

async function handleTTS(sock, msg, text) {
  if (!text) return reply(sock, msg, `What should I say? Example: _say this: hello world_`);
  await react(sock, msg, "🔊");
  const result = await textToSpeech(text);
  if (!result.success) return reply(sock, msg, `❌ Voice generation failed: ${result.error}`);
  await sock.sendMessage(msg.key.remoteJid, { audio: result.buffer, mimetype: "audio/mpeg", ptt: true });
}

async function handlePoll(sock, msg, text) {
  // Format: "Question? | Option1 | Option2 | Option3"
  const parts = text.split("|").map((p) => p.trim());
  if (parts.length < 3) {
    return reply(sock, msg, `Format: _!poll Question? | Option 1 | Option 2 | Option 3_`);
  }
  const question = parts[0];
  const options = parts.slice(1).slice(0, 12); // WhatsApp poll max 12 options

  try {
    await sock.sendMessage(msg.key.remoteJid, {
      poll: { name: question, values: options, selectableCount: 1 },
    });
  } catch (err) {
    console.error("Poll creation error:", err.message);
    await reply(sock, msg, `❌ Couldn't create poll: ${err.message}`);
  }
}

// Actually pings each service rather than just checking if a key exists in .env —
// a configured-but-wrong key, or a service that's down, should show as unhealthy too.
async function runHealthCheck() {
  const results = [];

  // Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      await axios.post(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        { model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
        { headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}` }, timeout: 8000 }
      );
      results.push({ name: "Gemini", ok: true });
    } catch (err) {
      results.push({ name: "Gemini", ok: false, detail: err.response?.status || err.message });
    }
  } else {
    results.push({ name: "Gemini", ok: false, detail: "no key set" });
  }

  // Groq
  if (process.env.GROQ_API_KEY) {
    try {
      const Groq = require("groq-sdk");
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      await groq.chat.completions.create({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: "hi" }], max_tokens: 5 });
      results.push({ name: "Groq", ok: true });
    } catch (err) {
      results.push({ name: "Groq", ok: false, detail: err.message });
    }
  } else {
    results.push({ name: "Groq", ok: false, detail: "no key set" });
  }

  // Gofile (used for file uploads)
  try {
    await axios.get("https://api.gofile.io/servers", { timeout: 8000 });
    results.push({ name: "Gofile", ok: true });
  } catch (err) {
    results.push({ name: "Gofile", ok: false, detail: err.message });
  }

  // Memory/disk
  try {
    const fs = require("fs");
    const path = require("path");
    const testFile = path.join(__dirname, "../../data/.healthcheck");
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    results.push({ name: "Disk storage", ok: true });
  } catch (err) {
    results.push({ name: "Disk storage", ok: false, detail: err.message });
  }

  return results;
}

function stripIntent(lower, original, keywords) {
  for (const k of keywords) {
    const idx = lower.indexOf(k);
    if (idx !== -1) return original.slice(idx + k.length).trim();
  }
  return original;
}

function getHelpMenu(senderJid = null) {
  const n = BOT_NAME.charAt(0).toUpperCase() + BOT_NAME.slice(1);
  let menu = `*🤖 ${n} — AI Assistant*

*Just talk to me naturally or use commands:*

🎨 _imagine [prompt]_ — Generate image
🔍 _search [query]_ — Search the web
📥 _download [url]_ — Download video/audio
🕷️ _read [url]_ — Read any website
⏰ _remind me in 10m [msg]_ — One-time reminder
🔁 \`!every day at 8am [msg]\` — Recurring reminder
🌤️ _weather in [city]_ — Weather lookup
🌐 _translate [text] to [lang]_ — Translate
📰 _news about [topic]_ — News digest
💱 \`!convert 100 usd to eur\` — Currency/unit convert
🎭 Send image + "make this a sticker" — Sticker
🎤 Send a voice note — Auto-transcribed + answered
🔊 _say this: [text]_ — Voice note reply
📊 \`!poll Question? | Opt1 | Opt2\` — Create a poll
🧩 _figure out / research and..._ — Multi-step agent
🏗️ \`!build [app description]\` — Generate a real small project, zipped & uploaded
📎 _share a file link_ — I'll read & analyze it
📄 _send any file_ — I'll analyze it
💻 _ask me to write code_ — I'll send it as a file too

*Other commands:*
\`!run js\` / \`!run py\` — Run code
\`!reminders\` — List active recurring reminders
\`!cancelreminder [id]\` — Cancel one
\`!clear\` — Reset memory
\`!whoami\` — Check your permission level
\`!chat\` — Talk freely without saying my name each time (30 min, \`!exit\` to stop)
\`!model\` — Show which AI provider is active
\`!health\` — Check if Gemini/Groq/Gofile/storage are actually working

*🎮 Games & Fun:*
\`!joke\` / \`!truth\` / \`!dare\` / \`!wyr\` — Party games
\`!roast [@tag]\` — Roast someone (or yourself)
\`!ship @p1 @p2\` — Compatibility %
\`!dice\` / \`!coinflip\` — Quick rolls
\`!ttt @person\` — Challenge to Tic-Tac-Toe (reply 1-9 to play)

*🎴 Card Economy:*
\`!daily\` — Claim daily coins
\`!balance\` — Check your coins
\`!draw\` — Draw a random card (50 coins)
\`!inventory\` — View your collection
\`!sellcard [id]\` — Sell a card
\`!richlist\` — Leaderboard

*🛠️ Extra tools:*
\`!carbon\` + code block — Code as a styled image
\`!lyrics artist - song\` — Get song lyrics
\`!wallpaper [topic]\` — Find a wallpaper
Send image + "ocr" — Extract text from image`;

  if (senderJid && isAdmin(senderJid)) {
    menu += `\n\n*🛡️ Admin commands:*
\`!stats\` — Bot stats (uptime, memory, RAM)
\`!broadcast [msg]\` — Message every chat
\`!debug\` — Recent errors
\`!ban [number]\` / \`!unban [number]\`
\`!mute\` / \`!unmute\` — Silence this chat
\`!admins\` — List current admins

*👥 Group admin (need to be group admin):*
\`!kick\` / \`!promote\` / \`!demote\` — tag or reply to target
\`!tagall [msg]\` / \`!hidetag [msg]\` — Mention everyone
\`!warn\` / \`!resetwarn\` — tag or reply to target
\`!antilink on/off\` — Auto-moderate links
\`!welcome on/off\` / \`!setwelcome [msg]\` — Greet new members
\`!setleave [msg]\` — Set leave message`;
  }

  if (senderJid && isOwner(senderJid)) {
    menu += `\n\n*👑 Owner-only:*
\`!addadmin [number]\` / \`!removeadmin [number]\``;
  }

  menu += `\n\n_In groups: call me by name first_
_In DMs: just talk to me_`;

  return menu;
}

module.exports = { handleMessage };
