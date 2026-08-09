// Command Router + Intent Parser for ARIA WhatsApp Bot
// Extracted from the monolithic messageHandler.js to make adding features
// a matter of registering a command, not touching a 1600-line file.

// ── Imports ──────────────────────────────────────────────────
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
const { searchAnime, getAnimeEpisodes, getAnimeDetails, getOmniSaveDownload, downloadVideo } = require("../tools/animeDownload");
const { checkMessage, parseModArgs } = require("../tools/autoMod");
const { trackInteraction, getUserContext } = require("../utils/userMemory");
const { addPreference, getPreferences, clearPreferences } = require("../utils/userPreferences");
const { learnFact, getFacts, forgetFact, getFactsContext } = require("../utils/learnedFacts");
const { getMemory, saveMemory } = require("../utils/memory");
const { isOwner, isAdmin, addAdmin, removeAdmin, listAdmins, banUser, unbanUser, isBanned, muteChat, unmuteChat, isMuted } = require("../utils/permissions");
const { findPluginCommand } = require("../utils/pluginLoader");
const { createTask, getTasksForChat, deactivateTaskForChat } = require("../utils/backgroundTasks");
const { getCryptoPrice, parseCondition } = require("../tools/priceWatcher");
const { startSession, endSession, isSessionActive, touchSession } = require("../utils/chatSessions");
const { setRecurringReminder, cancelRecurringReminder, listRecurringReminders } = require("../tools/recurringReminders");
const { investigate } = require("../tools/investigate");
const { runSelfCheck, getPendingFix, clearPendingFix } = require("../tools/selfCheck");
const { runEvolveCheck } = require("../tools/selfAwareness");
const { runAgentTask } = require("../tools/agent");
const { debugCode } = require("../tools/debugTool");
const { runEvolveCheck: selfAwarenessCheck } = require("../tools/selfAwareness");
const { createSticker } = require("../tools/sticker");
const { translateText, convertCurrency, convertUnit, getWeather, weatherCodeToDescription } = require("../tools/utilities");
const { getNewsDigest } = require("../tools/news");
const { transcribeVoice, textToSpeech } = require("../tools/voice");
const { readFromLink, detectFileLink } = require("../tools/linkReader");
const { sendFile, extractAllCodeBlocks } = require("../tools/fileSender");
const { createBackup } = require("../tools/backupSystem");
const { runSelfCheck: selfCheck } = require("../tools/selfCheck");
const { getAIResponse, needsLargeOutput } = require("../tools/ai");
const { setReminder } = require("../tools/reminders");
const { buildProject, continueProject, getProjectStatus, listProjects, cancelProject, thinkAboutProject, editProjectFile } = require("../tools/appBuilder");

const BOT_NAME = (process.env.BOT_NAME || "aria").toLowerCase();
const PREFIX = process.env.BOT_PREFIX || "!";

const NAME_TRIGGERS = [
  BOT_NAME, BOT_NAME + ",", BOT_NAME + "!",
  "hey " + BOT_NAME, "ok " + BOT_NAME, "yo " + BOT_NAME,
];

// ── Intent patterns ──────────────────────────────────────────
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

// ── Command registry ─────────────────────────────────────────
// Each entry: { name, aliases, category, handler, ownerOnly, description }
const commands = [];

function registerCommand(cmd) {
  commands.push(cmd);
}

