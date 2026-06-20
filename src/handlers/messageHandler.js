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
const { getMemory, saveMemory } = require("../utils/memory");
const { isOwner, isAdmin, addAdmin, removeAdmin, listAdmins, banUser, unbanUser, isBanned, muteChat, unmuteChat, isMuted } = require("../utils/permissions");
const { getStats, getRecentErrors, logError, broadcastToAll } = require("../tools/botAdmin");

const BOT_NAME = (process.env.BOT_NAME || "aria").toLowerCase();
const PREFIX = process.env.BOT_PREFIX || "!";

const NAME_TRIGGERS = [BOT_NAME, BOT_NAME + ",", BOT_NAME + "!", "hey " + BOT_NAME, "ok " + BOT_NAME, "yo " + BOT_NAME];

const INTENTS = {
  image: ["generate", "create an image", "make an image", "draw", "imagine", "paint", "design an image", "give me an image", "show me a picture"],
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

async function reply(sock, msg, text) {
  if (!text) return;
  const chatId = msg.key.remoteJid;
  try {
    if (text.length <= 4000) {
      await sock.sendMessage(chatId, { text }, { quoted: msg });
      return;
    }
    // Split long messages
    const chunks = splitMessage(text, 3900);
    for (const chunk of chunks) {
      await sock.sendMessage(chatId, { text: chunk });
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
// ARIA itself sent. The quoted message's sender is the bot's own JID when fromMe was true.
function isQuotingBotMessage(msg, sock) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo;

  if (!contextInfo?.quotedMessage) return false;

  // participant field on the quoted message is the JID of whoever sent the original.
  // If it's missing entirely but stanzaId/participant point back to the bot's own number, treat as a reply to the bot.
  const quotedParticipant = contextInfo.participant;
  const botJid = sock?.user?.id?.split(":")[0];

  if (!quotedParticipant || !botJid) return false;
  return quotedParticipant.split(":")[0].split("@")[0] === botJid.split("@")[0];
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

  console.log(`[${senderName}${isGroup ? " (grp)" : ""}] ${body.slice(0, 80)}`);

  let activeBody = body;

  if (isGroup) {
    const namedTrigger = NAME_TRIGGERS.find((t) => lower.startsWith(t));
    const prefixTrigger = lower.startsWith(PREFIX);
    // Replying directly to one of ARIA's messages counts as addressing it,
    // same as saying its name — no prefix or name needed in that case.
    if (!namedTrigger && !prefixTrigger && !isReplyToBot && !hasMedia(msg)) return;
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

  const activeLower = activeBody.toLowerCase();

  // Muted chats — owner/admin commands still work, everything else is silenced
  if (isMuted(chatId) && !isAdmin(senderJid)) return;

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
  await sock.sendMessage(msg.key.remoteJid, { audio: result.buffer, mimetype: "audio/mp4", ptt: true });
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
📎 _share a file link_ — I'll read & analyze it
📄 _send any file_ — I'll analyze it
💻 _ask me to write code_ — I'll send it as a file too

*Other commands:*
\`!run js\` / \`!run py\` — Run code
\`!reminders\` — List active recurring reminders
\`!cancelreminder [id]\` — Cancel one
\`!clear\` — Reset memory
\`!whoami\` — Check your permission level`;

  if (senderJid && isAdmin(senderJid)) {
    menu += `\n\n*🛡️ Admin commands:*
\`!stats\` — Bot stats (uptime, memory, RAM)
\`!broadcast [msg]\` — Message every chat
\`!debug\` — Recent errors
\`!ban [number]\` / \`!unban [number]\`
\`!mute\` / \`!unmute\` — Silence this chat
\`!admins\` — List current admins`;
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
