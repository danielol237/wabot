// Command Router + Intent Parser for ARIA WhatsApp Bot
// Extracted from the monolithic messageHandler.js to make adding features
// a matter of registering a command, not touching a 1600-line file.

// ── Imports ──────────────────────────────────────────────────
const axios = require("axios");
const fs = require("fs");
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
const { searchAnime, searchAnimePahe, getAnimeEpisodes, getAnimeDetails, searchOmniSave } = require("../tools/animeDownload");
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
  github: ["on github", "look on github", "github search", "search github", "find it on github", "git hub"],
  reddit: ["on reddit", "look on reddit", "reddit search", "search reddit", "find it on reddit"],
  wikipedia: ["on wikipedia", "wikipedia search", "search wikipedia", "on wiki", "wikipedia about"],
  deathBattle: ["who would win", "who wins", "death battle", "deathbattle", "would beat", "in a fight", "fight between"],
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
  registerCommand({ name: "stats", aliases: ["botstats"], category: "admin", description: "Show bot statistics", handler: handleStats, ownerOnly: true });
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

  // Group message stats / moderation
  registerCommand({ name: "top", aliases: ["leaderboard", "topmsgs"], category: "group", description: "Top talkers in this group: !top [N]", handler: handleGroupTop, ownerOnly: false });
  registerCommand({ name: "active", aliases: ["actives"], category: "group", description: "Active members (>= N msgs): !active [N]", handler: handleGroupActive, ownerOnly: false });
  registerCommand({ name: "inactive", aliases: ["inactives", "dead"], category: "group", description: "Inactive members (< N msgs): !inactive [N]", handler: handleGroupInactive, ownerOnly: false });
  registerCommand({ name: "purge", aliases: ["prune"], category: "group", description: "Kick members under N msgs: !purge [N]", handler: handleGroupPurge, ownerOnly: false });

  // Academy (adaptive learning system)
  registerCommand({ name: "academy", aliases: ["study", "learn", "school"], category: "utility", description: "Adaptive coding academy: pick a track + level", handler: handleAcademy, ownerOnly: false });
  registerCommand({ name: "run", aliases: ["execute", "practice"], category: "utility", description: "Run code for a challenge: !run <code>", handler: handleAcademyRun, ownerOnly: false });
  registerCommand({ name: "project", aliases: ["capstone", "build"], category: "utility", description: "Start a track project: !project <track> <level>", handler: handleProject, ownerOnly: false });
  registerCommand({ name: "incident", aliases: ["oncall", "sre"], category: "utility", description: "Production incident simulator: diagnose + fix", handler: handleIncident, ownerOnly: false });
  registerCommand({ name: "review", aliases: ["codereview", "court"], category: "utility", description: "AI code review court: !review <code>", handler: handleReview, ownerOnly: false });
  registerCommand({ name: "duel", aliases: ["vs", "challenge"], category: "utility", description: "AI-vs-human duel: !duel <problem>", handler: handleDuel, ownerOnly: false });
  registerCommand({ name: "submit", aliases: ["mycode"], category: "utility", description: "Submit your duel solution: !submit <code>", handler: handleSubmit, ownerOnly: false });
  registerCommand({ name: "explain", aliases: ["teach", "teachback"], category: "utility", description: "Teach-it-back: explain a concept, ARIA grades + finds misconceptions", handler: handleExplain, ownerOnly: false });

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
  registerCommand({ name: "vote", aliases: [], category: "utility", description: "Vote on a poll: !vote <pollId> <number>", handler: handleVote, ownerOnly: false });
  registerCommand({ name: "pollclose", aliases: ["closepoll"], category: "utility", description: "Close a poll (creator/owner): !pollclose <pollId>", handler: handlePollClose, ownerOnly: false });
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

  // Anime
  registerCommand({ name: "anime", aliases: ["animesearch"], category: "anime", description: "Search anime", handler: handleAnimeSearch, ownerOnly: false });
  registerCommand({ name: "animeinfo", aliases: ["ainfo"], category: "anime", description: "Get anime details", handler: handleAnimeInfo, ownerOnly: false });
  registerCommand({ name: "episodes", aliases: ["eps", "animeeps"], category: "anime", description: "Get anime episodes", handler: handleAnimeEps, ownerOnly: false });
  registerCommand({ name: "animedl", aliases: ["animeplay", "astream", "watch", "dlanime"], category: "anime", description: "Download anime episode and send video", handler: handleAnimePlay, ownerOnly: false });
  registerCommand({ name: "animebrowser", aliases: ["animeweb"], category: "anime", description: "Open the ARIA anime browser", handler: handleAnimeBrowser, ownerOnly: false });
  registerCommand({ name: "animelist", aliases: ["animewl"], category: "anime", description: "Your anime watchlist", handler: handleAnimeList, ownerOnly: false });
  registerCommand({ name: "trending", aliases: ["trendinganime"], category: "anime", description: "Trending anime", handler: handleTrending, ownerOnly: false });
  registerCommand({ name: "airing", aliases: ["airinganime"], category: "anime", description: "Airing anime", handler: handleAiring, ownerOnly: false });
  registerCommand({ name: "deathbattle", aliases: ["db", "deathbatle", "fight", "whowins", "animebattle"], category: "anime", description: "Simulate an anime death battle: !deathbattle goku vs saitama", handler: handleDeathBattle, ownerOnly: false });

  // Research (GitHub / Reddit / Wikipedia)
  registerCommand({ name: "github", aliases: ["gh"], category: "research", description: "Search GitHub repos: !github <thing>", handler: handleGitHub, ownerOnly: false });
  registerCommand({ name: "releases", aliases: ["ghrelease", "githubrelease"], category: "research", description: "Get latest GitHub release + download links: !releases owner/repo", handler: handleGitHubReleases, ownerOnly: false });
  registerCommand({ name: "reddit", aliases: ["rdt"], category: "research", description: "Search Reddit: !reddit <thing> or !reddit r/sub <thing>", handler: handleReddit, ownerOnly: false });
  registerCommand({ name: "wikipedia", aliases: ["wiki", "wp"], category: "research", description: "Search Wikipedia: !wikipedia <thing>", handler: handleWikipedia, ownerOnly: false });

  // Pokémon

  // Household / shared mode
  registerCommand({ name: "household", aliases: ["hh", "family"], category: "utility", description: "Household: create/join/manage shared space", handler: handleHousehold, ownerOnly: false });
  registerCommand({ name: "hhtask", aliases: ["hht"], category: "utility", description: "Add a shared household task", handler: handleHHTask, ownerOnly: false });
  registerCommand({ name: "hhtasks", aliases: ["hhts"], category: "utility", description: "List shared household tasks", handler: handleHHTasks, ownerOnly: false });
  registerCommand({ name: "hhdone", aliases: ["hhd"], category: "utility", description: "Mark a shared task done: !hhdone <id>", handler: handleHHDone, ownerOnly: false });

  // Scenario simulator (risk dry-run before actions)
  registerCommand({ name: "sim", aliases: ["rehearse", "risk"], category: "utility", description: "Dry-run an action and see risk: !sim <action>", handler: handleSim, ownerOnly: false });

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

  // Plugin marketplace
  registerCommand({ name: "plugins", aliases: ["pluglist"], category: "admin", description: "List installed plugins", handler: handlePluginsList, ownerOnly: true });
  registerCommand({ name: "install", aliases: ["pluginstall"], category: "admin", description: "Install a plugin: !install <name>", handler: handlePluginInstall, ownerOnly: true });
  registerCommand({ name: "update", aliases: ["plugupdate"], category: "admin", description: "Update a plugin: !update <name>", handler: handlePluginUpdate, ownerOnly: true });
  registerCommand({ name: "enable", aliases: ["plugenable"], category: "admin", description: "Enable a plugin: !enable <name>", handler: handlePluginEnable, ownerOnly: true });
  registerCommand({ name: "disable", aliases: ["plugdisable"], category: "admin", description: "Disable a plugin: !disable <name>", handler: handlePluginDisable, ownerOnly: true });
}