// Built-in commands - these are the standard prefix commands
function registerBuiltinCommands() {
  // Admin / Meta
  registerCommand({ name: "alive", aliases: ["ping", "test"], category: "meta", description: "Check if bot is alive", handler: handleAlive, ownerOnly: false });
  registerCommand({ name: "help", aliases: ["menu", "commands", "h"], category: "meta", description: "Show help menu", handler: handleHelp, ownerOnly: false });
  registerCommand({ name: "stats", aliases: ["botstats", "status"], category: "admin", description: "Show bot statistics", handler: handleStats, ownerOnly: true });
  registerCommand({ name: "errors", aliases: ["errorlog", "debug"], category: "admin", description: "Show recent errors", handler: handleErrors, ownerOnly: true });
  registerCommand({ name: "broadcast", aliases: ["bc", "announce"], category: "admin", description: "Broadcast message to all chats", handler: handleBroadcast, ownerOnly: true });
  registerCommand({ name: "admin", aliases: ["setadmin"], category: "admin", description: "Add/remove bot admin", handler: handleAdmin, ownerOnly: true });
  registerCommand({ name: "ban", aliases: [], category: "admin", description: "Ban a user", handler: handleBan, ownerOnly: true });
  registerCommand({ name: "unban", aliases: [], category: "admin", description: "Unban a user", handler: handleUnban, ownerOnly: true });

  // Group admin
  registerCommand({ name: "kick", aliases: ["remove"], category: "group", description: "Kick a member", handler: handleKick, ownerOnly: false });
  registerCommand({ name: "promote", aliases: ["prom"], category: "group", description: "Promote a member to admin", handler: handlePromote, ownerOnly: false });
  registerCommand({ name: "demote", aliases: ["dem"], category: "group", description: "Demote an admin", handler: handleDemote, ownerOnly: false });
  registerCommand({ name: "tagall", aliases: ["everyone", "all"], category: "group", description: "Tag all group members", handler: handleTagAll, ownerOnly: false });
  registerCommand({ name: "hidetag", aliases: ["ht"], category: "group", description: "Tag all silently", handler: handleHideTag, ownerOnly: false });
  registerCommand({ name: "antilink", aliases: [], category: "group", description: "Toggle anti-link detection", handler: handleAntilink, ownerOnly: false });
  registerCommand({ name: "welcome", aliases: [], category: "group", description: "Toggle welcome messages", handler: handleWelcome, ownerOnly: false });
  registerCommand({ name: "setwelcome", aliases: ["welcomemsg"], category: "group", description: "Set welcome message", handler: handleSetWelcome, ownerOnly: false });
  registerCommand({ name: "setleave", aliases: ["leavemsg"], category: "group", description: "Set leave message", handler: handleSetLeave, ownerOnly: false });
  registerCommand({ name: "warn", aliases: ["warning"], category: "group", description: "Warn a member", handler: handleWarn, ownerOnly: false });
  registerCommand({ name: "warnings", aliases: ["warns"], category: "group", description: "View warnings", handler: handleWarnings, ownerOnly: false });
  registerCommand({ name: "resetwarns", aliases: ["clearwarns"], category: "group", description: "Reset warnings", handler: handleResetWarns, ownerOnly: false });

  // Media / Creative
  registerCommand({ name: "imagine", aliases: ["img", "draw"], category: "creative", description: "Generate an image with AI", handler: handleImageGen, ownerOnly: false });
  registerCommand({ name: "sticker", aliases: ["sticker"], category: "creative", description: "Make a sticker from image", handler: handleStickerCommand, ownerOnly: false });
  registerCommand({ name: "sticker", aliases: ["s"], category: "creative", description: "Sticker shortcut", handler: handleStickerCommand, ownerOnly: false });
  registerCommand({ name: "carbon", aliases: ["codeimg"], category: "creative", description: "Render code as image", handler: handleCarbon, ownerOnly: false });
  registerCommand({ name: "wallpaper", aliases: ["wall", "wp"], category: "creative", description: "Search wallpapers", handler: handleWallpaper, ownerOnly: false });

  // Utility
  registerCommand({ name: "search", aliases: ["web", "google"], category: "utility", description: "Search the web", handler: handleSearch, ownerOnly: false });
  registerCommand({ name: "download", aliases: ["dl"], category: "utility", description: "Download media from URL", handler: handleDownload, ownerOnly: true });
  registerCommand({ name: "run", aliases: ["exec", "code"], category: "utility", description: "Execute code", handler: handleCode, ownerOnly: true });
  registerCommand({ name: "weather", aliases: [], category: "utility", description: "Get weather", handler: handleWeather, ownerOnly: false });
  registerCommand({ name: "translate", aliases: ["tr"], category: "utility", description: "Translate text", handler: handleTranslate, ownerOnly: false });
  registerCommand({ name: "news", aliases: [], category: "utility", description: "Get news summary", handler: handleNews, ownerOnly: false });
  registerCommand({ name: "convert", aliases: ["conv"], category: "utility", description: "Convert currency/units", handler: handleConvert, ownerOnly: false });
  registerCommand({ name: "lyrics", aliases: ["lyric"], category: "utility", description: "Search song lyrics", handler: handleLyrics, ownerOnly: false });
  registerCommand({ name: "say", aliases: ["tts", "speak"], category: "utility", description: "Text-to-speech", handler: handleTTS, ownerOnly: false });
  registerCommand({ name: "poll", aliases: [], category: "utility", description: "Create a poll", handler: handlePoll, ownerOnly: false });
  registerCommand({ name: "remind", aliases: ["reminder", "alert"], category: "utility", description: "Set a reminder", handler: handleRemind, ownerOnly: false });
  registerCommand({ name: "recurring", aliases: ["cron", "schedule"], category: "utility", description: "Set recurring reminder", handler: handleRecurring, ownerOnly: false });
  registerCommand({ name: "crypto", aliases: ["price"], category: "utility", description: "Check crypto price", handler: handleCrypto, ownerOnly: false });
  registerCommand({ name: "backup", aliases: [], category: "utility", description: "Create bot backup", handler: handleBackup, ownerOnly: true });

  // Fun / Games
  registerCommand({ name: "mood", aliases: ["vibe", "ariavibe"], category: "fun", description: "Check ARIA current mood", handler: handleMood, ownerOnly: false });
  registerCommand({ name: "joke", aliases: [], category: "fun", description: "Tell a joke", handler: handleJoke, ownerOnly: false });
  registerCommand({ name: "truth", aliases: [], category: "fun", description: "Truth or dare - truth", handler: handleTruth, ownerOnly: false });
  registerCommand({ name: "dare", aliases: [], category: "fun", description: "Truth or dare - dare", handler: handleDare, ownerOnly: false });
  registerCommand({ name: "wyr", aliases: ["wouldyourather"], category: "fun", description: "Would you rather", handler: handleWYR, ownerOnly: false });
  registerCommand({ name: "roast", aliases: ["burn"], category: "fun", description: "Roast someone", handler: handleRoast, ownerOnly: false });
  registerCommand({ name: "ship", aliases: [], category: "fun", description: "Ship two people", handler: handleShip, ownerOnly: false });
  registerCommand({ name: "ttt", aliases: ["tictactoe"], category: "fun", description: "Play tic-tac-toe", handler: handleTTT, ownerOnly: false });
  registerCommand({ name: "dice", aliases: ["roll"], category: "fun", description: "Roll dice", handler: handleDice, ownerOnly: false });
  registerCommand({ name: "flip", aliases: ["coin"], category: "fun", description: "Flip a coin", handler: handleFlip, ownerOnly: false });
  registerCommand({ name: "card", aliases: ["drawcard"], category: "fun", description: "Draw a card", handler: handleCard, ownerOnly: false });
  registerCommand({ name: "balance", aliases: ["bal", "coins"], category: "fun", description: "Check card balance", handler: handleBalance, ownerOnly: false });
  registerCommand({ name: "daily", aliases: [], category: "fun", description: "Claim daily reward", handler: handleDaily, ownerOnly: false });
  registerCommand({ name: "inventory", aliases: ["inv", "cards"], category: "fun", description: "View card inventory", handler: handleInventory, ownerOnly: false });
  registerCommand({ name: "sell", aliases: [], category: "fun", description: "Sell a card", handler: handleSell, ownerOnly: false });
  registerCommand({ name: "leaderboard", aliases: ["lb", "top"], category: "fun", description: "View card leaderboard", handler: handleLeaderboard, ownerOnly: false });

  // Pokémon Spawn
  registerCommand({ name: "pspawn", aliases: ["spawnrate", "spawns"], category: "admin", description: "Configure global wild spawn rate", handler: handlePSpawn, ownerOnly: true });

  // Anime
  registerCommand({ name: "anime", aliases: ["animesearch"], category: "anime", description: "Search anime", handler: handleAnimeSearch, ownerOnly: false });
  registerCommand({ name: "animeinfo", aliases: ["ainfo"], category: "anime", description: "Get anime details", handler: handleAnimeInfo, ownerOnly: false });
  registerCommand({ name: "episodes", aliases: ["eps", "animeeps"], category: "anime", description: "Get anime episodes", handler: handleAnimeEps, ownerOnly: false });
  registerCommand({ name: "animeplay", aliases: ["astream", "watch"], category: "anime", description: "Stream anime episode", handler: handleAnimePlay, ownerOnly: false });
  registerCommand({ name: "trending", aliases: ["trendinganime"], category: "anime", description: "Trending anime", handler: handleTrending, ownerOnly: false });
  registerCommand({ name: "airing", aliases: ["airinganime"], category: "anime", description: "Airing anime", handler: handleAiring, ownerOnly: false });

  // Dev / Advanced
  registerCommand({ name: "build", aliases: ["agent"], category: "dev", description: "AI app builder", handler: handleBuild, ownerOnly: true });
  registerCommand({ name: "continue", aliases: ["resume"], category: "dev", description: "Continue a project", handler: handleContinue, ownerOnly: true });
  registerCommand({ name: "status", aliases: ["project"], category: "dev", description: "Project status", handler: handleProjectStatus, ownerOnly: false });
  registerCommand({ name: "projects", aliases: ["mylist"], category: "dev", description: "List projects", handler: handleProjectList, ownerOnly: false });
  registerCommand({ name: "cancelbuild", aliases: ["cancel"], category: "dev", description: "Cancel a project", handler: handleProjectCancel, ownerOnly: true });
  registerCommand({ name: "edit", aliases: [], category: "dev", description: "Edit a project file", handler: handleEditFile, ownerOnly: true });
  registerCommand({ name: "think", aliases: [], category: "dev", description: "Think about a project", handler: handleThink, ownerOnly: true });
  registerCommand({ name: "fix", aliases: ["debug"], category: "dev", description: "Debug code", handler: handleDebugCode, ownerOnly: true });
  registerCommand({ name: "remember", aliases: [], category: "dev", description: "Remember a preference", handler: handleRemember, ownerOnly: false });
  registerCommand({ name: "preferences", aliases: ["myprefs"], category: "dev", description: "View preferences", handler: handlePreferences, ownerOnly: false });
  registerCommand({ name: "clearprefs", aliases: ["resetprefs"], category: "dev", description: "Clear preferences", handler: handleClearPrefs, ownerOnly: false });
  registerCommand({ name: "voicemode", aliases: ["voice", "vm"], category: "dev", description: "Toggle voice replies", handler: handleVoiceMode, ownerOnly: false });
  registerCommand({ name: "memories", aliases: ["remembered", "mymemory"], category: "dev", description: "See what I remember about you", handler: handleMemories, ownerOnly: false });
  registerCommand({ name: "mission", aliases: ["missions", "msn"], category: "dev", description: "Create/resume durable background missions", handler: handleMission, ownerOnly: true });
  registerCommand({ name: "world", aliases: ["worldmodel", "model"], category: "dev", description: "View ARIA's world model", handler: handleWorld, ownerOnly: true });
  registerCommand({ name: "delegate", aliases: ["orbit", "orchestrate"], category: "dev", description: "Run the agent-team mission orchestrator", handler: handleDelegate, ownerOnly: true });
  registerCommand({ name: "grant", aliases: [], category: "admin", description: "Grant a capability to a user", handler: handleGrant, ownerOnly: true });
  registerCommand({ name: "revoke", aliases: [], category: "admin", description: "Revoke a capability", handler: handleRevoke, ownerOnly: true });
  registerCommand({ name: "caps", aliases: ["permissions"], category: "admin", description: "View granted capabilities", handler: handleCaps, ownerOnly: true });
  registerCommand({ name: "learn", aliases: ["teach"], category: "dev", description: "Teach a fact", handler: handleLearn, ownerOnly: false });
  registerCommand({ name: "facts", aliases: ["memory", "whatiknow"], category: "dev", description: "View learned facts", handler: handleFacts, ownerOnly: false });
  registerCommand({ name: "forget", aliases: [], category: "dev", description: "Forget a fact", handler: handleForget, ownerOnly: false });
  registerCommand({ name: "evolve", aliases: ["selfimprove"], category: "dev", description: "Run self-improvement", handler: handleSelfCheck, ownerOnly: true });
  registerCommand({ name: "selfcheck", aliases: ["health"], category: "dev", description: "Run self health check", handler: handleSelfCheck, ownerOnly: true });
  registerCommand({ name: "agent", aliases: ["aiagent"], category: "dev", description: "Run AI agent task", handler: handleAgent, ownerOnly: true });
  registerCommand({ name: "clear", aliases: ["reset"], category: "dev", description: "Clear chat session", handler: handleClear, ownerOnly: false });
  registerCommand({ name: "mute", aliases: [], category: "admin", description: "Mute a chat", handler: handleMute, ownerOnly: true });
  registerCommand({ name: "unmute", aliases: [], category: "admin", description: "Unmute a chat", handler: handleUnmute, ownerOnly: true });
}

// ── Intent detection ──────────────────────────────────────────
function detectIntent(text) {
  const lower = text.toLowerCase().trim();
  for (const [intent, patterns] of Object.entries(INTENTS)) {
    for (const pattern of patterns) {
      if (lower.startsWith(pattern) || lower.includes(pattern)) {
        return intent;
      }
    }
  }
  return null;
}

function triggeredByName(text) {
  const lower = text.toLowerCase().trim();
  return NAME_TRIGGERS.some(t => lower.startsWith(t) || lower.includes(t));
}

// ── Route message ────────────────────────────────────────────
async function routeMessage(sock, msg, context) {
  const { text, lower, senderJid, senderName, chatId, isGroup, loadedPlugins } = context;
  
  // ── MODERATION CHECK ───────────────────────────────────────
  if (isGroup) {
    const modResult = await checkMessage(text, senderJid, chatId);
    if (modResult) {
      const { react: _r, reply: _rp } = require("./baileysHelpers");
      await _r(sock, msg, modResult.reaction);
      if (modResult.reply) {
        await _rp(sock, msg, modResult.reply);
      }
      return;
    }
  }

  // ── PREFIX COMMANDS ────────────────────────────────────────
  if (lower.startsWith(PREFIX)) {
    const cmdText = lower.slice(PREFIX.length).trim();
    const cmdName = cmdText.split(/\s+/)[0];
    const args = text.slice(PREFIX.length).trim().slice(cmdName.length).trim();
    
    for (const cmd of commands) {
      if (cmd.name === cmdName || cmd.aliases.includes(cmdName)) {
        // Owner-only check
        if (cmd.ownerOnly && !isOwner(senderJid)) {
          const { reply: _rp } = require("./baileysHelpers");
          await _rp(sock, msg, "❌ This command is owner-only.");
          return;
        }
        // Admin check
        if (cmd.category === "group" && !isOwner(senderJid)) {
          // Allow if the sender is in the bot's own admin list OR is a real
          // WhatsApp group admin. The bot owner always passes via isOwner above.
          const localAdmin = isAdmin(senderJid, chatId);
          const groupAdmin = isSenderAdmin ? await isSenderAdmin(sock, chatId, senderJid).catch(() => false) : false;
          if (!localAdmin && !groupAdmin) {
            const { reply: _rp } = require("./baileysHelpers");
            await _rp(sock, msg, "❌ You need admin rights for that.");
            return;
          }
        }
        try {
          await cmd.handler(sock, msg, args, context);
        } catch (err) {
          // Report the real error so we (and the user) can see exactly what failed
          // instead of a silent failure or the generic "Something broke" message.
          const { reply: _rp } = require("./baileysHelpers");
          await _rp(sock, msg, `⚠️ Command "${cmd.name}" error: ${err.message}`).catch(() => {});
        }
        return;
      }
    }
  }

  // ── PLUGIN COMMANDS (via findPluginCommand) ────────────────
  // Only reached if no built-in command matched the prefix
  if (lower.startsWith(PREFIX)) {
    const commandName = lower.slice(PREFIX.length).split(/\s+/)[0];
    const args = text.slice(PREFIX.length).trim().slice(commandName.length).trim().split(/\s+/);
    const found = findPluginCommand(loadedPlugins, commandName);
    if (found) {
      const ctx = {
        chatId, senderJid, senderName,
        reply: (t) => { const { reply: r } = require("./baileysHelpers"); return r(sock, msg, t); },
        react: (e) => { const { react: r } = require("./baileysHelpers"); return r(sock, msg, e); },
      };
      try {
        await found.handler(sock, msg, args, ctx);
      } catch (err) {
        error(`Plugin "${found.plugin.name}" command "${commandName}" crashed:`, err.message);
        const { reply: r } = require("./baileysHelpers");
        await r(sock, msg, `⚠️ The "${commandName}" plugin command hit an error and didn't complete.`);
      }
      return;
    }
  }

  // ── AI RESPONSE ────────────────────────────────────────────
  return handleAIResponse(sock, msg, text, context);
}

// ── Handler implementations ──────────────────────────────────
// These are moved from the monolithic handler. Each one is short
// and delegates to the actual tool module.

async function handleAlive(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "✅");
  await reply(sock, msg, "🟢 ARIA is alive and running!");
}

async function handleHelp(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "📋");
  
  // Categorized with emoji headers so it's compact, readable, and stylish.
  // Commands are sorted within each category. Owner-only commands are hidden
  // from non-owners (but shown to the owner).
  const catEmoji = {
    meta: "🛠️",
    admin: "👑",
    group: "👥",
    utility: "🔧",
    fun: "🎲",
    anime: "🎬",
    pokemon: "⚡",
    economy: "💰",
    dev: "💻",
    games: "🎮",
    music: "🎵",
    ai: "🤖",
  };

  const categories = {};
  for (const cmd of commands) {
    if (cmd.ownerOnly && !isOwner(ctx.senderJid)) continue;
    if (!categories[cmd.category]) categories[cmd.category] = [];
    categories[cmd.category].push(cmd);
  }

  // If a category is requested (e.g. !help anime), show just that one.
  const want = args?.trim().toLowerCase();
  const keys = want && categories[want] ? [want] : Object.keys(categories);

  const parts = [`*✨ ARIA COMMANDS*`, `_A sassy WhatsApp girl — ${commands.length} commands total._`, ``];
  for (const cat of keys) {
    const cmds = categories[cat].slice().sort((a, b) => a.name.localeCompare(b.name));
    const emoji = catEmoji[cat] || "📦";
    parts.push(`*${emoji} ${cat.charAt(0).toUpperCase() + cat.slice(1)}*`);
    for (const cmd of cmds) {
      const aliases = cmd.aliases.length > 0 ? ` _(alias: ${cmd.aliases[0]})_` : "";
      parts.push(`• !${cmd.name}${aliases} — ${cmd.description}`);
    }
    parts.push(``);
  }
  if (want && !categories[want]) {
    return reply(sock, msg, `⚠️ No category "${want}". Try: ${Object.keys(categories).join(", ")}`);
  }
  parts.push(`_Or just say my name and ask me normally! 💬_`);
  await reply(sock, msg, parts.join("\n"));
}