// ── Intent detection ──────────────────────────────────────────
function detectIntent(text) {
  const lower = text.toLowerCase().trim();
  for (const [intent, patterns] of Object.entries(INTENTS)) {
    for (const pattern of patterns) {
      // Only match clear intent at the START of the message, never mid-sentence.
      // Using startsWith prevents normal chat like "help me search stake..." from
      // being hijacked by the help command.
      if (lower === pattern || lower.startsWith(pattern + " ") || lower.startsWith(pattern + ",") || lower.startsWith(pattern + "?")) {
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
      const { reply: _rp } = require("./baileysHelpers");
      // Delete the offending message (best-effort; bot needs to be admin).
      if (modResult.action === "delete") {
        try { await sock.sendMessage(chatId, { delete: { remoteJid: chatId, id: msg.key.id, participant: msg.key.participant } }); } catch (_) {}
      }
      await _rp(sock, msg, `🚫 ${modResult.reason || "This message was removed."}`);
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
        // Admin check — group commands require the sender to be the owner, a
        // bot admin, or a real WhatsApp group admin.
        if (cmd.category === "group" && !isOwner(senderJid)) {
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
          try { require("./eventLog").track("command", cmd.name + (args ? " " + args.slice(0, 40) : "")); } catch (_) {}
        } catch (err) {
          // Report the real error so we (and the user) can see exactly what failed
          // instead of a silent failure or the generic "Something broke" message.
          const { reply: _rp } = require("./baileysHelpers");
          await _rp(sock, msg, `⚠️ Command "${cmd.name}" error: ${err.message}`).catch(() => {});
          try { require("./eventLog").track("error", `Command ${cmd.name} failed: ${err.message.slice(0, 80)}`); } catch (_) {}
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
    // A prefix command was typed but matched nothing — always reply so the user
    // gets feedback instead of a silent fall-through to AI chat.
    const { reply: _rp } = require("./baileysHelpers");
    await _rp(sock, msg, `🤔 *!${commandName}* isn't a command I know. Try *!help* to see what I can do.`);
    return;
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
  await react(sock, msg, "✨");

  const catEmoji = {
    meta: "🛠️", admin: "👑", group: "👥", utility: "🔧", fun: "🎲",
    anime: "🎬", economy: "💰", dev: "💻",
    games: "🎮", music: "🎵", ai: "🤖", research: "🔍",
  };

  const categories = {};
  for (const cmd of commands) {
    if (cmd.ownerOnly && !isOwner(ctx.senderJid)) continue;
    if (!categories[cmd.category]) categories[cmd.category] = [];
    categories[cmd.category].push(cmd);
  }

  const want = args?.trim().toLowerCase();
  const keys = want && categories[want] ? [want] : Object.keys(categories);

  const total = commands.length;
  const tag = isOwner(ctx.senderJid) ? "dad" : "bestie";

  // Stylish, ARIA-flavored menu header + a call-to-action
  const parts = [
    `╭── ✨ *ARIA* ✨ ──╮`,
    `_Hey ${tag}, I've got ${total} tricks up my sleeve._`, ``,
  ];
  for (const cat of keys) {
    const cmds = categories[cat].slice().sort((a, b) => a.name.localeCompare(b.name));
    const emoji = catEmoji[cat] || "📦";
    parts.push(`${emoji} *${cat.charAt(0).toUpperCase() + cat.slice(1)}*`);
    for (const cmd of cmds) {
      const aliases = cmd.aliases.length > 0 ? ` _(${cmd.aliases[0]})_` : "";
      parts.push(`  ▸ !${cmd.name}${aliases} — ${cmd.description}`);
    }
    parts.push(``);
  }
  if (want && !categories[want]) {
    return reply(sock, msg, `🤨 *${want}?* Never heard of that category, ${tag}. Try one of these:\n${Object.keys(categories).map(c=>`▸ ${c}`).join("\n")}`);
  }
  parts.push(`╰────────────────╯`);
  parts.push(`_Type !help <category> to see one section. Or just talk to me normally — I don't bite... much. 😌_`);
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
  if (result?.success === false) await reply(sock, msg, `❌ Kick failed: ${result.error}`);
  else await reply(sock, msg, "👢 User kicked.");
}

async function handlePromote(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the user.");
  const result = await promoteUser(sock, ctx.chatId, target);
  await react(sock, msg, "⭐");
  if (result?.success === false) await reply(sock, msg, `❌ Promote failed: ${result.error}`);
  else await reply(sock, msg, "⭐ User promoted to admin.");
}

async function handleDemote(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the user.");
  const result = await demoteUser(sock, ctx.chatId, target);
  await react(sock, msg, "⬇️");
  if (result?.success === false) await reply(sock, msg, `❌ Demote failed: ${result.error}`);
  else await reply(sock, msg, "⬇️ User demoted.");
}

async function handleTagAll(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const result = await tagAll(sock, msg, ctx.chatId, args || "📢 @everyone");
  // tagAll already sends the tagged message to the group; only reply on error.
  if (result?.success === false) await reply(sock, msg, `❌ ${result.error}`);
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

// ── Group message stats ─────────────────────────────────────
async function handleGroupTop(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const { formatTop } = require("../tools/groupStats");
  await reply(sock, msg, formatTop(ctx.chatId, args));
}

async function handleGroupActive(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const { formatActive } = require("../tools/groupStats");
  await reply(sock, msg, formatActive(ctx.chatId, args));
}

async function handleGroupInactive(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const { formatInactive } = require("../tools/groupStats");
  await reply(sock, msg, formatInactive(ctx.chatId, args));
}

async function handleGroupPurge(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  // CRITICAL: !purge removes members — only the owner or a real group admin may
  // issue it. Checking ctx.isGroup alone let any member kick everyone under the
  // threshold once the bot itself is an admin.
  const { isOwner } = require("../utils/permissions");
  const { isSenderAdmin } = require("../tools/groupAdmin");
  const callerIsOwner = isOwner(ctx.senderJid);
  const callerIsAdmin = callerIsOwner || await isSenderAdmin(sock, ctx.chatId, ctx.senderJid).catch(() => false);
  if (!callerIsAdmin) return reply(sock, msg, "❌ Only group admins can use !purge.");
  const { purgeInactive, formatPurgeResult } = require("../tools/groupStats");
  const n = parseInt(Array.isArray(args) ? args[0] : args, 10) || 5;
  await reply(sock, msg, `👢 Purging members under ${n} messages…`);
  const result = await purgeInactive(sock, ctx.chatId, args || 5);
  await reply(sock, msg, formatPurgeResult(result));
}

// ── Academy (adaptive learning) ─────────────────────────────
async function handleAcademy(sock, msg, args, ctx) {
  const { handleAcademyCommand } = require("../tools/academy/academyOrchestrator");
  await handleAcademyCommand(sock, msg, args, ctx);
}

async function handleAcademyRun(sock, msg, args, ctx) {
  const { handleAcademyRun } = require("../tools/academy/academyOrchestrator");
  await handleAcademyRun(sock, msg, args, ctx);
}

async function handleProject(sock, msg, args, ctx) {
  const { handleProjectCommand } = require("../tools/academy/academyOrchestrator");
  await handleProjectCommand(sock, msg, args, ctx);
}

async function handleIncident(sock, msg, args, ctx) {
  const { handleIncidentCommand } = require("../tools/academy/incidentSimulator");
  await handleIncidentCommand(sock, msg, args, ctx);
}

async function handleReview(sock, msg, args, ctx) {
  const { handleReviewCommand } = require("../tools/academy/reviewCourt");
  await handleReviewCommand(sock, msg, args, ctx);
}

async function handleDuel(sock, msg, args, ctx) {
  const { handleDuelCommand } = require("../tools/academy/duelMode");
  await handleDuelCommand(sock, msg, args, ctx);
}

async function handleSubmit(sock, msg, args, ctx) {
  const { handleSubmitCommand } = require("../tools/academy/duelMode");
  await handleSubmitCommand(sock, msg, args, ctx);
}

async function handleExplain(sock, msg, args, ctx) {
  const { handleExplainCommand } = require("../tools/academy/teachBack");
  await handleExplainCommand(sock, msg, args, ctx);
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
  const { reply, react, hasMedia, downloadMediaFromMsg, downloadQuotedMedia } = require("./baileysHelpers");
  await react(sock, msg, "🎴");
  // 1. Prefer media attached to the command message itself.
  let media = hasMedia(msg) ? await downloadMediaFromMsg(sock, msg) : null;
  // 2. Otherwise, grab media from the message this command is replying to.
  if (!media) media = await downloadQuotedMedia(sock, msg);
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
  // Parse "Question? | Opt1 | Opt2 | ..." into question + options array.
  const parts = args.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return reply(sock, msg, "❌ Need a question and at least 1 option. Usage: !poll Question? | Opt 1 | Opt 2");
  const question = parts[0];
  const options = parts.slice(1);
  const id = createPoll(question, options, ctx.senderJid, ctx.chatId);
  const optsText = options.map((o, i) => `${i + 1}. ${o}`).join("\n");
  await reply(sock, msg, `📊 *${question}*\n\n${optsText}\n\n_Vote by replying with the number._ Poll ID: \`${id}\``);
}

async function handleVote(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !vote <pollId> <number>");
  const [pollId, numStr] = args.trim().split(/\s+/);
  const optionIndex = parseInt(numStr, 10) - 1;
  const { vote, findPollByShortId } = require("../tools/polls");
  const poll = findPollByShortId(pollId);
  const id = poll ? poll.id : pollId;
  const result = vote(id, optionIndex, ctx.senderJid);
  await reply(sock, msg, result.success ? `🗳️ Voted for option ${parseInt(numStr, 10)}.` : `❌ ${result.error}`);
}

async function handlePollClose(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !pollclose <pollId>");
  const { closePoll, getPollResults, formatPoll } = require("../tools/polls");
  const pollId = args.trim().split(/\s+/)[0];
  const result = closePoll(pollId, ctx.senderJid);
  if (result && result.success === false) return reply(sock, msg, `❌ ${result.error}`);
  const display = formatPoll(pollId) || "Poll closed.";
  await reply(sock, msg, `🔒 Poll closed.\n\n${display}`);
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
  if (cmd === "list") {
    const list = listRecurringReminders(ctx.chatId);
    if (!list.length) return reply(sock, msg, "No recurring reminders in this chat. Set one with !recurring every day at 8am remind me to...");
    return reply(sock, msg, "🔁 *Recurring reminders:*\n" + list.map((r) => `• ${r.label} — \"${r.message}\" _(id: \`${r.id}\`)_`).join("\n"));
  }
  if (cmd?.startsWith("cancel")) {
    const id = parts[0]?.split(/\s+/)[1];
    if (!id) return reply(sock, msg, "Usage: !recurring cancel <id>");
    const ok = cancelRecurringReminder(id);
    return reply(sock, msg, ok ? "✅ Recurring reminder cancelled." : "❌ Couldn't find a reminder with that id. Use !recurring list to see ids.");
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
  // Try Jikan (MAL) first, fall back to AnimePahe, then OmniSave.
  let result = [];
  let source = "MyAnimeList";
  try { result = await searchAnime(args); } catch (_) {}
  if (!Array.isArray(result) || result.length === 0) {
    try { result = await searchAnimePahe(args); source = "AnimePahe"; } catch (_) {}
  }
  if (!Array.isArray(result) || result.length === 0) {
    try { result = await searchOmniSave(args); source = "OmniSave"; } catch (_) {}
  }
  if (!Array.isArray(result) || result.length === 0) {
    return reply(sock, msg, "❌ No anime found for that search. Try a different title.");
  }
  const text = result
    .slice(0, 8)
    .map((a) => {
      const hasId = a.id != null;
      return `*${a.title || a.titleEnglish || "?"}*\n  ${hasId ? `ID: ${a.id} · ` : ""}${a.type || "?"} · ${a.episodes || "?"} eps · ⭐${a.score || "?"}\n  ${a.synopsis || "Use !animeinfo for details."}`;
    })
    .join("\n\n");
  await reply(sock, msg, `🎬 *Anime Search: "${args}"* _(via ${source})_\n\n${text}\n\n_Use !animeinfo <id> for details, or !animedl <id> <episode> to download._`);
}

async function handleAnimeInfo(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !animeinfo <id or name>");
  await react(sock, msg, "📺");
  let result = null;
  try { result = await getAnimeDetails(args); } catch (_) {}
  if (!result && !/^\d+$/.test(args)) {
    try {
      const found = await searchAnime(args);
      if (found && found[0]) result = await getAnimeDetails(found[0].id);
    } catch (_) {}
  }
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
  if (!Array.isArray(result) || result.length === 0) {
    return reply(sock, msg, "❌ No episodes found for that anime id.");
  }
  const lines = result.slice(0, 30).map((e) => `Ep ${e.episode}: ${e.title || "—"}`).join("\n");
  await reply(sock, msg, `📋 *Episodes*\n\n${lines}\n\n_Use !animedl <animeId> <ep#> to download._`);
}

async function handleAnimePlay(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !animedl <anime name> <episode> [quality] — e.g. !animedl solo leveling ep1 720");
  await react(sock, msg, "⏬");

  // Optional quality token (360/480/720/1080/best) at the end.
  const qMatch = args.match(/\s(360|480|720|1080|best)\s*$/i);
  const quality = qMatch ? qMatch[1].toLowerCase() : "best";
  let baseArgs = qMatch ? args.slice(0, qMatch.index).trim() : args.trim();

  // Extract the episode number from ep1 / episode 1 / #1 / ' episode 1 '
  const epMatch = baseArgs.match(/(?:ep|episode|ep\.)?\s*#?\s*(\d{1,4})\s*$/i);
  const episode = epMatch ? parseInt(epMatch[1]) : NaN;
  if (!episode || episode < 1) {
    return reply(sock, msg, "🤨 Which episode? Try: !animedl solo leveling ep1 (or add 720/1080 for quality)");
  }

  // Strip the episode token from the name
  let name = baseArgs.replace(/(?:ep|episode)\s*#?\s*\d{1,4}\s*$/i, "").replace(/\s+$/, "").trim();
  if (!name) return reply(sock, msg, "🤨 What anime? Try: !animedl solo leveling ep1");

  // Enqueue as a background job so a heavy download can't block the message
  // queue. The job manager resolves the source (provider-by-provider, each
  // with its own ID), downloads, validates, cleans up and sends the file back
  // to this chat — reporting per-step telemetry as it goes.
  const { enqueueAnimeJob } = require("../tools/animeJobManager");
  const job = enqueueAnimeJob({
    name,
    episode,
    quality,
    sock,
    chatId: ctx.chatId,
    quotedMsg: msg,
  });
  // Track Continue Watching progress for this title.
  try {
    require("../tools/animeService").trackProgress({ id: "wa:" + name, provider: "whatsapp", title: name, episode, quality, status: "watching" });
  } catch (_) {}
  await reply(sock, msg, `⏳ *${name}* Ep ${episode} queued (job \`${job.id}\`)${quality !== "best" ? " at " + quality + "p" : ""}.\nI'll stream progress here and send the file when it's ready.`);
}

async function handleTrending(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🔥");
  const { getTrending } = require("../tools/animeExpanded");
  const result = await getTrending();
  await reply(sock, msg, typeof result === "string" ? result : JSON.stringify(result));
}

async function handleAnimeBrowser(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const base = process.env.WEB_URL || "http://localhost:3000";
  await reply(sock, msg, `🎬 *ARIA Anime Browser*\n\nBrowse, search, watchlist & download — all in one place.\n\n🔗 ${base}/dashboard/anime\n\n_Commands:_\n!anime search <name>\n!animedl <name> <ep#>\n!animelist — your watchlist`);
}

async function handleAnimeList(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const svc = require("../tools/animeService");
  const list = svc.loadWatchlist();
  if (!list.length) return reply(sock, msg, "❤️ Your watchlist is empty.\nAdd titles in the browser at /dashboard/anime, or search with !anime.");
  const lines = list.slice(0, 15).map((a, i) => `${i + 1}. ${a.title || "?"} ${a.rating ? "· ★" + a.rating : ""}`).join("\n");
  await reply(sock, msg, `❤️ *Your Anime Watchlist (${list.length})*\n\n${lines}\n\n_Manage it in the web browser._`);
}

async function handleHousehold(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const hh = require("../tools/household");
  const [cmd, ...rest] = (args || "").split(/\s+/);
  const id = ctx.chatId;

  if (!cmd) {
    const h = hh.getHousehold(id);
    if (!h) return reply(sock, msg, "No household in this chat yet.\n• *!household create <name>* to start one\n• *!household join* to join");
    const tasks = hh.listSharedTasks(id);
    const notes = hh.listSharedNotes(id);
    let t = `🏠 *${h.name}*\n👥 ${h.members.length} member(s)\n\n`;
    t += `*Shared tasks:*\n${tasks.length ? tasks.map((x, i) => `${i + 1}. ${x.done ? "✅" : "⬜"} ${x.text}`).join("\n") : "  (none — use !hhtask <text>)"}\n\n`;
    t += `*Shared notes:*\n${notes.length ? notes.slice(-5).map((n) => `• ${n.text}`).join("\n") : "  (none)"}`;
    return reply(sock, msg, t);
  }

  if (cmd === "create") {
    const name = rest.join(" ").trim() || "Household";
    const r = hh.createHousehold(id, ctx.senderJid, name);
    return reply(sock, msg, r.error ? `❌ ${r.error}` : `🏠 Household *${name}* created! Members can *!household join*.`);
  }
  if (cmd === "join") {
    const h = hh.getHousehold(id);
    if (!h) return reply(sock, msg, "No household here to join. *!household create <name>*");
    hh.addMember(id, ctx.senderJid);
    return reply(sock, msg, `✅ You joined *${h.name}*! Use *!hhtask <text>* to add shared tasks.`);
  }
  if (cmd === "leave") {
    hh.removeMember(id, ctx.senderJid, ctx.senderJid);
    return reply(sock, msg, "👋 You left the household.");
  }
  return reply(sock, msg, "Usage: !household [create <name>|join|leave]");
}

async function handleHHTask(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const hh = require("../tools/household");
  if (!args) return reply(sock, msg, "Usage: !hhtask <task text>");
  const r = hh.addSharedTask(ctx.chatId, ctx.senderJid, args.trim());
  if (r.error) return reply(sock, msg, `❌ ${r.error}`);
  await reply(sock, msg, `✅ Shared task added: \"${r.task.text}\" (id: \`${r.task.id}\`)`);
}

async function handleHHTasks(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const hh = require("../tools/household");
  const tasks = hh.listSharedTasks(ctx.chatId);
  if (!tasks.length) return reply(sock, msg, "No shared tasks yet. Add one with *!hhtask <text>*.");
  await reply(sock, msg, "🏠 *Shared tasks:*\n" + tasks.map((x, i) => `${i + 1}. ${x.done ? "✅" : "⬜"} ${x.text} _(id: \`${x.id}\`)_`).join("\n"));
}

async function handleHHDone(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const hh = require("../tools/household");
  const taskId = args?.trim();
  if (!taskId) return reply(sock, msg, "Usage: !hhdone <taskId>");
  const r = hh.toggleSharedTask(ctx.chatId, taskId);
  if (r.error) return reply(sock, msg, `❌ ${r.error}`);
  await reply(sock, msg, `${r.task.done ? "✅" : "⬜"} Task marked ${r.task.done ? "done" : "undone"}.`);
}

// ── Scenario simulator handler ────────────────────────────────
async function handleSim(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const { rehearse } = require("../tools/scenarioSimulator");
  if (!args) return reply(sock, msg, "Usage: !sim <action to evaluate>\nExample: !sim deploy this update to production\n\nDry-runs the action and shows the risk before you commit.");
  const result = await rehearse(args, "");
  await reply(sock, msg, result);
}

async function handleAiring(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "📡");
  const { getAiringAnime } = require("../tools/animeExpanded");
  const result = await getAiringAnime();
  await reply(sock, msg, result);
}

async function handleDeathBattle(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: `!deathbattle <charA> vs <charB>` — e.g. `!deathbattle goku vs saitama`");
  await react(sock, msg, "⚔️");

  // Optional: "!deathbattle video goku vs saitama" -> also render a fight video.
  const wantVideo = /^(video|vid|render)\b/i.test(args.trim());
  const fightInput = wantVideo ? args.replace(/^(video|vid|render)\b/i, "").trim() : args;

  await reply(sock, msg, wantVideo
    ? "⚔️ Loading the fighters... simulating + rendering the fight video 🎬"
    : "⚔️ Loading the fighters into the arena... simulating now 🧠");

  const { runDeathBattle } = require("../tools/deathBattle");
  const result = await runDeathBattle(fightInput);
  if (result.error) return reply(sock, msg, result.text);
  await reply(sock, msg, result.text);

  if (wantVideo) {
    await react(sock, msg, "🎬");
    await reply(sock, msg, "🎬 Rendering the fight as a motion-comic video... this can take a minute or two.");
    const { parseFighters } = require("../tools/deathBattle");
    const { createDeathBattleVideo } = require("../tools/deathBattleVideo");
    const fighters = parseFighters(fightInput);
    const winner = (result.text.match(/WINNER:\s*([^*\n]+)/i) || [])[1] || "";
    if (fighters) {
      const video = await createDeathBattleVideo(fighters.a, fighters.b, winner.trim());
      if (video.success) {
        await sock.sendMessage(ctx.chatId, { video: { url: video.filePath }, mimetype: "video/mp4", caption: `🎬 ${fighters.a} vs ${fighters.b} — WINNER: ${winner.trim()}` }, { quoted: msg });
        try { fs.unlinkSync(video.filePath); } catch (_) {}
        return;
      }
      await reply(sock, msg, "❌ Couldn't render the fight video this time (the free image generator was slow/unavailable). The verdict above still stands. Try again in a minute.");
    }
  }
}

// ── Research handlers (GitHub / Reddit / Wikipedia) ──────────
function formatResearchResult(result) {
  if (!result) return "❌ Nothing returned.";
  if (result.error) return "❌ " + result.error;
  return result.title + "\n\n" + result.body;
}

async function handleGitHub(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !github <thing> — e.g. !github whatwg html\n\nTip: use !releases owner/repo to get download links.");
  await react(sock, msg, "🐙");
  const { research } = require("../tools/sourceResearch");
  const result = await research({ source: "github", query: args });
  await reply(sock, msg, formatResearchResult(result));
}

async function handleGitHubReleases(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !releases owner/repo — e.g. !releases sharplab/yt-dlp");
  await react(sock, msg, "📦");
  const { research } = require("../tools/sourceResearch");
  const result = await research({ source: "releases", query: args });
  await reply(sock, msg, formatResearchResult(result));
}

async function handleReddit(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !reddit <thing> — e.g. !reddit cool photography\n  or scope it: !reddit r/photography cameras");
  await react(sock, msg, "🔴");
  const { research } = require("../tools/sourceResearch");
  // Support "r/sub <query>" syntax to scope the search.
  const m = args.match(/^(r\/[a-zA-Z0-9_]+)\s+(.+)$/i);
  const subreddit = m ? m[1] : null;
  const query = m ? m[2] : args;
  const result = await research({ source: "reddit", query, subreddit });
  await reply(sock, msg, formatResearchResult(result));
}

async function handleWikipedia(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !wikipedia <thing> — e.g. !wikipedia Albert Einstein");
  await react(sock, msg, "📖");
  const { research } = require("../tools/sourceResearch");
  const result = await research({ source: "wikipedia", query: args });
  if (result.error) return reply(sock, msg, "❌ " + result.error);
  // Clean info-card: photo (if available) + title + summary + link.
  let text = `${result.title}\n\n${result.body}`;
  if (result.url) text += `\n\n🔗 ${result.url}`;
  if (result.image) {
    try {
      await sock.sendMessage(ctx.chatId, { image: { url: result.image }, caption: text }, { quoted: msg });
      return;
    } catch (_) { /* fall back to text-only if image fails */ }
  }
  await reply(sock, msg, text);
}

// Dev handlers
// Format the modern buildProject result into a chat-friendly message.
function formatBuildResult(result) {
  if (!result) return "❌ Build returned nothing.";
  if (result.success === false) return "❌ " + (result.error || "Build failed.");
  if (result.paused) return result.message || "⏸️ Build paused — reply !continue to keep going.";
  if (result.success && result.downloadUrl) {
    let t = "✅ *Project built!*\n";
    if (result.fileCount) t += `📄 ${result.fileCount} file(s)\n`;
    if (result.warnings?.length) t += `⚠️ ${result.warnings.length} file(s) with warnings\n`;
    if (result.previewUrl) t += `🌐 Preview: ${result.previewUrl}\n`;
    t += `📦 Download: ${result.downloadUrl}`;
    return t;
  }
  return JSON.stringify(result).slice(0, 1500);
}

async function handleBuild(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !build <description of app>");
  await react(sock, msg, "🏗️");
  const result = await buildProject(args, ctx.senderName, ctx.chatId);
  await reply(sock, msg, formatBuildResult(result));
}

async function handleContinue(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "▶️");
  const result = await continueProject(ctx.chatId, ctx.senderName, null, args);
  await reply(sock, msg, formatBuildResult(result));
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
  const want = (args || "").trim().toLowerCase();
  // Respect explicit on/off; default to toggle when no arg or arg isn't on/off.
  let turnOn;
  if (want === "on") turnOn = true;
  else if (want === "off") turnOn = false;
  else turnOn = !has; // toggle

  if (!turnOn) {
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
    const r = await decideApproval(parts[1], "approve");
    return reply(sock, msg, r.ok ? "✅ " + r.msg : "❌ " + r.msg);
  }
  if (sub === "reject") {
    const r = await decideApproval(parts[1], "reject");
    return reply(sock, msg, r.ok ? "✅ " + r.msg : "❌ " + r.msg);
  }
  if (sub === "trace") {
    const m = getMission(parts[1]);
    if (!m) return reply(sock, msg, "Mission not found.");
    const trace = m.trace && m.trace.length ? m.trace : [];
    let out = `🧾 *Mission ${m.id} — execution trace*\n\n`;
    if (!trace.length) out += "(no trace entries yet)";
    else {
      for (const t of trace.slice(-25)) {
        const time = new Date(t.ts).toLocaleTimeString();
        const icon = t.type === "step_done" ? "✅" : t.type === "step_retry" ? "🔁" : t.type === "step_start" ? "▶️" : t.type === "plan" ? "📐" : t.type === "complete" ? "🏁" : t.type === "approval" ? "🛑" : "•";
        out += `${icon} [${time}] ${t.detail}\n`;
      }
    }
    return reply(sock, msg, out);
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
  // runSelfCheck returns an OBJECT ({success, noIssues, message} or
  // {success, diagnosis}), but reply() expects a string. Stringify it or the
  // command reacts 🔬 then silently sends nothing.
  if (typeof result === "string") {
    await reply(sock, msg, result);
  } else if (result && result.noIssues) {
    await reply(sock, msg, result.message || "✅ All clear.");
  } else if (result && result.diagnosis) {
    const d = result.diagnosis;
    // The AI is asked to return { diagnosis, file, proposedFix, confidence }.
    // Map those to the report (previously we read d.issue/d.summary/d.fix,
    // which the AI never produces, so the report came out "Unknown" + blank).
    const confidence = d.confidence ? ` · _${d.confidence}_` : "";
    const file = d.file ? `\n*File:* \`${d.file}\`` : "";
    const text = `🔍 *Self-check*${confidence}\n\n${d.diagnosis || d.issue || d.title || "No diagnosis."}${file}\n\n_Fix proposal:_ ${d.proposedFix || d.fix || "See pending fix."}`;
    await reply(sock, msg, text);
  } else if (result && result.error) {
    await reply(sock, msg, `⚠️ ${result.error}`);
  } else {
    await reply(sock, msg, "✅ Self-check complete — no action needed.");
  }
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
    const result = await buildProject(text, ctx.senderName, ctx.chatId);
    await reply(sock, msg, formatBuildResult(result));
  },
  github: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "🐙");
    const query = extractSourceQuery(text, /github|git hub/i);
    if (!query) return reply(sock, msg, "What should I look up on GitHub? E.g. \"look up whatwg html on github\"");
    const { research } = require("../tools/sourceResearch");
    const result = await research({ source: "github", query });
    await reply(sock, msg, formatResearchResult(result));
  },
  reddit: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "🔴");
    const query = extractSourceQuery(text, /reddit/i);
    if (!query) return reply(sock, msg, "What should I look up on Reddit? E.g. \"look up cool photography on reddit\"");
    const m = query.match(/^(r\/[a-zA-Z0-9_]+)\s+(.+)$/i);
    const subreddit = m ? m[1] : null;
    const q = m ? m[2] : query;
    const { research } = require("../tools/sourceResearch");
    const result = await research({ source: "reddit", query: q, subreddit });
    await reply(sock, msg, formatResearchResult(result));
  },
  wikipedia: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "📖");
    const query = extractSourceQuery(text, /wikipedia|wiki/i);
    if (!query) return reply(sock, msg, "What should I look up on Wikipedia? E.g. \"look up quantum computing on wikipedia\"");
    const { research } = require("../tools/sourceResearch");
    const result = await research({ source: "wikipedia", query });
    if (result.error) return reply(sock, msg, "❌ " + result.error);
    let t = `${result.title}\n\n${result.body}`;
    if (result.url) t += `\n\n🔗 ${result.url}`;
    if (result.image) {
      try { await sock.sendMessage(ctx.chatId, { image: { url: result.image }, caption: t }, { quoted: msg }); return; } catch (_) {}
    }
    await reply(sock, msg, t);
  },
  deathBattle: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    await react(sock, msg, "⚔️");
    // Extract "A vs B" / "A or B" / "A and B" from the phrase.
    let cleaned = text
      .replace(/^(aria|hey aria|aria,)?\s*(who would win|who wins|would|beat|between|death battle|deathbattle)\s*/i, "")
      .replace(/\b(in a fight|fight between|in a death battle)\b.*$/i, "")
      .replace(/\b(would|will|who|win|wins)\b/gi, "")
      .replace(/[\?\.!]+/g, "")
      .replace(/\b(or|and|beat|v\.?s\.?|versus|vs)\b/gi, " vs ")
      .replace(/\s+/g, " ")
      .trim();
    if (!/vs/i.test(cleaned)) {
      // Fallback: "goku or saitama" -> "goku vs saitama"
      cleaned = cleaned.replace(/\b(?:or|and)\b/gi, " vs ");
    }
    if (!/ vs /i.test(cleaned)) {
      return reply(sock, msg, "Tell me who's fighting, e.g. \"who would win: goku or saitama\"");
    }
    const { runDeathBattle } = require("../tools/deathBattle");
    const result = await runDeathBattle(cleaned);
    await reply(sock, msg, result.text);
  },
};