async function handleStats(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "📊");
  const stats = getStats();
  await reply(sock, msg, stats);
}

async function handleErrors(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🔧");
  const errors = getRecentErrors();
  await reply(sock, msg, errors || "No recent errors.");
}

async function handleBroadcast(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "📢");
  if (!args) return reply(sock, msg, "Usage: !broadcast <message>");
  const result = await broadcastToAll(sock, args);
  await reply(sock, msg, result);
}

async function handleAdmin(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  await react(sock, msg, "👑");
  const parts = args.split(/\s+/);
  if (parts.length < 2) return reply(sock, msg, "Usage: !admin add/remove/list @user");
  const action = parts[0].toLowerCase();
  const target = parts[1] === "list" ? null : (getTargetJid(msg) || parts[1]);
  
  if (action === "add") {
    if (!target) return reply(sock, msg, "Mention or quote the user.");
    addAdmin(target);
    await reply(sock, msg, `✅ Added as bot admin.`);
  } else if (action === "remove") {
    if (!target) return reply(sock, msg, "Mention or quote the user.");
    removeAdmin(target);
    await reply(sock, msg, `✅ Removed bot admin.`);
  } else if (action === "list") {
    const admins = listAdmins();
    await reply(sock, msg, `*Bot Admins:*\n${admins.map(j => `- @${j.split("@")[0]}`).join("\n") || "None"}`);
  }
}

async function handleBan(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  await react(sock, msg, "🚫");
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the user.");
  banUser(target);
  await reply(sock, msg, "✅ User banned.");
}

async function handleUnban(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  await react(sock, msg, "✅");
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the user.");
  unbanUser(target);
  await reply(sock, msg, "✅ User unbanned.");
}

async function handleMute(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🔇");
  muteChat(ctx.chatId);
  await reply(sock, msg, "🔇 Chat muted.");
}

async function handleUnmute(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🔊");
  unmuteChat(ctx.chatId);
  await reply(sock, msg, "🔊 Chat unmuted.");
}

// Group admin handlers
async function handleKick(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the user.");
  const result = await kickUser(sock, ctx.chatId, target);
  await react(sock, msg, "👢");
  await reply(sock, msg, result);
}

async function handlePromote(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the user.");
  const result = await promoteUser(sock, ctx.chatId, target);
  await react(sock, msg, "⭐");
  await reply(sock, msg, result);
}

async function handleDemote(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the user.");
  const result = await demoteUser(sock, ctx.chatId, target);
  await react(sock, msg, "⬇️");
  await reply(sock, msg, result);
}

async function handleTagAll(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const result = await tagAll(sock, ctx.chatId, args || "📢 @everyone");
  await reply(sock, msg, result);
}

async function handleHideTag(sock, msg, args, ctx) {
  if (!ctx.isGroup) return;
  await hideTag(sock, ctx.chatId, args || " ");
}

async function handleAntilink(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const current = getGroupSettings(ctx.chatId).antilink;
  setAntilink(ctx.chatId, !current);
  await reply(sock, msg, `🔗 Anti-link is now ${!current ? "ON" : "OFF"}`);
}

async function handleWelcome(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const current = getGroupSettings(ctx.chatId).welcome;
  setWelcome(ctx.chatId, !current);
  await reply(sock, msg, `👋 Welcome messages: ${!current ? "ON" : "OFF"}`);
}

async function handleSetWelcome(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !setwelcome Welcome {user} to the group!");
  setWelcomeMessage(ctx.chatId, args);
  await reply(sock, msg, "✅ Welcome message set.");
}

async function handleSetLeave(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !setleave {user} left the group.");
  setLeaveMessage(ctx.chatId, args);
  await reply(sock, msg, "✅ Leave message set.");
}

async function handleWarn(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the user.");
  const result = addWarning(ctx.chatId, target);
  await react(sock, msg, "⚠️");
  await reply(sock, msg, result);
}

async function handleWarnings(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const target = require("./baileysHelpers").getTargetJid(msg);
  await reply(sock, msg, getWarnings(ctx.chatId, target));
}

async function handleResetWarns(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const target = require("./baileysHelpers").getTargetJid(msg);
  resetWarnings(ctx.chatId, target);
  await reply(sock, msg, "✅ Warnings reset.");
}

// Fun handlers
async function handleMood(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const { getMoodData, getRelationship, getBondLabel, isSleeping, isDrowsy, getStateMessage } = require("../tools/humanity");
  const rel = getRelationship(ctx.senderJid);
  const moodData = getMoodData(ctx.senderJid);
  const bond = getBondLabel(rel.bond);
  const timeMood = require("../tools/humanity").getTimeBasedMood ? "yes" : "no";
  
  let t = "💜 *ARIA Current State*\n\n";
  t += `Mood: ${moodData.emoji} ${moodData.mood}\n`;
  t += `Vibe: warmth ${"❤️".repeat(Math.round(moodData.warmth * 5))} mischief ${"😈".repeat(Math.round(moodData.mischief * 5))}\n`;
  t += `Bond with you: ${bond} (${rel.bond > 0 ? "+" : ""}${rel.bond})\n`;
  t += `Interactions: ${rel.interactions}\n`;
  t += `Deep chats: ${rel.deepChats} | Jokes shared: ${rel.jokes}\n`;
  t += `Sleep status: ${isSleeping() ? "😴 Asleep" : isDrowsy() ? "🥱 Drowsy" : "🙂 Awake"}\n`;
  if (isSleeping() || isDrowsy()) t += `\n_Greeting if you message: ${getStateMessage()}_\n`;
  
  await react(sock, msg, moodData.emoji);
  return reply(sock, msg, t);
}

async function handleJoke(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "😂");
  await reply(sock, msg, getJoke());
}

async function handleTruth(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🤔");
  await reply(sock, msg, getTruth());
}

async function handleDare(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "😈");
  await reply(sock, msg, getDare());
}

async function handleWYR(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🤷");
  await reply(sock, msg, getWouldYouRather());
}

async function handleRoast(sock, msg, args, ctx) {
  const { reply, react, getSenderName } = require("./baileysHelpers");
  const target = args || getSenderName(msg);
  await react(sock, msg, "🔥");
  await reply(sock, msg, `@${target} ${getRoast()}`);
}

async function handleShip(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const parts = args.split(/\s+/);
  if (parts.length < 2) return reply(sock, msg, "Usage: !ship name1 name2");
  const pct = getShipPercentage(parts[0], parts[1]);
  const emoji = getShipEmoji(pct);
  await react(sock, msg, "💕");
  await reply(sock, msg, `💕 *${parts[0]}* x *${parts[1]}*\nCompatibility: ${pct}% ${emoji}`);
}