// Pull the actual search term out of "look up X on github" style phrasing.
// Handles: "X on github", "look up X on github", "X on wikipedia", etc.
function extractSourceQuery(text, sourceRe) {
  let t = text.trim();
  // Drop leading address + verb noise.
  t = t.replace(/^(aria|hey aria|aria,)?\s*(please\s*)?(can you\s*)?(look up|look|search|find|check|google)\s*(it|up|for)?\s*/i, "");
  // Wrap the source in a non-capturing group so an alternation like
  // "github|git hub" doesn't leak `|` into the surrounding pattern.
  const src = "(?:" + sourceRe.source + ")";
  // If there's "<source> <query>" (source first), drop the source token.
  t = t.replace(new RegExp("^(?:on|in)?\\s*" + src + "\\s+(?:about|for|on)?\\s*", "i"), "");
  // If there's "<query> <source>" (source last), drop the trailing source clause.
  t = t.replace(new RegExp("\\s+(?:on|in|at)\\s*" + src + "\\s*$", "i"), "");
  // Clean leftover connector words.
  t = t.replace(/^(about|for|on|in|about it|for it|on it|it)\s+/i, "").replace(/\s+(about|for|on|in)\s*$/i, "").trim();
  return t;
}

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
  // Media memory (images/voice ARIA has seen) — pulled into context for awareness.
  let mediaContext = "";
  try {
    const { recallMedia } = require("../tools/mediaMemory");
    const mediaMem = recallMedia(ctx.senderJid, text, 3);
    if (mediaMem.length) {
      mediaContext = "\n\n[Media I've seen/heard that's relevant:] " + mediaMem.map((m) => `(${m.kind}) ${m.summary}`).join(" | ");
    }
  } catch (_) {}
  // World Model: inject the structured entity-relationship context
  const { getWorldContext, extractFromMessage } = require("../utils/worldModel");
  const worldContext = getWorldContext(ctx.senderJid);
  const personalizationContext = "\n\n[Personalization] Learn their name if they give it, match their communication style naturally, and remember important things they share.\n";

  const response = await getAIResponse(text, ctx.senderName, memory, null, quotedText, {
    userContext: userContext + ownerContext + moodContext + personaContext + toneContext + semanticContext + mediaContext + worldContext + personalizationContext,
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

// ── Plugin marketplace command handlers ──────────────────────
async function handlePluginsList(sock, msg, args, context) {
  const { listInstalled } = require("../tools/pluginMarket");
  const list = listInstalled();
  if (!list.length) return reply(sock, msg, "No plugins installed.");
  const lines = list.map((p) => `• *${p.id}* — ${p.enabled ? "enabled" : "disabled"}${p.info?.version ? ` (v${p.info.version})` : ""}`);
  return reply(sock, msg, `*Installed plugins:*\n${lines.join("\n")}`);
}

async function handlePluginInstall(sock, msg, args, context) {
  const name = (args || "")[0];
  if (!name) return reply(sock, msg, "Usage: !install <plugin-name>");
  const { installPlugin } = require("../tools/pluginMarket");
  const r = await installPlugin(name);
  return reply(sock, msg, r.success ? `✅ Installed *${name}*. Restart to load it.` : `❌ ${r.error}`);
}

async function handlePluginUpdate(sock, msg, args, context) {
  const name = (args || "")[0];
  if (!name) return reply(sock, msg, "Usage: !update <plugin-name>");
  const { updatePlugin } = require("../tools/pluginMarket");
  const r = await updatePlugin(name);
  return reply(sock, msg, r.success ? `✅ Updated *${name}*. Restart to load it.` : `❌ ${r.error}`);
}

async function handlePluginEnable(sock, msg, args, context) {
  const name = (args || "")[0];
  if (!name) return reply(sock, msg, "Usage: !enable <plugin-name>");
  const { setPluginState } = require("../tools/pluginMarket");
  setPluginState(name, true);
  return reply(sock, msg, `✅ Enabled *${name}*.`);
}

async function handlePluginDisable(sock, msg, args, context) {
  const name = (args || "")[0];
  if (!name) return reply(sock, msg, "Usage: !disable <plugin-name>");
  const { setPluginState } = require("../tools/pluginMarket");
  setPluginState(name, false);
  return reply(sock, msg, `✅ Disabled *${name}*.`);
}

module.exports = {
  routeMessage,
  registerCommand,
  commands,
  detectIntent,
  triggeredByName,
};