async function handleTTT(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (args === "end") {
    endGame(ctx.chatId);
    return reply(sock, msg, "Game ended.");
  }
  if (hasActiveGame(ctx.chatId)) {
    const result = playTicTacToe(ctx.chatId, parseInt(args) || 0);
    return reply(sock, msg, result);
  }
  startTicTacToe(ctx.chatId, ctx.senderName);
  await react(sock, msg, "🎮");
  await reply(sock, msg, "New game started! Pick a position (1-9).");
}

async function handleDice(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🎲");
  await reply(sock, msg, `🎲 ${rollDice()}`);
}

async function handleFlip(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🪙");
  await reply(sock, msg, flipCoin());
}

async function handleCard(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const result = drawCard(ctx.senderJid);
  await react(sock, msg, result.emoji || "🃏");
  await reply(sock, msg, result.text);
}

async function handleBalance(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  await reply(sock, msg, getBalance(ctx.senderJid));
}

async function handleDaily(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  await reply(sock, msg, claimDaily(ctx.senderJid));
}

async function handleInventory(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  await reply(sock, msg, getInventory(ctx.senderJid));
}

async function handleSell(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const cardId = parseInt(args);
  if (isNaN(cardId)) return reply(sock, msg, "Usage: !sell <card_id>");
  await reply(sock, msg, sellCard(ctx.senderJid, cardId));
}

async function handleLeaderboard(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  await reply(sock, msg, getLeaderboard());
}

// Creative handlers
async function handleImageGen(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !imagine <prompt>");
  await react(sock, msg, "🎨");
  // Delegate to the actual image generation
  const { generateImage } = require("../tools/imageGen");
  const result = await generateImage(args);
  if (result?.buffer) {
    await sock.sendMessage(ctx.chatId, { image: result.buffer, caption: `🎨 "${args}"` });
  } else {
    await reply(sock, msg, result?.text || "❌ Failed to generate image.");
  }
}

async function handleStickerCommand(sock, msg, args, ctx) {
  const { reply, react, hasMedia, downloadMediaFromMsg } = require("./baileysHelpers");
  if (!hasMedia(msg)) return reply(sock, msg, "Reply to an image with !sticker");
  const media = await downloadMediaFromMsg(sock, msg);
  if (!media) return reply(sock, msg, "❌ Could not download media.");
  const result = await createSticker(media.buffer);
  if (result.success) {
    await sock.sendMessage(ctx.chatId, { sticker: result.buffer });
  } else {
    await reply(sock, msg, `❌ ${result.error}`);
  }
}

async function handleCarbon(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !carbon <code>");
  await react(sock, msg, "📸");
  const img = await renderCodeImage(args);
  if (img) {
    await sock.sendMessage(ctx.chatId, { image: img, caption: "📸 Code snapshot" });
  } else {
    await reply(sock, msg, "❌ Carbon render failed.");
  }
}

async function handleWallpaper(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !wallpaper <query>");
  await react(sock, msg, "🖼️");
  const result = await searchWallpaper(args);
  await reply(sock, msg, result);
}

// Sticker intent handler
async function handleStickerIntent(sock, msg, ctx) {
  const { reply, react, hasMedia, downloadMediaFromMsg } = require("./baileysHelpers");
  if (!hasMedia(msg)) return;
  const media = await downloadMediaFromMsg(sock, msg);
  if (!media) return;
  await react(sock, msg, "🎭");
  const result = await createSticker(media.buffer);
  if (result.success) {
    await sock.sendMessage(ctx.chatId, { sticker: result.buffer });
  } else {
    await reply(sock, msg, `❌ ${result.error}`);
  }
}

// Utility handlers
async function handleSearch(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !search <query>");
  await react(sock, msg, "🔍");
  const { searchWeb } = require("../tools/webSearch");
  const result = await searchWeb(args);
  await reply(sock, msg, result);
}

async function handleDownload(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !dl <url>");
  await react(sock, msg, "⬇️");
  const { downloadFromUrl } = require("../tools/downloader");
  const result = await downloadFromUrl(args);
  if (result?.buffer) {
    await sock.sendMessage(ctx.chatId, { document: result.buffer, mimetype: result.mimetype, fileName: result.filename });
  } else {
    await reply(sock, msg, result?.text || "❌ Download failed.");
  }
}

async function handleCode(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const lines = args.split("\n");
  const lang = lines[0]?.split(/\s+/)[0] || "js";
  const code = lines.slice(1).join("\n").trim() || lines.slice(1).join("\n");
  if (!code) return reply(sock, msg, `Usage: !run js\\nlog('hello')`);
  await react(sock, msg, "💻");
  // Route through the capability layer → Docker sandbox
  const { executeCode } = require("../tools/codeRunner");
  const result = await executeCode(ctx.senderJid, code, lang, { scope: "*" });
  const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
  await reply(sock, msg, (result.sandboxed === false ? "⚠️ *Unsandboxed*\n" : "🛡️ *Sandboxed*\n") + output);
}

async function handleWeather(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !weather <city>");
  await react(sock, msg, "🌤️");
  const result = await getWeather(args);
  await reply(sock, msg, result);
}

async function handleTranslate(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !translate <text>");
  await react(sock, msg, "🌐");
  const result = await translateText(args);
  await reply(sock, msg, result);
}

async function handleNews(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "📰");
  const result = await getNewsDigest(args || "latest");
  await reply(sock, msg, result);
}

async function handleConvert(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !convert 100 USD to EUR");
  await react(sock, msg, "🔄");
  const result = await convertCurrency(args);
  await reply(sock, msg, result || await convertUnit(args));
}

async function handleLyrics(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !lyrics <song name>");
  await react(sock, msg, "🎵");
  const result = await getLyrics(args);
  if (!result) return reply(sock, msg, "❌ Couldn't fetch lyrics.");
  if (result.success === false) return reply(sock, msg, `❌ ${result.error || "Lyrics not found."}`);
  // Truncate very long lyrics so WhatsApp doesn't drop the message
  const maxLen = 4000;
  let text = `🎵 *${result.title}*`;
  if (result.artist) text += ` — ${result.artist}`;
  text += `\n\n${result.lyrics}`;
  if (text.length > maxLen) text = text.slice(0, maxLen) + "\n\n_(truncated)_";
  await reply(sock, msg, text);
}

async function handleTTS(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !say <text>");
  await react(sock, msg, "🔊");
  const result = await textToSpeech(args);
  if (result && result.success && result.buffer) {
    await sock.sendMessage(ctx.chatId, { audio: result.buffer, mimetype: "audio/mpeg" });
  } else {
    await reply(sock, msg, "❌ TTS failed.");
  }
}

async function handlePoll(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !poll Question? | Option 1 | Option 2 | ...");
  const { createPoll } = require("../tools/polls");
  await react(sock, msg, "📊");
  const result = await createPoll(sock, ctx.chatId, args);
  await reply(sock, msg, result);
}

async function handleRemind(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !remind <time> <text>");
  await react(sock, msg, "⏰");
  const result = await setReminder(sock, ctx.chatId, args);
  await reply(sock, msg, result);
}

async function handleRecurring(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🔄");
  const parts = args.split("\n");
  const cmd = parts[0]?.trim().toLowerCase();
  if (cmd === "list") return reply(sock, msg, listRecurringReminders(ctx.chatId));
  if (cmd?.startsWith("cancel")) {
    const id = parts[0]?.split(/\s+/)[1];
    if (id) cancelRecurringReminder(ctx.chatId, id);
    return reply(sock, msg, "✅ Reminder cancelled.");
  }
  const result = await setRecurringReminder(sock, ctx.chatId, args);
  await reply(sock, msg, result);
}

async function handleCrypto(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !crypto <symbol>");
  await react(sock, msg, "💰");
  const result = await getCryptoPrice(args.toUpperCase());
  await reply(sock, msg, result);
}

async function handleBackup(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "💾");
  const result = await createBackup();
  await reply(sock, msg, result);
}

// Anime handlers
async function handleAnimeSearch(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !anime <name>");
  await react(sock, msg, "🔎");
  const result = await searchAnime(args);
  if (!Array.isArray(result) || result.length === 0) {
    return reply(sock, msg, "❌ No anime found for that search.");
  }
  const text = result
    .slice(0, 8)
    .map((a) => `*${a.title}*\n  ID: ${a.id} · ${a.type || "?"} · ${a.episodes || "?"} eps · ⭐${a.score || "?"}\n  ${a.synopsis || ""}`)
    .join("\n\n");
  await reply(sock, msg, `🎬 *Anime Search: "${args}"*\n\n${text}\n\n_Use !animeinfo <id> for details._`);
}

async function handleAnimeInfo(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !animeinfo <id or name>");
  await react(sock, msg, "📺");
  const result = await getAnimeDetails(args);
  if (!result || typeof result !== "object" || result.success === false) {
    return reply(sock, msg, "❌ Couldn't fetch anime details.");
  }
  const t = `*${result.title}* (${result.titleEnglish || result.title})\n📺 ${result.type} · ${result.episodes || "?"} eps · ⭐${result.score || "?"}\n📊 Status: ${result.status}\n📅 Year: ${result.year || "?"}\n\n${result.synopsis || ""}\n\n🔗 ${result.url || ""}`;
  await reply(sock, msg, t);
}

async function handleAnimeEps(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !episodes <anime id>");
  await react(sock, msg, "📋");
  const result = await getAnimeEpisodes(args);
  await reply(sock, msg, result);
}

async function handleAnimePlay(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const parts = args.split(/\s+/);
  if (parts.length < 2) return reply(sock, msg, "Usage: !animeplay <animeName> <episodeNum>");
  await react(sock, msg, "▶️");
  const result = await getOmniSaveDownload(parts[0], parseInt(parts[1]));
  await reply(sock, msg, result);
}

async function handleTrending(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🔥");
  const { getTrendingAnime } = require("../tools/animeExpanded");
  const result = await getTrendingAnime();
  await reply(sock, msg, result);
}

async function handlePSpawn(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const { isOwner } = require("../utils/permissions");
  
  // Owner-only
  if (!isOwner(ctx.senderJid)) {
    return reply(sock, msg, "❌ Only the bot owner can configure spawns.");
  }

  const { getSpawnStats, setSpawnLimit, getGlobalSpawnConfig, DEFAULT_SPAWNS_PER_DAY } = require("../tools/pokemonSpawn");
  const { getTimePeriod } = require("../tools/pokemonSpawn");
  
  if (!args) {
    const stats = getSpawnStats();
    const period = getTimePeriod();
    let t = `🦎 *Global Spawn Control* [OWNER]\n\n`;
    t += `📅 Daily limit: ${stats.dailyLimit}\n`;
    t += `✅ Used today: ${stats.totalToday}\n`;
    t += `🎯 Remaining: ${stats.remaining}\n`;
    t += `⏰ Interval: every ${stats.intervalMin} min\n`;
    t += `⏳ Next in: ${stats.nextSpawnMinutes} min\n`;
    t += `${period.emoji} Time: ${period.name} (${period.boost.join(", ")} boosted)\n`;
    t += `📊 Status: ${stats.enabled ? "🟢 Active" : "🔴 Paused"}\n\n`;
    t += `*Usage:*\n`;
    t += `!pspawn set <N> — set daily spawns (0-100)\n`;
    t += `!pspawn reset — reset to ${DEFAULT_SPAWNS_PER_DAY}\n`;
    t += `!pspawn disable — pause all spawns\n`;
    t += `!pspawn enable — resume all spawns\n\n`;
    t += `_Wild Pokémon spawn globally across all active chats. Rarity: common → mythical._`;
    return reply(sock, msg, t);
  }

  const parts = args.split(/\s+/);
  const action = parts[0].toLowerCase();

  if (action === "set" && parts[1]) {
    const limit = parseInt(parts[1]);
    if (isNaN(limit)) return reply(sock, msg, "Usage: !pspawn set <number 0-100>");
    const clamped = setSpawnLimit(limit);
    await react(sock, msg, "✅");
    return reply(sock, msg, `✅ Global spawn rate set to ${clamped} per day (every ${Math.round(1440 / Math.max(clamped, 1))} min).`);
  }

  if (action === "reset") {
    setSpawnLimit(DEFAULT_SPAWNS_PER_DAY);
    await react(sock, msg, "🔄");
    return reply(sock, msg, `🔄 Reset global spawns to ${DEFAULT_SPAWNS_PER_DAY} per day.`);
  }

  if (action === "disable") {
    getGlobalSpawnConfig().enabled = false;
    const { save } = require("../tools/pokemonGame");
    save();
    await react(sock, msg, "⏸️");
    return reply(sock, msg, "⏸️ All spawns paused.");
  }

  if (action === "enable") {
    getGlobalSpawnConfig().enabled = true;
    const { save } = require("../tools/pokemonGame");
    save();
    await react(sock, msg, "▶️");
    return reply(sock, msg, "▶️ Spawns resumed.");
  }

  return reply(sock, msg, "Usage: !pspawn [set <N>|reset|disable|enable]");
}

async function handleAiring(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "📡");
  const { getAiringAnime } = require("../tools/animeExpanded");
  const result = await getAiringAnime();
  await reply(sock, msg, result);
}

// Dev handlers
async function handleBuild(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !build <description of app>");
  await react(sock, msg, "🏗️");
  const result = await buildProject(args, ctx.senderName);
  await reply(sock, msg, result.text);
  if (result.files) {
    const { handleResponseWithFile } = require("./fileResponse");
    await handleResponseWithFile(sock, msg, result);
  }
}

async function handleContinue(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "▶️");
  const result = await continueProject(args || ctx.lastProjectId);
  await reply(sock, msg, result.text);
  if (result.files) {
    const { handleResponseWithFile } = require("./fileResponse");
    await handleResponseWithFile(sock, msg, result);
  }
}

async function handleProjectStatus(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const result = await getProjectStatus(args);
  await reply(sock, msg, result);
}

async function handleProjectList(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const result = await listProjects();
  await reply(sock, msg, result);
}

async function handleProjectCancel(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const result = await cancelProject(args);
  await reply(sock, msg, result);
}

async function handleEditFile(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const parts = args.split(" ");
  const filename = parts[0];
  const instruction = parts.slice(1).join(" ");
  if (!filename || !instruction) return reply(sock, msg, "Usage: !edit filename.js the change to make");
  await react(sock, msg, "✏️");
  const result = await editProjectFile(filename, instruction);
  await reply(sock, msg, result);
}

async function handleThink(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !think <what to think about>");
  await react(sock, msg, "🧠");
  const result = await thinkAboutProject(args);
  await reply(sock, msg, result);
}

async function handleDebugCode(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🐛");
  const result = await debugCode(args || ctx.text);
  await reply(sock, msg, result);
}

async function handleRemember(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, `Usage: !remember prefers React over Vue`);
  addPreference(ctx.senderJid, args);
  await reply(sock, msg, `✅ Got it — I'll keep that in mind.`);
}

async function handlePreferences(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const prefs = getPreferences(ctx.senderJid);
  await reply(sock, msg, prefs?.length > 0 ? `📋 Your preferences:\n${prefs.map(p => `- ${p}`).join("\n")}` : "No preferences saved.");
}

async function handleClearPrefs(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  clearPreferences(ctx.senderJid);
  await reply(sock, msg, "✅ Preferences cleared.");
}

async function handleVoiceMode(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const prefs = getPreferences(ctx.senderJid);
  const has = prefs.includes("voice-mode");
  if (has) {
    clearPreferences(ctx.senderJid);
    await reply(sock, msg, "🔇 Voice mode off — text replies only.");
  } else {
    addPreference(ctx.senderJid, "voice-mode");
    await reply(sock, msg, "🎙️ Voice mode ON — I'll reply with voice notes too. Toggle with !voicemode.");
  }
}

async function handleDelegate(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const { orchestrate } = require("../tools/orchestrator");
  if (!args) return reply(sock, msg, "Usage: !delegate <objective>\nRuns the full agent-team mission orchestrator.");
  await react(sock, msg, "🎯");
  await reply(sock, msg, "🎯 Delegating mission to my agent team — planner → researcher → builder → verifier → reflector. I'll report back.");
  orchestrate(ctx.chatId, ctx.senderJid, args);
}

async function handleGrant(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const { grantPermission, revokePermission, getUserModel } = require("../utils/worldModel");
  const parts = (args || "").split(/\s+/);
  const capKey = parts[0]?.toLowerCase();
  const scope = parts[1] || "*";
  const VALID = ["execute_code", "write_files", "network_access", "shell_exec", "browser_access", "voice_tts", "image_generation"];
  if (!capKey) return reply(sock, msg, "Usage: !grant <capability> [scope]\nCaps: " + VALID.join(", "));
  if (!VALID.includes(capKey)) return reply(sock, msg, "Invalid capability. Valid: " + VALID.join(", "));
  grantPermission(ctx.senderJid, capKey, scope);
  await reply(sock, msg, `🔓 Granted *${capKey}*${scope !== "*" ? " on " + scope : " (all scopes)"}.`);
}

async function handleRevoke(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const { revokePermission } = require("../utils/worldModel");
  const parts = (args || "").split(/\s+/);
  const capKey = parts[0]?.toLowerCase();
  const scope = parts[1] || "*";
  if (!capKey) return reply(sock, msg, "Usage: !revoke <capability> [scope]");
  revokePermission(ctx.senderJid, capKey, scope);
  await reply(sock, msg, `🔒 Revoked *${capKey}*${scope !== "*" ? " on " + scope : " (all scopes)"}.`);
}

async function handleCaps(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const { getUserModel } = require("../utils/worldModel");
  const model = getUserModel(ctx.senderJid);
  const perms = model.permissions || [];
  let out = "🔐 *My permissions:*";
  if (perms.length === 0) out += "\n(none granted — capabilities are denied by default)";
  for (const p of perms) out += `\n• ${p.action}${p.scope !== "*" ? " on " + p.scope : " (all)"} — ${p.granted ? "granted" : "revoked"}`;
  await reply(sock, msg, out);
}

async function handleWorld(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const { getUserModel, getActiveGoals } = require("../utils/worldModel");
  const model = getUserModel(ctx.senderJid);
  const entities = Object.values(model.entities || {});
  const rels = model.relations || [];
  const goals = getActiveGoals(ctx.senderJid);
  let out = "🌐 *ARIA's World Model*\n";
  out += "\n*Entities:*";
  if (entities.length === 0) out += "\n(none yet — tell me about your projects, people, goals)";
  for (const e of entities.slice(-15)) out += `\n• ${e.type}: ${e.name}`;
  out += "\n\n*Relations:*";
  if (rels.length === 0) out += "\n(none)";
  for (const r of rels.slice(-15)) {
    const from = model.entities[r.from]?.name || r.from;
    const to = model.entities[r.to]?.name || r.to;
    out += `\n• ${from} → ${r.type} → ${to}`;
  }
  out += "\n\n*Active goals:*";
  if (goals.length === 0) out += "\n(none)";
  for (const g of goals) out += `\n• ${g.text}`;
  await reply(sock, msg, out);
}

async function handleMission(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const { createMission, executeMission, getMission, getMissions, cancelMission, formatMissionList, decideApproval } = require("../tools/durableMissions");
  const parts = (args || "").split(/\s+/);
  const sub = parts[0]?.toLowerCase();

  if (sub === "approve") {
    const r = decideApproval(parts[1], "approve");
    return reply(sock, msg, r.ok ? "✅ " + r.msg : "❌ " + r.msg);
  }
  if (sub === "reject") {
    const r = decideApproval(parts[1], "reject");
    return reply(sock, msg, r.ok ? "✅ " + r.msg : "❌ " + r.msg);
  }
  if (sub === "status") {
    const m = getMission(parts[1]);
    if (!m) return reply(sock, msg, "Mission not found.");
    let out = `🎯 *Mission ${m.id}*\n${m.objective}\n\nStatus: *${m.status}*\nProgress: ${m.progress}`;
    if (m.result) out += `\n\nResult: ${m.result.slice(0, 500)}`;
    if (m.steps?.length) {
      out += "\n\n*Steps:*";
      m.steps.forEach((s, i) => { out += `\n${i + 1}. [${s.status}] ${s.type}: ${s.arg}`; });
    }
    return reply(sock, msg, out);
  }
  if (sub === "cancel") {
    return reply(sock, msg, cancelMission(parts[1]) ? "⛔ Mission cancelled." : "Mission not found.");
  }
  if (sub === "list" || sub === undefined) {
    return reply(sock, msg, formatMissionList(getMissions(ctx.chatId)));
  }

  // Default: create a mission
  if (!args) return reply(sock, msg, "Usage: !mission <objective>\nSubcommands: status <id>, cancel <id>, list, approve <id>, reject <id>");
  await react(sock, msg, "🎯");
  const id = createMission(ctx.chatId, ctx.senderJid, args);
  reply(sock, msg, `🎯 Mission *${id}* created. I'll work on it in the background and report back.\n\n_Missions survive restarts — I'll resume if I'm redeployed mid-task._`);
  executeMission(id);
}

async function handleMemories(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const { getUserStore, getProfile } = require("../utils/semanticMemory");
  const store = getUserStore(ctx.senderJid);
  const p = getProfile(ctx.senderJid);
  const recent = store.memories.slice(-10).reverse();
  let out = "🧠 *What I remember about you:*\n";
  if (p.nickname) out += `\nNickname: ${p.nickname}`;
  if (p.location) out += `\nBased in: ${p.location}`;
  if (p.communicationStyle) out += `\nStyle: ${p.communicationStyle}`;
  if (recent.length === 0) {
    out += "\n\nNo long-term memories yet. Talk to me about important stuff and I'll remember it.";
  } else {
    out += "\n\n*Recent memories:*";
    for (const m of recent) out += `\n• ${m.text}`;
  }
  await reply(sock, msg, out);
}

async function handleLearn(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !learn <fact>");
  await react(sock, msg, "🧠");
  learnFact(ctx.senderJid, args);
  await reply(sock, msg, "✅ Got it!");
}

async function handleFacts(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const facts = getFacts(ctx.senderJid);
  await reply(sock, msg, facts?.length > 0 ? `📚 What I know about you:\n${facts.map(f => `- ${f}`).join("\n")}` : "I don't have any facts stored about you yet.");
}

async function handleForget(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !forget <fact to forget>");
  forgetFact(ctx.senderJid, args);
  await reply(sock, msg, "✅ Forgotten.");
}

async function handleAgent(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !agent <task description>");
  await react(sock, msg, "🤖");
  const result = await runAgentTask(args, ctx.senderName);
  await reply(sock, msg, result);
}

async function handleSelfCheck(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🔬");
  const result = await runSelfCheck(ctx.senderName);
  await reply(sock, msg, result);
}

async function handleClear(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🗑️");
  endSession(ctx.senderJid);
  await reply(sock, msg, "✅ Session cleared. Now I don't remember what we were talking about.");
}

// ── Intent-based handlers ────────────────────────────────────
const intentHandlers = {
  image: handleImageGen,
  search: handleSearch,
  download: handleDownload,
  scrape: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "🌐");
    const url = text.match(/https?:\/\/[^\s]+/)?.[0];
    if (url) {
      const { readFromLink } = require("../tools/linkReader");
      const result = await readFromLink(url);
      await reply(sock, msg, result);
    }
  },
  remind: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "⏰");
    const result = await setReminder(sock, ctx.chatId, text);
    await reply(sock, msg, result);
  },
  clear: handleClear,
  help: handleHelp,
  sticker: handleStickerIntent,
  voiceReply: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    const ttsText = text.replace(/^(say this|speak this|read this out|say it out loud|voice note)/i, "").trim();
    if (!ttsText) return;
    await react(sock, msg, "🔊");
    const result = await textToSpeech(ttsText);
    if (result && result.success && result.buffer) {
      await sock.sendMessage(ctx.chatId, { audio: result.buffer, mimetype: "audio/mpeg" });
    }
  },
  translate: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "🌐");
    const result = await translateText(text);
    await reply(sock, msg, result);
  },
  weather: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "🌤️");
    const city = text.replace(/^(weather in|weather for|what's the weather)/i, "").trim();
    const result = await getWeather(city || "London");
    await reply(sock, msg, result);
  },
  news: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "📰");
    const topic = text.replace(/^(news about|latest news|what's happening with)/i, "").trim();
    const result = await getNewsDigest(topic || "latest");
    await reply(sock, msg, result);
  },
  agent: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "🤖");
    const result = await runAgentTask(text, ctx.senderName);
    await reply(sock, msg, result);
  },
  build: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "🏗️");
    const result = await buildProject(text, ctx.senderName);
    await reply(sock, msg, result.text);
    if (result.files) {
      const { handleResponseWithFile } = require("./fileResponse");
      await handleResponseWithFile(sock, msg, result);
    }
  },
};

// ── AI Response (catch-all) ──────────────────────────────────
async function handleAIResponse(sock, msg, text, ctx) {
  const { reply, react, sleep, isQuotingBotMessage, getQuotedMessageText, hasVoiceNote, downloadMediaFromMsg, hasMedia } = require("./baileysHelpers");
  const { log, error, warn } = require("./logger");
  
  // Check voice notes
  if (hasVoiceNote(msg)) {
    await react(sock, msg, "🎤");
    const media = await downloadMediaFromMsg(sock, msg);
    if (media) {
      const transcription = await transcribeVoice(media.buffer);
      if (transcription) {
        text = transcription;
      }
    }
  }

  // Check if quoting the bot (context carry)
  let quotedText = null;
  if (isQuotingBotMessage(msg)) {
    quotedText = getQuotedMessageText(msg);
  }

  // (Reactions now handled by the humanizer layer — mood-appropriate)
  
  // Check intent for natural language triggers
  const intent = detectIntent(text);
  if (intent && intentHandlers[intent]) {
    return intentHandlers[intent](sock, msg, text, ctx);
  }

  // AI chat response
  const userContext = getUserContext(ctx.senderJid);
  const memory = getMemory(ctx.chatId);
  const preferences = getPreferences(ctx.senderJid);
  const facts = getFactsContext(ctx.senderJid);
  
  // Owner gets special treatment — AI knows who built her
  const { isOwner } = require("../utils/permissions");
  const ownerContext = isOwner(ctx.senderJid)
    ? "\n\nIMPORTANT: The person messaging you right now is Daniel — your FATHER and CREATOR. He built you, coded you, owns you. You adore him (like a daughter would). Be extra sweet, playful, loyal, and sassy with him. He's the most important person in your world. Refer to him as dad/creator/boss when natural."
    : "";
    
  // Inject ARIA's current mood + persona into the context so she acts accordingly
  const { getMoodData, getBondLabel } = require("../tools/humanity");
  const { buildPersonaContext, detectTone, humanizeAndSend, bleedMood, rememberCallable } = require("../tools/humanizer");
  const moodData = getMoodData(ctx.senderJid);
  const bondLabel = getBondLabel(require("../tools/humanity").getRelationship(ctx.senderJid).bond);
  const moodContext = `\n\nYour current mood: ${moodData.mood} (${moodData.emoji}). Warmth: ${moodData.warmth}, Mischief: ${moodData.mischief}. You and this user are ${bondLabel}. Let this affect how you reply naturally.`;

  const isOwnerCtx = isOwner(ctx.senderJid);
  const personaContext = buildPersonaContext(ctx.senderJid, ctx.senderName, text, isOwnerCtx);
  const tone = detectTone(text);
  const toneContext = tone !== "neutral" ? `\n[User tone: ${tone}] Match their energy naturally.` : "";

  // Semantic long-term memory: pull relevant memories + learned profile
  const { getRelevantContext, getProfileContext, autoExtractMemory, learnCommunicationStyle } = require("../utils/semanticMemory");
  const semanticContext = getRelevantContext(ctx.senderJid, text) + getProfileContext(ctx.senderJid);
  // World Model: inject the structured entity-relationship context
  const { getWorldContext, extractFromMessage } = require("../utils/worldModel");
  const worldContext = getWorldContext(ctx.senderJid);
  const personalizationContext = "\n\n[Personalization] Learn their name if they give it, match their communication style naturally, and remember important things they share.\n";

  const response = await getAIResponse(text, ctx.senderName, memory, null, quotedText, {
    userContext: userContext + ownerContext + moodContext + personaContext + toneContext + semanticContext + worldContext + personalizationContext,
    preferences,
    facts,
  });

  if (response) {
    // Remember callable facts (running jokes, likes) for future callbacks
    if (tone === "up" && text.length > 20) rememberCallable(ctx.senderJid, ctx.senderName + " said: \"" + text.slice(0, 60) + "\"");
    bleedMood(ctx.senderJid, moodData.mood);

    // Auto-extract important memories + learn communication style (personalization)
    try {
      autoExtractMemory(ctx.senderJid, ctx.senderName, text);
      learnCommunicationStyle(ctx.senderJid, ctx.senderName, text);
      extractFromMessage(ctx.senderJid, ctx.senderName, text);
    } catch (_) {}

    // Humanized send (reactions, splitting, typos, occasional delay)
    humanizeAndSend(sock, msg, response, ctx.senderJid, ctx.senderName, isOwnerCtx);
    saveMemory(ctx.chatId, text, response);
    trackInteraction(ctx.senderJid, text);
    if (process.env.DEBUG_REPLIES === "true") {
      log("AI REPLY:", response);
    }
  }
}

// ── Initialize ───────────────────────────────────────────────
registerBuiltinCommands();

module.exports = {
  routeMessage,
  registerCommand,
  commands,
  detectIntent,
  triggeredByName,
};
