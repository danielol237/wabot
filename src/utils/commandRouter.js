// Command Router + Intent Parser for ARIA WhatsApp Bot
// Extracted from the monolithic messageHandler.js to make adding features
// a matter of registering a command, not touching a 1600-line file.

// ── Imports ──────────────────────────────────────────────────
const axios = require("axios");
const fs = require("fs");
const { getStats, getRecentErrors, logError, broadcastToAll } = require("../tools/botAdmin");
const { isBotAdmin, isSenderAdmin, kickUser, addUser, promoteUser, demoteUser, tagAll, hideTag } = require("../tools/groupAdmin");
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
const { trackInteraction } = require("../utils/userMemory");
const { addPreference, getPreferences, clearPreferences } = require("../utils/userPreferences");
const { learnFact, getFacts, forgetFact } = require("../utils/learnedFacts");
const { getMemory, saveMemory } = require("../utils/memory");
const { getUserStore, getProfile, memoryEnabled } = require("../utils/semanticMemory");
const { extractFromMessage } = require("../utils/worldModel");
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
const { error } = require("./logger");
const { generateIdCard, extractDetails, getMissingFields, detectCountry, autoGenerateIdNumber } = require("../tools/idCard");

const ID_CARD_SESSION_TTL_MS = 15 * 60 * 1000;
const idCardSessions = new Map();
function getIdCardSession(sessionId) {
  const session = idCardSessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) idCardSessions.delete(sessionId);
    return null;
  }
  return session;
}
function saveIdCardSession(sessionId, session) {
  idCardSessions.set(sessionId, { ...session, expiresAt: Date.now() + ID_CARD_SESSION_TTL_MS });
}

const { isNsfwEnabled, setNsfw } = require("./botSettings");
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
const { listCapabilities } = require("./capabilityCatalog");

const { setReminder } = require("../tools/reminders");
const { buildProject, deployProject, publishProjectToGitHub, getProjectStatus, listProjects, cancelProject, thinkAboutProject, editProjectFile, autoUpgradeProject } = require("../tools/appBuilder");
const { deliverWebsite } = require("../tools/deliveryWorkflow");
const { handleEngineeringRequest } = require("../tools/engineeringSystem");
const { registerPasquaCommands } = require("../tools/pasquaCommands");
const { handleAriaLifeFeature } = require("../tools/ariaLifeFeatures");
const businessMode = require("../tools/businessMode");

const BOT_NAME = (process.env.BOT_NAME || "aria").toLowerCase();
// Natural-language routing is the default. The legacy prefix remains accepted
// as a compatibility path so existing chats and scheduled instructions survive.
const PREFIX = String(process.env.BOT_PREFIX || "").trim().toLowerCase();
const LEGACY_PREFIX = "!";

function getMatchedPrefix(lower) {
  return [PREFIX, LEGACY_PREFIX].filter(Boolean).sort((a, b) => b.length - a.length).find((prefix) => lower.startsWith(prefix)) || "";
}

const NAME_TRIGGERS = [
  BOT_NAME, BOT_NAME + ",", BOT_NAME + "!",
  "hey " + BOT_NAME, "ok " + BOT_NAME, "yo " + BOT_NAME,
];

// ── Intent patterns ──────────────────────────────────────────
const INTENTS = {
  nsfw: ["turn on nsfw", "enable nsfw", "nsfw on", "activate nsfw"],
  image: ["generate an image", "generate a picture", "generate a pic", "create an image", "create a picture", "create a pic", "make an image", "make a picture", "make a pic", "draw me", "draw a", "imagine a", "imagine an", "paint a", "paint me", "design an image", "give me an image", "show me a picture"],
  video: ["generate a video", "generate me a video", "generate my video", "create a video", "create me a video", "make a video", "make me a video", "animate this", "create an animation"],
  music: ["generate music", "generate a song", "make music", "make a song", "create music", "create a song", "compose music", "compose a song", "make a beat", "make me a beat", "create a soundtrack"],
  search: ["search for", "look up", "google", "search the web", "find info on"],
  download: ["download", "please download", "download this link", "download the link", "download this video", "download the video", "download this clip", "download this reel", "dl this", "get this video", "get me this video", "send me the video", "save this", "save this video"],
  scrape: ["read this link", "open this link", "check this site", "visit", "browse", "summarize this link", "what's on this site"],
  remind: ["remind me", "set a reminder", "alert me", "notify me in"],
  help: ["help", "show commands", "what can you do", "what do you do", "menu"],
  memories: ["what do you remember", "show me what you remember", "my memories", "your memories"],
  remember: ["remember that", "remember this", "keep in mind that", "keep in mind", "don't forget that", "do not forget that", "put this in your memory", "save this to memory", "store this in memory"],
  atlas: ["this is a project", "this is my project", "new project", "add this to", "add that to", "what is next", "what's next", "what is blocking us", "what's blocking us", "project brief", "give me the project brief", "take the next safe step", "why did you choose this", "morning brief", "morning briefing", "add a task", "create a task", "record a decision", "log a decision", "plan this project", "plan this", "plan it", "make a plan", "break this down", "break the project down", "plan the project", "make a roadmap", "build a roadmap", "show the roadmap", "show the plan", "view the dependencies", "show the risks", "apply the plan", "approve the plan", "show sentinel", "sentinel status", "enable sentinel", "disable sentinel", "show project signals", "project signals", "what changed in the project", "what changed on the project", "show decision briefs", "acknowledge signal", "resolve signal", "approve brief", "diagnose integrations", "diagnose integration", "inspect integrations", "check the webhook", "check the connection", "webhook status", "integration health", "delivery diagnostics", "show delivery diagnostics", "execute the next safe step", "execute the next step", "take the next safe step", "start execution", "start research run", "start a research run", "start design run", "start a design run", "start build run", "start a build run", "start verify run", "start a verify run", "start release run", "start a release run", "start a research execution", "start a design execution", "start a build execution", "start a verify execution", "start a release execution", "show execution status", "pause execution", "approve execution", "reject execution", "what evidence is missing", "missing execution evidence", "propose recovery", "retrospect this run", "start an operator team", "start a team", "start a research team", "start a verify team", "delegate this to the team", "show team status", "show team handoff", "show the current team handoff", "approve team", "reject team", "pause the operator team", "resume the operator team", "retry the team", "recover the team", "why is the team blocked", "review the operator team", "review release readiness", "retrospect the operator team", "show connected delivery", "connected delivery status", "show delivery status", "is the release ready", "release readiness", "show deployment evidence", "show delivery proposals", "map github repository", "connect github", "connect render", "what failed in github", "what failed in render", "approve delivery", "approve delivery_", "reject delivery", "reject delivery_", "resolve delivery", "resolve delivery_", "show the project knowledge graph", "show project knowledge", "what supports this requirement", "what is blocking this project", "show stale project knowledge", "show conflicts in the project", "what conflicts in the project", "trace this artifact", "link this evidence to the release decision", "record this as a project requirement", "add this artifact to the project vault", "what changed in the project knowledge", "knowledge graph", "project knowledge", "artifact vault", "atlas"],
  links: ["give me the dashboard link", "give me link to dashboard", "link to dashboard", "open dashboard", "open the dashboard", "show me the dashboard", "dashboard link", "anime website", "open the anime website", "show me the anime website", "anime site", "give me the anime link", "give me link to anime website", "links"],
  anime: ["find anime", "search anime", "show me anime", "anime"],
  project: ["start a project", "create a learner project", "start a capstone"],
  mission: ["start a mission", "create a mission", "run a mission"],
  poll: ["create a poll", "make a poll"],
  sticker: [
    "make this a sticker", "make this sticker", "make it a sticker", "make that a sticker",
    "make a sticker from this", "make a sticker out of this", "create a sticker from this",
    "sticker this", "stickerize this", "stickerise this",
    "turn into sticker", "turn this into a sticker", "turn it into a sticker", "turn that into a sticker",
    "convert this to a sticker", "convert it to a sticker", "convert this into a sticker", "convert it into a sticker",
    "turn this gif into a sticker", "make this gif a sticker", "make this video a sticker", "make this image a sticker",
    "create sticker", "create a sticker", "make whatsapp sticker",
  ],
  voiceGenerate: ["generate a voice", "generate voice", "generate speech", "create a voice", "create speech", "make a voice", "make audio", "generate audio", "create audio", "narrate this"],
  voiceReply: ["say this", "voice note", "speak this", "read this out", "say it out loud"],
  translate: ["translate", "say this in", "how do you say"],
  weather: ["weather in", "weather for", "what's the weather"],
  news: ["news about", "latest news", "news on", "what's happening with"],
  agent: ["figure out", "plan and", "research and", "find and compare", "deep dive on"],
  engineering: ["what modules do you have installed", "which modules do you have installed", "inspect your system", "inspect your capabilities", "show your capabilities", "show your installed modules", "list my github repos", "show my github repositories", "check my github repos", "check my repos", "check repos", "show my github repositories", "show my repositories", "show my repos", "what github repos do i have", "what repositories do i have", "check my github repo", "check my repo", "inspect my repo", "look at my repo", "use my github repo", "select my github repo", "switch to my github repo", "clear my github workspace", "propose an upgrade", "plan an upgrade", "upgrade yourself", "improve your system", "implement this in your system", "verify the upgrade", "open a github pr for the upgrade", "merge the upgrade", "merge upgrade", "change your dashboard", "change your dashboard ui", "change the dashboard", "change dashboard", "update the dashboard", "change the dashboard ui", "change dashboard ui", "improve the android companion app", "edit my github repo", "change my github repo", "make changes in my github repo", "fix my github repo", "push directly to main"],
  delegate: ["delegate", "delegate this", "orchestrate", "hand this off"],
  build: ["build", "build me a", "build an app", "build a website", "create an app", "create a website", "make me an app", "make me a website", "code me", "create a project"],
  hidetag: ["hidetag", "hide tag", "hide-tag", "tag everyone silently", "mention everyone silently", "silently tag everyone"],
  tagall: ["tag everyone", "tag everybody", "tag all members", "mention everyone", "mention everybody", "mention all members"],
  deploy: ["deploy", "deploy it", "deploy through vercel", "host it", "host this", "host through vercel", "publish it", "put it online", "push to github", "push this to github", "push the project to github", "push the verified project to github", "create a github repo", "publish on github", "upload to github", "send it to github"],
  edit: ["edit", "edit this", "change the file", "update the file", "fix the file"],
  github: ["on github", "look on github", "github search", "search github", "search on github", "look up on github", "find it on github", "git hub"],
  reddit: ["on reddit", "look on reddit", "reddit search", "search reddit", "find it on reddit"],
  wikipedia: ["on wikipedia", "wikipedia search", "search wikipedia", "on wiki", "wikipedia about"],
  deathBattle: ["who would win", "who wins", "death battle", "deathbattle", "would beat", "in a fight", "fight between"],
  echolocation: ["echo location", "search all my conversations", "search my past conversations", "find in my conversations"],
  timecapsule: ["time capsule", "send this to me later", "remind future me", "save this for later"],
  mirrorreport: ["the mirror", "mirror report", "analyze my personality", "write my personality report"],
  memorypalace: ["memory palace", "show my conversation graph", "show my memory graph"],
  secondbrain: ["second brain", "save a note", "show my notes", "connect my notes"],
  dreamcatcher: ["dream catcher", "log my dream", "record my dream", "show my dreams"],
  paralleluniverse: ["parallel universe", "what if i", "imagine my life if"],
  soulsearch: ["soul search", "write my biography", "tell my life story"],
  emotiontimeline: ["emotion timeline", "show my mood timeline", "track my emotions"],
  oracle: ["the oracle", "predict my next move", "what will i do next"],
};

// ── Command registry ─────────────────────────────────────────
// Each entry: { name, aliases, category, handler, ownerOnly, description }
const commands = [];

function registerCommand(cmd) {
  commands.push(cmd);
}

function lifeFeatureHandler(feature) {
  return (sock, msg, args, ctx) => handleAriaLifeFeature(sock, msg, args, { ...ctx, ariaFeature: feature });
}

// Built-in commands - these are the standard prefix commands
function registerBuiltinCommands() {
  // Admin / Meta
registerCommand({ name: "nsfw", category: "meta", description: "Toggle NSFW mode: !nsfw on/off", handler: handleNsfw, ownerOnly: false });
registerCommand({ name: "alive", aliases: ["ping", "test"], category: "meta", description: "Check if bot is alive", handler: handleAlive, ownerOnly: false });
  registerCommand({ name: "help", aliases: ["menu", "commands", "h"], category: "meta", description: "Show help menu", handler: handleHelp, ownerOnly: false });
  registerCommand({ name: "stats", aliases: ["botstats"], category: "admin", description: "Show bot statistics", handler: handleStats, ownerOnly: true });
  registerCommand({ name: "errors", aliases: ["errorlog"], category: "admin", description: "Show recent errors", handler: handleErrors, ownerOnly: true });
  registerCommand({ name: "broadcast", aliases: ["bc", "announce"], category: "admin", description: "Broadcast message to all chats", handler: handleBroadcast, ownerOnly: true });
  registerCommand({ name: "admin", aliases: ["setadmin"], category: "admin", description: "Add/remove bot admin", handler: handleAdmin, ownerOnly: true });
  registerCommand({ name: "ban", aliases: [], category: "admin", description: "Ban a user", handler: handleBan, ownerOnly: true });
  registerCommand({ name: "unban", aliases: [], category: "admin", description: "Unban a user", handler: handleUnban, ownerOnly: true });

  // Group admin
  registerCommand({ name: "kick", aliases: ["remove"], category: "group", description: "Kick a member", handler: handleKick, ownerOnly: false });
  registerCommand({ name: "close", aliases: ["lockgroup", "closegc"], category: "group", description: "Close the group so only admins can message (GC admins + bot admin)", handler: handleClose, ownerOnly: false });
  registerCommand({ name: "open", aliases: ["unlockgroup", "opengc"], category: "group", description: "Reopen the group so everyone can message (GC admins + bot admin)", handler: handleOpen, ownerOnly: false });
  registerCommand({ name: "add", aliases: ["invite", "addmember"], category: "group", description: "Add a member to the group by number: !add <number>", handler: handleAddMember, ownerOnly: false });
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
  registerCommand({ name: "resetwarns", aliases: ["clearwarns", "clearwarn"], category: "group", description: "Reset warnings", handler: handleResetWarns, ownerOnly: false });

  // Group message stats / moderation
  registerCommand({ name: "top", aliases: ["leaderboard", "topmsgs"], category: "group", description: "Top talkers in this group: !top [N]", handler: handleGroupTop, ownerOnly: false });
  registerCommand({ name: "active", aliases: ["actives", "listactive"], category: "group", description: "Active members (>= N msgs): !active [N]", handler: handleGroupActive, ownerOnly: false });
  registerCommand({ name: "inactive", aliases: ["inactives", "dead", "listinactive"], category: "group", description: "Inactive members (< N msgs): !inactive [N]", handler: handleGroupInactive, ownerOnly: false });
  registerCommand({ name: "purge", aliases: ["prune"], category: "group", description: "Kick members under N msgs: !purge [N]", handler: handleGroupPurge, ownerOnly: false });

  // Academy (adaptive learning system)
  registerCommand({ name: "academy", aliases: ["study", "school"], category: "utility", description: "Adaptive coding academy: pick a track + level", handler: handleAcademy, ownerOnly: false });
  registerCommand({ name: "run", aliases: ["execute", "practice"], category: "utility", description: "Run code for a challenge: !run <code>", handler: handleAcademyRun, ownerOnly: false });
  registerCommand({ name: "project", aliases: ["capstone"], category: "utility", description: "Start a track project: !project <track> <level>", handler: handleProject, ownerOnly: false });
  registerCommand({ name: "incident", aliases: ["oncall", "sre"], category: "utility", description: "Production incident simulator: diagnose + fix", handler: handleIncident, ownerOnly: false });
  registerCommand({ name: "review", aliases: ["codereview", "court"], category: "utility", description: "AI code review court: !review <code>", handler: handleReview, ownerOnly: false });
  registerCommand({ name: "duel", aliases: ["vs", "challenge"], category: "utility", description: "AI-vs-human duel: !duel <problem>", handler: handleDuel, ownerOnly: false });
  registerCommand({ name: "submit", aliases: ["mycode"], category: "utility", description: "Submit your duel solution: !submit <code>", handler: handleSubmit, ownerOnly: false });
  registerCommand({ name: "explain", aliases: ["teach", "teachback"], category: "utility", description: "Teach-it-back: explain a concept, ARIA grades + finds misconceptions", handler: handleExplain, ownerOnly: false });
  registerCommand({ name: "recall", aliases: ["reviewdue", "spaced"], category: "utility", description: "Recall engine: shows which skills are due for review", handler: handleRecall, ownerOnly: false });
  registerCommand({ name: "dna", aliases: ["roadmap", "career", "profile"], category: "utility", description: "Engineering DNA + career roadmap over your learner model", handler: handleDna, ownerOnly: false });
  registerCommand({ name: "company", aliases: ["startup", "ceo"], category: "utility", description: "Company simulator: run a software company on your real skills", handler: handleCompany, ownerOnly: false });
  registerCommand({ name: "level", aliases: ["xp", "rank"], category: "utility", description: "Your XP level, title, progress & breakdown", handler: handleLevel, ownerOnly: false });
  registerCommand({ name: "academyboard", aliases: ["lb", "aleaderboard"], category: "utility", description: "Global academy leaderboard by XP", handler: handleAcademyLeaderboard, ownerOnly: false });
  registerCommand({ name: "digest", aliases: ["learning", "weekly"], category: "utility", description: "Your weekly learning digest: !digest", handler: handleLearningDigest, ownerOnly: false });
  registerCommand({ name: "learner", aliases: ["myspot", "learnerspace"], category: "utility", description: "Your ARIA Learner Space: !learner", handler: handleLearnerSpace, ownerOnly: false });
  registerCommand({ name: "portal", aliases: ["academyportal", "learnportal"], category: "utility", description: "Open and link your ARIA learner portal", handler: handlePortal, ownerOnly: false });

  // Media / Creative
  registerCommand({ name: "imagine", aliases: ["img", "draw"], category: "creative", description: "Generate an image with AI", handler: handleImageGen, ownerOnly: false });
  registerCommand({ name: "sticker", aliases: ["s"], category: "creative", description: "Make a sticker from an image", handler: handleStickerCommand, ownerOnly: false });
  registerCommand({ name: "carbon", aliases: ["codeimg"], category: "creative", description: "Render code as image", handler: handleCarbon, ownerOnly: false });
  registerCommand({ name: "wallpaper", aliases: ["wall", "wp"], category: "creative", description: "Search wallpapers", handler: handleWallpaper, ownerOnly: false });

  // Utility
  registerCommand({ name: "search", aliases: ["web", "google"], category: "utility", description: "Search the web", handler: handleSearch, ownerOnly: false });
  registerCommand({ name: "download", aliases: ["dl"], category: "utility", description: "Download public media from a URL", handler: handleDownload, ownerOnly: false });
  registerCommand({ name: "play", aliases: ["music", "song"], category: "utility", description: "Play a song: !play <song name>", handler: handlePlayMusic, ownerOnly: false });
  registerCommand({ name: "yt", aliases: ["youtube", "ytdl", "video"], category: "utility", description: "Download a video: !yt <url>", handler: handleYtDownload, ownerOnly: false });
  registerCommand({ name: "tiktok", aliases: ["tok"], category: "utility", description: "Download a TikTok video: !tiktok <url>", handler: handleYtDownload, ownerOnly: false });
  registerCommand({ name: "ig", aliases: ["instagram", "igdl"], category: "utility", description: "Download an Instagram post/reel: !ig <url>", handler: handleYtDownload, ownerOnly: false });
  // NOTE: !run is claimed by the academy challenge runner (registered earlier).
  // The generic code executor gets its own name so it isn't silently shadowed.
  registerCommand({ name: "exec", aliases: ["code"], category: "utility", description: "Execute code: !exec <code>", handler: handleCode, ownerOnly: true });
  registerCommand({ name: "shell", aliases: ["terminal", "bash"], category: "admin", description: "Run an owner-only shell command on the Wabot host", handler: handleShell, ownerOnly: true });
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
  registerCommand({ name: "cardboard", aliases: ["cboard", "carlb"], category: "fun", description: "View card leaderboard", handler: handleCardLeaderboard, ownerOnly: false });

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
  registerCommand({ name: "wikipedia", aliases: ["wiki"], category: "research", description: "Search Wikipedia: !wikipedia <thing>", handler: handleWikipedia, ownerOnly: false });

  // Pokémon

  // Household / shared mode
  registerCommand({ name: "household", aliases: ["hh", "family"], category: "utility", description: "Household: create/join/manage shared space", handler: handleHousehold, ownerOnly: false });
  registerCommand({ name: "hhtask", aliases: ["hht"], category: "utility", description: "Add a shared household task", handler: handleHHTask, ownerOnly: false });
  registerCommand({ name: "hhtasks", aliases: ["hhts"], category: "utility", description: "List shared household tasks", handler: handleHHTasks, ownerOnly: false });
  registerCommand({ name: "hhdone", aliases: ["hhd"], category: "utility", description: "Mark a shared task done: !hhdone <id>", handler: handleHHDone, ownerOnly: false });

  // Scenario simulator (risk dry-run before actions)
  registerCommand({ name: "sim", aliases: ["rehearse", "risk"], category: "utility", description: "Dry-run an action and see risk: !sim <action>", handler: handleSim, ownerOnly: false });

  // Dev / Advanced
  registerCommand({ name: "build", aliases: [], category: "dev", description: "Build a complete app from a description", handler: handleBuild, ownerOnly: true });
  registerCommand({ name: "deliver", aliases: ["buildsite"], category: "dev", capability: "project.deliver", description: "Build, verify, deploy, screenshot, and send a website", handler: handleDeliver, ownerOnly: true });
  registerCommand({ name: "engineering", aliases: ["engineer", "selfupgrade", "upgrade"], category: "dev", description: "Inspect ARIA and prepare guarded GitHub upgrades", handler: handleEngineering, ownerOnly: false });
  registerCommand({ name: "deploy", aliases: ["host", "publish"], category: "dev", description: "Deploy the verified project to Vercel", handler: handleDeploy, ownerOnly: true });
  registerCommand({ name: "status", aliases: [], category: "dev", description: "Project status: !status <id>", handler: handleProjectStatus, ownerOnly: false });
  registerCommand({ name: "projects", aliases: ["mylist"], category: "dev", description: "List projects", handler: handleProjectList, ownerOnly: false });
  registerCommand({ name: "cancelbuild", aliases: ["cancel"], category: "dev", description: "Cancel a project", handler: handleProjectCancel, ownerOnly: true });
  registerCommand({ name: "edit", aliases: [], category: "dev", description: "Edit a project file", handler: handleEditFile, ownerOnly: true });
  registerCommand({ name: "projectrecall", aliases: ["site", "website"], category: "dev", description: "Recall a saved website project", handler: handleProjectRecall, ownerOnly: true });
  registerCommand({ name: "projectupgrade", aliases: ["autoupgrade", "polishsite"], category: "dev", description: "Auto-upgrade a saved website", handler: handleProjectUpgrade, ownerOnly: true });
  registerCommand({ name: "think", aliases: [], category: "dev", description: "Think about a project", handler: handleThink, ownerOnly: true });
  registerCommand({ name: "fix", aliases: ["debug"], category: "dev", description: "Debug code", handler: handleDebugCode, ownerOnly: true });
  registerCommand({ name: "remember", aliases: [], category: "dev", description: "Remember a preference", handler: handleRemember, ownerOnly: false });
  registerCommand({ name: "preferences", aliases: ["myprefs"], category: "dev", description: "View preferences", handler: handlePreferences, ownerOnly: false });
  registerCommand({ name: "clearprefs", aliases: ["resetprefs"], category: "dev", description: "Clear preferences", handler: handleClearPrefs, ownerOnly: false });
  registerCommand({ name: "voicemode", aliases: ["voice", "vm"], category: "dev", description: "Toggle voice replies", handler: handleVoiceMode, ownerOnly: false });
  registerCommand({ name: "memories", aliases: ["remembered", "mymemory"], category: "dev", description: "See what I remember about you", handler: handleMemories, ownerOnly: false });
  registerCommand({ name: "echolocation", aliases: ["echo", "searchmemory"], category: "owner", description: "Search stored conversation memory", handler: lifeFeatureHandler("echolocation"), ownerOnly: true });
  registerCommand({ name: "timecapsule", aliases: ["capsule", "timecaps"], category: "owner", description: "Seal an encrypted future message", handler: lifeFeatureHandler("timecapsule"), ownerOnly: true });
  registerCommand({ name: "mirrorreport", aliases: ["themirror"], category: "owner", description: "Write a private personality report", handler: lifeFeatureHandler("mirrorreport"), ownerOnly: true });
  registerCommand({ name: "memorypalace", aliases: ["palace", "memorygraph"], category: "owner", description: "Show a private conversation graph", handler: lifeFeatureHandler("memorypalace"), ownerOnly: true });
  registerCommand({ name: "secondbrain", aliases: ["notespace"], category: "owner", description: "Save and retrieve private notes", handler: lifeFeatureHandler("secondbrain"), ownerOnly: true });
  registerCommand({ name: "dreamcatcher", aliases: ["dreamlog", "dreams"], category: "owner", description: "Record private dreams", handler: lifeFeatureHandler("dreamcatcher"), ownerOnly: true });
  registerCommand({ name: "paralleluniverse", aliases: ["whatif", "alternatefuture"], category: "owner", description: "Explore a grounded alternate scenario", handler: lifeFeatureHandler("paralleluniverse"), ownerOnly: true });
  registerCommand({ name: "soulsearch", aliases: ["biography", "mybiography"], category: "owner", description: "Write a private grounded biography", handler: lifeFeatureHandler("soulsearch"), ownerOnly: true });
  registerCommand({ name: "emotiontimeline", aliases: ["moodtimeline", "emotionlog"], category: "owner", description: "View private logged mood signals", handler: lifeFeatureHandler("emotiontimeline"), ownerOnly: true });
  registerCommand({ name: "oracle", aliases: ["nextmove", "behaviororacle"], category: "owner", description: "Generate cautious behavior hypotheses", handler: lifeFeatureHandler("oracle"), ownerOnly: true });
  registerCommand({ name: "mission", aliases: ["missions", "msn"], category: "dev", description: "Create/resume durable background missions", handler: handleMission, ownerOnly: true });
  registerCommand({ name: "world", aliases: ["worldmodel", "model"], category: "dev", description: "View ARIA's world model", handler: handleWorld, ownerOnly: true });
  registerCommand({ name: "delegate", aliases: ["orbit", "orchestrate"], category: "dev", description: "Run the agent-team mission orchestrator", handler: handleDelegate, ownerOnly: true });
  registerCommand({ name: "grant", aliases: [], category: "admin", description: "Grant a capability to a user", handler: handleGrant, ownerOnly: true });
  registerCommand({ name: "revoke", aliases: [], category: "admin", description: "Revoke a capability", handler: handleRevoke, ownerOnly: true });
  registerCommand({ name: "caps", aliases: ["permissions"], category: "admin", description: "View granted capabilities", handler: handleCaps, ownerOnly: true });
  // Business Mode is available to every sender. It drafts professional replies
  // but never sends a customer message from this conversational surface.
  registerCommand({ name: "businessmode", aliases: ["business", "salesmode", "clientmode"], category: "business", description: "Configure copy-only business reply drafting", handler: handleBusinessMode, ownerOnly: false });

  // 'teach' belongs to !explain (teach-it-back). Removing it here avoids the
  // ambiguous alias collision between explain.teach and learn.teach.
  registerCommand({ name: "learn", aliases: [], category: "dev", description: "Teach a fact: !learn <fact>", handler: handleLearn, ownerOnly: false });
  registerCommand({ name: "facts", aliases: ["whatiknow"], category: "dev", description: "View learned facts", handler: handleFacts, ownerOnly: false });
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

  // PASQUA compatibility and utility command set.
  registerPasquaCommands(registerCommand);
}

// ── Intent detection ──────────────────────────────────────────
function detectIntent(text) {
  const lower = text.toLowerCase().trim();
  if (/^(?:push|publish|upload|send)\s+(?:the\s+)?(?:verified\s+)?(?:project|build|artifact)\s+(?:to|on)\s+github\b/i.test(lower)) return "deploy";
  if (/https?:\/\/\S+/i.test(lower) && /\b(?:download|save|get|fetch|grab|send)\b/i.test(lower) && /\b(?:this|that|it|link|video|clip|reel|media)\b/i.test(lower)) return "download";
  const engineeringAction = /\b(?:check|inspect|look\s+at|review|audit|understand|explain|work(?:\s+\w+){0,2}\s+on|improve|fix|change|update|edit|modify|implement|add|remove|build|test|run|plan|propose|open|list|show|use|select|switch|connect|link|approve|verify|merge|ship|push)\b/i;
  const engineeringTarget = /\b(?:github|git\s*hub|repo(?:sitory)?|codebase|source\s*code|dashboard|android\s+companion)\b|\b(?!src\/|app\/|plugins\/|test\/|gradle\/|data\/|node_modules\/)[a-z0-9_.-]+\/[a-z0-9_.-]+\b/i;
  if (engineeringAction.test(lower) && engineeringTarget.test(lower) && /\b(?:my|the|this|that)\b|\b[a-z0-9_.-]+\/[a-z0-9_.-]+\b/i.test(lower)) return "engineering";
  const deliveryIntent = /^(?:please\s+)?(?:build|create|make|design|develop|code)\b/i.test(lower)
    && /\b(?:website|web\s*app|webpage|site|landing\s+page|portfolio|dashboard|app)\b/i.test(lower)
    && /\b(?:deploy|host|publish|online|preview|link|url|screenshot|screen\s*shot|show\s+me|send\s+me)\b/i.test(lower);
  if (deliveryIntent) return "deliver";
  for (const [intent, patterns] of Object.entries(INTENTS)) {
    for (const pattern of patterns) {
      // Only match clear intent at the START of the message, never mid-sentence.
      // Using startsWith prevents normal chat like "help me search stake..." from
      // being hijacked by the help command.
      if (lower === pattern || lower.startsWith(pattern + " ") || lower.startsWith(pattern + ",") || lower.startsWith(pattern + "?") || lower.startsWith(pattern + ":") || lower.startsWith(pattern + "-") || (pattern.endsWith("_") && lower.startsWith(pattern))) {
        return intent;
      }
    }
  }

  // Accept natural phrasing such as “generate my damn video of a dog”, but
  // keep the match anchored to an explicit generation verb so ordinary chat
  // is never hijacked into a media request.
  if (/^(?:please\s+)?(?:generate|create|make|produce|render|animate|draw|paint|imagine|design|give me|show me)\b/i.test(lower)) {
    if (/\b(video|clip|film|animation|movie)\b/i.test(lower)) return "video";
    if (/\b(music|song|beat|soundtrack|instrumental)\b/i.test(lower)) return "music";
    if (/\b(voice|speech|audio|narration|narrate)\b/i.test(lower)) return "voiceGenerate";
    if (/\b(image|picture|pic|photo|drawing|illustration|art|portrait)\b/i.test(lower)) return "image";
    if (/\bid card|national id|cni|identity card/i.test(lower) && /\b(create|make|generate|design|build)\b/i.test(lower)) return "idcard";
  }
  return null;
}

function triggeredByName(text) {
  const lower = String(text || "").toLowerCase();
  const escaped = BOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(lower);
}

function stripAriaAddress(text) {
  let value = String(text || "").trim();
  const escaped = BOT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  value = value.replace(new RegExp(`^(?:hey\\s+|yo\\s+|ok\\s+)?${escaped}(?:\\s*[,!:?-]\\s*|\\s+)`, "i"), "").trim();
  if (value.toLowerCase() === BOT_NAME) return "";
  return value;
}

function naturalArgs(intent, text) {
  const value = stripAriaAddress(text);
  const patterns = {
    image: /^(?:please\s+)?(?:generate|create|make|draw|paint|imagine|design|give me|show me)(?:\s+(?:a|an|me|my|the|this|that|some))*\s+(?:image|picture|pic|photo|drawing|illustration|art|portrait)\s*(?:of\s+)?/i,
    video: /^(?:please\s+)?(?:generate|create|make|produce|render|animate|give me|show me)(?:\s+(?:a|an|me|my|the|this|that|some|damn|fucking))*\s+(?:video|clip|film|animation|movie)\s*(?:of\s+)?/i,
    music: /^(?:please\s+)?(?:generate|create|make|produce|compose)(?:\s+(?:a|an|me|my|the|this|that|some|music))*\s+/i,
    voiceGenerate: /^(?:please\s+)?(?:generate|create|make|produce|record|narrate)(?:\s+(?:a|an|me|my|the|this|that|some))*\s+(?:voice|speech|audio|narration)\s*/i,
    build: /^(?:please\s+)?(?:build|create|make)(?:\s+me)?(?:\s+(?:an|a))?\s*/i,
    deliver: /^(?:please\s+)?(?:build|create|make|design|develop|code)(?:\s+me)?(?:\s+(?:an|a))?\s*/i,
    deploy: /^(?:please\s+)?(?:deploy|host|publish)(?:\s+(?:it|this|the project|through vercel|on vercel))?\s*/i,
    delegate: /^(?:please\s+)?(?:delegate|orchestrate|hand this off)(?:\s+(?:this|that|task|mission))?\s*/i,
    agent: /^(?:please\s+)?(?:figure out|plan and|research and|find and compare|deep dive on)\s*/i,
    edit: /^(?:please\s+)?(?:edit|change|update|fix)(?:\s+(?:this|the file))?\s*/i,
    links: /^(?:please\s+)?(?:give me|show me|open)?\s*(?:the\s+)?(?:dashboard|anime)(?:\s+(?:link|website|site))?\s*/i,
    anime: /^(?:please\s+)?(?:(?:find|search|show me)\s+(?:some\s+)?)?anime\s*/i,
    project: /^(?:please\s+)?(?:start|create)\s+(?:a\s+)?(?:learner\s+)?(?:project|capstone)\s*/i,
    mission: /^(?:please\s+)?(?:start|create|run)\s+(?:a\s+)?mission\s*/i,
    poll: /^(?:please\s+)?(?:create|make)\s+(?:a\s+)?poll\s*/i,
  };
  if (["help", "memories", "atlas", "links"].includes(intent)) return "";
  if (intent === "engineering") return value;
  if (intent === "nsfw") {
    const explicit = value.match(/^nsfw\s+(on|off|true|false|enable|disable|enabled|disabled)$/i);
    if (explicit) return explicit[1].toLowerCase();
  }
  if (intent === "remember") {
    return value.replace(/^(?:remember(?:\s+that|\s+this)?|keep\s+in\s+mind(?:\s+that)?|(?:don'?t|do\s+not)\s+forget(?:\s+that)?|put\s+this\s+in\s+your\s+memory|save\s+this\s+to\s+memory|store\s+this\s+in\s+memory)\s*/i, "").trim();
  }
  return patterns[intent] ? value.replace(patterns[intent], "").trim() : value;
}

function findRegisteredCommand(token) {
  const normalized = String(token || "").toLowerCase();
  return commands.find((command) => command.name === normalized) ||
    commands.find((command) => (command.aliases || []).includes(normalized)) || null;
}

function resolveExplicitNaturalCommand(cleaned) {
  const lower = cleaned.toLowerCase().replace(/[?!.]+$/g, "").trim();
  const makeCommand = (name, args = "") => {
    const command = findRegisteredCommand(name);
    return command ? { handler: command.handler, intent: command.name, args, command } : null;
  };

  const recallPrefix = lower.match(/^(?:remember|reopen|open|load|find|show me)\s+(?:that|the|my)?\s*(.+)$/i);
  if (recallPrefix && /(?:website|web\s*app|site|project)\b/i.test(recallPrefix[1]) && !/^(?:the\s+)?(?:anime|dashboard)\b/i.test(recallPrefix[1])) {
    const reference = recallPrefix[1].replace(/\s+(?:that\s+)?(?:we|i)\s+(?:built|made|created)$/i, "").trim();
    return makeCommand("projectrecall", reference);
  }
  const upgradePrefix = lower.match(/^(?:auto[- ]?upgrade|upgrade|improve|polish|modernize|refresh)\s+(.+)$/i);
  if (upgradePrefix && /(?:website|web\s*app|site|project|it|this)\b/i.test(upgradePrefix[1])) return makeCommand("projectupgrade", upgradePrefix[1].trim());
  if (/^(?:improve|polish|refresh|modernize)\s+(?:the\s+)?(?:design|ui|ux|look|appearance)\b/i.test(lower) || /^(?:make|do)\s+(?:some|a few)\s+(?:changes|updates)\b/i.test(lower)) return makeCommand("projectupgrade", lower);
  if (/^(?:what|which)\s+(?:modules|packages|capabilities)\b.*\b(?:installed|have|available)\b/i.test(lower) || /^(?:inspect|show)\s+(?:(?:your|aria'?s|the bot'?s)\s+)?(?:system|modules|capabilities|installed)\b/i.test(lower)) return makeCommand("engineering", "status");
  if (/^(?:approve|apply|execute)\s+(?:the\s+)?(?:upgrade|engineering)\s+(upgrade_[a-z0-9_]+)$/i.test(lower)) return makeCommand("engineering", `approve ${lower.match(/(upgrade_[a-z0-9_]+)$/i)[1]}`);
  if (/^(?:verify|check|test)\s+(?:the\s+)?(?:upgrade|engineering)\s+(upgrade_[a-z0-9_]+)$/i.test(lower)) return makeCommand("engineering", `verify ${lower.match(/(upgrade_[a-z0-9_]+)$/i)[1]}`);
  if (/^merge\s+(?:the\s+)?(?:upgrade|engineering)\s+(upgrade_[a-z0-9_]+)$/i.test(lower)) return makeCommand("engineering", `merge ${lower.match(/(upgrade_[a-z0-9_]+)$/i)[1]}`);
  if (/^(?:open|create)\s+(?:a\s+)?(?:github\s+)?(?:pr|pull\s+request)\s+(?:for\s+)?(?:the\s+)?(?:upgrade|engineering)\s+(upgrade_[a-z0-9_]+)$/i.test(lower)) return makeCommand("engineering", `approve ${lower.match(/(upgrade_[a-z0-9_]+)$/i)[1]}`);
  if (/^(?:implement|upgrade|improve|add|fix|change)\s+(?:this|that|it)\b.*\b(?:your|the)\s+(?:system|code|repository|bot)\b/i.test(lower)) return makeCommand("engineering", "plan this");
  if (/^(?:upgrade|improve)\s+(?:yourself|the\s+bot|the\s+system)\b/i.test(lower)) return makeCommand("engineering", lower);
  const polite = String.raw`(?:(?:please|can you|could you|would you|will you)\s+)?`;
  const hideTagNatural = new RegExp(String.raw`^${polite}(?:hidetag|hide[- ]tag|tag everyone silently|mention everyone silently|silently tag everyone)(?:\s+.+)?$`, "i");
  if (hideTagNatural.test(lower)) return makeCommand("hidetag", lower.replace(new RegExp(String.raw`^${polite}(?:hidetag|hide[- ]tag|tag everyone silently|mention everyone silently|silently tag everyone)\s*`, "i"), "").trim());
  const tagAllNatural = new RegExp(String.raw`^${polite}(?:tag|mention)\s+(?:everyone|everybody|all(?:\s+members)?)(?:\s+.+)?$`, "i");
  if (tagAllNatural.test(lower)) return makeCommand("tagall", lower.replace(new RegExp(String.raw`^${polite}(?:tag|mention)\s+(?:everyone|everybody|all(?:\s+members)?)\s*`, "i"), "").trim());
  if (/^(?:kick|remove|banish)\s+(?:everyone|everybody|all(?:\s+members)?)(?:\s+(?:in|from)\s+(?:this|the)\s+(?:gc|group))?$/i.test(lower)) return makeCommand("kickall");
  if (/^(?:make|promote|appoint|give)\s+(?:him|her|them|this person|that person)\s+(?:an?\s+)?admin(?:\s+(?:in|of)\s+(?:this|the)\s+(?:gc|group))?$/i.test(lower)) return makeCommand("promote");
  if (/^(?:make|promote|appoint|give)\s+.+?\s+(?:an?\s+)?admin(?:\s+(?:in|of)\s+(?:this|the)\s+(?:gc|group))?$/i.test(lower)) return makeCommand("promote");
  if (/^(?:remove|take|strip)\s+(?:his|her|their|the)\s+admin(?:\s+(?:rights?|role|status))?$/i.test(lower) || /^(?:demote|remove\s+admin)\s+.+$/i.test(lower)) return makeCommand("demote");
  if (/^(?:kick|remove|banish)\s+(?:him|her|them|this person|that person)$/i.test(lower)) return makeCommand("kick");
  const scopeSuffix = String.raw`(?:\s+(?:for|in)\s+(?:this|the)\s+(?:gc|group))?`;
  const adminProtectionToggle = lower.match(new RegExp(String.raw`^(?:(?:turn|switch)\s+(on|off)|(?:enable|disable))\s+(?:the\s+)?(?:admin(?:s)?\s+(?:protection|shield|guard|non[- ]?removal)|(?:anti[- ]?admin[- ]?removal)|(?:non[- ]?admin[- ]?removal)|adminprotect|adminshield|keepadmins)${scopeSuffix}$`, "i"));
  if (adminProtectionToggle) {
    const enabled = adminProtectionToggle[1] === "on" || adminProtectionToggle[1] === "enable";
    return makeCommand("adminprotect", enabled ? "on" : "off");
  }
  const adminProtectionPhrases = [
    new RegExp(String.raw`^(?:protect|guard)\s+(?:me\s+and\s+aria|us|the\s+admins?)(?:\s+(?:from|against)\s+(?:being\s+)?(?:demoted|removed|kicked?))?${scopeSuffix}$`, "i"),
    new RegExp(String.raw`^(?:keep|make\s+sure)\s+(?:me\s+and\s+aria|us|the\s+admins?)\s+(?:as\s+)?admins?(?:\s+safe)?${scopeSuffix}$`, "i"),
    new RegExp(String.raw`^(?:don'?t|do\s+not)\s+let\s+anyone\s+(?:demote|remove|kick)\s+(?:me|us|the\s+admins?)${scopeSuffix}$`, "i"),
  ];
  if (adminProtectionPhrases.some((pattern) => pattern.test(lower))) return makeCommand("adminprotect", "on");
  const directToggle = lower.match(new RegExp(String.raw`^(enable|disable)\s+(antibot|antidemote|antigroupmention|antigroupstatus|antihijack|antimention|antipromote|antispam|antisticker|antiword|antileave|slowmode)${scopeSuffix}$`, "i"));
  if (directToggle) return makeCommand(directToggle[2], directToggle[1].toLowerCase() === "enable" ? "on" : "off");
  const turnToggle = lower.match(new RegExp(String.raw`^(?:turn|switch)\s+(on|off)\s+((?:anti[- ]?)?(?:bot|demote|groupmention|groupstatus|hijack|mention|promote|spam|sticker|word|leave)|slowmode)${scopeSuffix}$`, "i"));
  const enableToggle = lower.match(new RegExp(String.raw`^(enable|disable)\s+((?:anti[- ]?)?(?:bot|demote|groupmention|groupstatus|hijack|mention|promote|spam|sticker|word|leave)|slowmode)${scopeSuffix}$`, "i"));
  const protectionToggle = turnToggle || enableToggle;
  if (protectionToggle) {
    const enabled = turnToggle ? protectionToggle[1] === "on" : protectionToggle[1] === "enable";
    const rawName = turnToggle ? protectionToggle[2] : protectionToggle[2];
    const compact = rawName.replace(/-/g, "").replace(/groupmention/i, "antigroupmention").replace(/groupstatus/i, "antigroupstatus");
    const name = compact.startsWith("anti") || compact === "slowmode" ? compact : `anti${compact}`;
    return makeCommand(name, enabled ? "on" : "off");
  }
  if (/^(?:set|change|update)\s+(?:your|aria(?:'s)?|the bot(?:'s)?)\s+(?:profile\s*)?(?:pic|picture|photo|avatar)(?:\s+to\s+(?:this|that|it))?$/i.test(lower)) return makeCommand("setpp", "this");
  if (/^(?:set|change|update)\s+(?:your|aria(?:'s)?)\s+(?:whatsapp\s+)?(?:bio|status)(?:\s+to\s+(.+))?$/i.test(lower)) return makeCommand("setbio", lower.match(/\b(?:bio|status)\s+to\s+(.+)$/i)?.[1] || "");
  if (/^(?:set|change|update)\s+(?:your|aria(?:'s)?)\s+(?:whatsapp\s+)?name(?:\s+to\s+(.+))?$/i.test(lower)) return makeCommand("setname", lower.match(/\bname\s+to\s+(.+)$/i)?.[1] || "");

  if (/\b(?:never|don't|dont|do not|block|deny|ban)\b.*\badmins?\b/i.test(lower) || /\b(?:make|mark|set)\b.*\bnever\b.*\badmins?\b/i.test(lower)) return makeCommand("antiadmin", "on");
  if (/^(?:allow|let|unblock|remove)\s+(?:him|her|them|this person|that person)\s+(?:to\s+be\s+)?admins?\b/i.test(lower)) return makeCommand("antiadmin", "off");
  if (/^(?:antiadmin|anti-admin|denyadmin|neveradmin)\s+(?:on|off|list|status|remove|clear|allow|unblock)?$/i.test(lower)) return makeCommand("antiadmin", lower.split(/\s+/).slice(1).join(" ") || "status");

  const pins = lower.match(/^(?:give|send|show|get)(?:\s+me)?\s+(?:(\d{1,2})\s+)?(?:pics?|pictures?|images?|photos?)\s+(?:of|for)\s+(.+)$/i);
  if (pins) return makeCommand("pinterest", `${pins[1] || 5} pics of ${pins[2]}`);

  const businessControl = lower.match(/^business\s+mode\s+(help|commands|status|profile|dashboard|first\s+reply|opening\s+reply|reset|clear|style\s+\w+|tone\s+\w+|language\s+.+)$/i);
  if (businessControl) return makeCommand("businessmode", businessControl[1]);
  const businessStart = lower.match(/^business\s+mode(?:\s+(on|start|off|stop|exit))?$/i);
  if (businessStart) return makeCommand("businessmode", businessStart[1] || "start");
  const businessSetup = lower.match(/^business\s+mode\s+(?:setup|configure|about|selling)\s*[:=-]?\s*(.+)$/i);
  if (businessSetup) return makeCommand("businessmode", `setup ${businessSetup[1].trim()}`);

  const releaseRequest = lower.match(/^(?:search|look\s+up|find)\s+(?:on\s+)?github\s+(?:about\s+)?(.+?)\s+(?:and\s+)?(?:bring|give|show|find)\s+(?:me\s+)?(?:the\s+)?(?:(?:release(?:s)?\s+links?)|(?:links?\s+to\s+release(?:s)?))$/i);
  if (releaseRequest) return makeCommand("releases", releaseRequest[1].trim());
  return null;
}

function resolveBusinessModePhrase(text) {
  const match = String(text || "").trim().match(/^(?:(?:hey|yo|ok)\s+)?aria\s*[,!:?-]?\s+business\s+mode(?:\s+(on|start|off|stop|exit))?\s*[.!?]*$/i);
  return match ? { operation: match[1] || "start" } : null;
}

function resolveNaturalAction(text) {
  const cleaned = stripAriaAddress(text);
  if (!cleaned) return null;
  const explicit = resolveExplicitNaturalCommand(cleaned);
  if (explicit) return explicit;
  const intent = detectIntent(cleaned);
  if (intent && intentHandlers[intent]) {
    return { handler: intentHandlers[intent], intent, args: naturalArgs(intent, cleaned), command: findRegisteredCommand(intent) };
  }
  const token = cleaned.split(/\s+/)[0];
  const command = findRegisteredCommand(token);
  if (!command) return null;
  return { handler: command.handler, intent: command.name, args: cleaned.slice(token.length).trim(), command };
}

// ── Route message ────────────────────────────────────────────
async function routeMessage(sock, msg, context) {
  const { text, lower, senderJid, senderName, chatId, isGroup, loadedPlugins } = context;
  const matchedPrefix = getMatchedPrefix(lower);

  // Credential intake is handled before every other route so a token is never
  // sent to the AI provider, memory layer, or generic chat fallback.
  if (await handlePrivateGithubCredential(sock, msg, text, { ...context, senderJid, senderName, chatId, isGroup })) return;
  
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
  if (matchedPrefix) {
    const cmdText = lower.slice(matchedPrefix.length).trim();
    const cmdName = cmdText.split(/\s+/)[0];
    const args = text.slice(matchedPrefix.length).trim().slice(cmdName.length).trim();
    
    // Resolve collisions deterministically: an exact command NAME always beats
    // an alias. e.g. !build → the "build" command, not academy's "project"
    // alias; !agent → the "agent" command, not academy's build alias.
    let resolved = commands.find((c) => c.name === cmdName);
    if (!resolved) resolved = commands.find((c) => (c.aliases || []).includes(cmdName));
    const cmd = resolved;
    if (cmd) {
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
          try { require("../tools/dashboardTelemetry").record("command", { detail: cmd.name }); } catch (_) {}
          await cmd.handler(sock, msg, args, { ...context, pasquaCommand: cmd.name });
          try {
            require("../core/productBridge").recordProductActivity({
              product: "whatsapp",
              action: "command.executed",
              context: context.platformContext,
              actorId: context.platformActor?.id,
              aggregateType: "command",
              aggregateId: cmd.name,
              metadata: { command: cmd.name, source: "prefix" },
              usage: { category: "actions", metric: "commands", units: 1, metadata: { command: cmd.name } },
              idempotencyKey: msg.key?.id ? `whatsapp-command:${msg.key.id}` : null,
            });
          } catch (_) {}
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

  // ── PLUGIN COMMANDS (via findPluginCommand) ────────────────
  // Only reached if no built-in command matched the prefix
  if (matchedPrefix) {
    const commandName = lower.slice(matchedPrefix.length).split(/\s+/)[0];
    const args = text.slice(matchedPrefix.length).trim().slice(commandName.length).trim().split(/\s+/);
    const found = findPluginCommand(loadedPlugins, commandName);
    if (found) {
      if (found.ownerOnly && !isOwner(senderJid)) {
        const { reply: _rp } = require("./baileysHelpers");
        await _rp(sock, msg, "❌ That plugin capability is owner-only.");
        return;
      }
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

  // ── OWNER BUSINESS MODE ────────────────────────────────────
  // Handle this phrase before generic intent detection. It is an operational
  // mode switch, not a chat prompt, so it must never reach the casual persona.
  const businessPhrase = resolveBusinessModePhrase(text);
  if (businessPhrase) {
    const cmd = findRegisteredCommand("businessmode");
    if (!cmd) {
      const { reply: _rp } = require("./baileysHelpers");
      await _rp(sock, msg, "⚠️ Business Mode is not installed in this deployment yet. Merge the main-targeted Business Mode PR and redeploy Render.");
      return;
    }
    if (cmd.ownerOnly && !isOwner(senderJid)) {
      const { reply: _rp } = require("./baileysHelpers");
      await _rp(sock, msg, "❌ Business Mode is owner-only.");
      return;
    }
    try {
      await cmd.handler(sock, msg, businessPhrase.operation, { ...context, pasquaCommand: "businessmode" });
    } catch (err) {
      const { reply: _rp } = require("./baileysHelpers");
      await _rp(sock, msg, `⚠️ Business Mode could not start: ${String(err?.message || err).slice(0, 300)}`);
    }
    return;
  }

  // ── NATURAL-LANGUAGE ACTIONS ────────────────────────────────
  // Normal conversation still falls through to the AI. Clear action-shaped
  // requests reuse the registered command handlers so build/edit/delegate and
  // other capabilities behave identically without a prefix.
  const natural = resolveNaturalAction(text);
  if (natural) {
    const cmd = natural.command;
    if (cmd?.ownerOnly && !isOwner(senderJid)) {
      const { reply: _rp } = require("./baileysHelpers");
      await _rp(sock, msg, "❌ That capability is owner-only.");
      return;
    }
    if (cmd?.category === "group" && !isOwner(senderJid)) {
      const localAdmin = isAdmin(senderJid, chatId);
      const groupAdmin = isSenderAdmin ? await isSenderAdmin(sock, chatId, senderJid).catch(() => false) : false;
      if (!localAdmin && !groupAdmin) {
        const { reply: _rp } = require("./baileysHelpers");
        await _rp(sock, msg, "❌ You need admin rights for that.");
        return;
      }
    }
    try {
      try { require("../tools/dashboardTelemetry").record("natural_action", { detail: natural.intent }); } catch (_) {}
      try { const selfModel = require("../tools/ariaSelfModel"); selfModel.observe(senderJid, text); selfModel.recordAction(natural.intent, natural.args || text); } catch (_) {}
      await natural.handler(sock, msg, natural.args || text, { ...context, pasquaCommand: natural.command?.name || natural.intent });
      try {
        require("../core/productBridge").recordProductActivity({
          product: "whatsapp",
          action: "natural-action.executed",
          context: context.platformContext,
          actorId: context.platformActor?.id,
          aggregateType: "action",
          aggregateId: natural.intent,
          metadata: { intent: natural.intent, source: "natural-language" },
          usage: { category: "actions", metric: "natural-language", units: 1, metadata: { intent: natural.intent } },
          idempotencyKey: msg.key?.id ? `whatsapp-natural:${msg.key.id}` : null,
        });
      } catch (_) {}
      try { require("./eventLog").track("natural_action", natural.intent); } catch (_) {}
    } catch (err) {
      const { reply: _rp } = require("./baileysHelpers");
      await _rp(sock, msg, `⚠️ I couldn't complete that action: ${err.message}`).catch(() => {});
      try { require("./eventLog").track("error", `Natural action ${natural.intent} failed: ${err.message.slice(0, 80)}`); } catch (_) {}
    }
    return;
  }

  // Once this sender has enabled Business Mode, plain pasted customer messages
  // become drafts instead of being answered in ARIA's casual companion voice.
  // Profiles and sessions are keyed by sender JID + chat.
  if (businessMode.isActive(senderJid, chatId)) {
    try {
      await handleBusinessMode(sock, msg, text, context);
    } catch (err) {
      const { reply: _rp } = require("./baileysHelpers");
      await _rp(sock, msg, `⚠️ Business Mode could not draft that reply: ${String(err?.message || err).slice(0, 300)}`);
    }
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
  const { isCapabilityQuestion, formatCapabilityReport, formatConnectorReport } = require("../tools/capabilityProfile");
  const requestText = String(ctx.text || args || "").trim();
  await react(sock, msg, "✨");
  if (/\b(?:what\s+connectors\s+do\s+i\s+have|show\s+(?:me\s+)?(?:my\s+)?connectors|which\s+tools\s+(?:are|do)\s+you\s+have)\b/i.test(requestText)) return reply(sock, msg, formatConnectorReport());
  if (isCapabilityQuestion(requestText) && /\b(?:axon|another|better|can'?t|difference)\b/i.test(requestText)) {
    return reply(sock, msg, formatCapabilityReport());
  }
  const owner = isOwner(ctx.senderJid);
  const base = String(process.env.BASE_URL || "").replace(/\/$/, "");
  const lines = [
    "╭── ✨ *ARIA* ✨ ──╮",
    "I understand ordinary requests. You do not need a command prefix.",
    "",
    "💬 *Everyday help* — ask questions, explain things, translate, summarize links, search the web, check weather/news, or talk normally.",
    "🏗️ *Build and code* — say ‘build a website for…’, ‘debug this’, ‘edit this file…’, or ‘research and compare…’.",
    "🎬 *Anime and media* — say ‘find anime…’, ‘watch episode…’, ‘download this’, or ‘make this a sticker’.",
    "⏰ *Personal operator* — say ‘remind me…’, ‘track this project’, ‘start a mission’, or ‘open my learner portal’.",
    "🧠 *Companion memory* — ask ‘what do you remember about me?’ or tell ARIA something worth keeping; memory is curated internally rather than controlled by prefix commands.",
    "🔗 *Web surfaces* — ask ‘give me the dashboard link’ or ‘open the anime website’.",
    `🧩 *Verified capability groups* — ${listCapabilities().map((capability) => capability.name).join(", ")}. I only report a completed operation after the underlying result and evidence exist.`,
  ];
  if (owner) {
    lines.push("", "🔐 *Owner capabilities* — build, edit, delegate missions, manage the dashboard, configure WhatsApp, inspect health, and administer the bot. These still require owner authorization even without a prefix.");
  }
  if (base) lines.push("", `Dashboard: ${base}/dashboard\nAnime: ${base}/anime\nLearner portal: ${base}/portal/login`);
  lines.push("", "Try speaking naturally: ‘ARIA, build me a landing page’, ‘delegate this research’, ‘give me the dashboard link’, or ‘what do you remember about me?’", "╰────────────────╯");
  await reply(sock, msg, lines.join("\n"));
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
async function ensureBotGroupAdmin(sock, msg, chatId) {
  const { reply } = require("./baileysHelpers");
  const { isBotAdmin } = require("../tools/groupAdmin");
  if (await isBotAdmin(sock, chatId).catch(() => false)) return true;
  await reply(sock, msg, "❌ I have the group-control command, but WhatsApp says ARIA is not an admin in this group. Promote ARIA, then send the same clear request again.");
  return false;
}

async function handleKick(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  if (!(await ensureBotGroupAdmin(sock, msg, ctx.chatId))) return;
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the member, then say “ARIA, remove @member”. I will not guess who “him” is before removing someone.");
  const ownerNumber = String(process.env.OWNER_NUMBER || "").replace(/\D/g, "");
  const targetNumber = String(target).split("@")[0].replace(/\D/g, "");
  const botIdentities = [sock?.user?.id, sock?.user?.jid, sock?.user?.lid, sock?.user?.phoneNumber].filter(Boolean);
  const targetIsBot = botIdentities.some((identity) => identity === target || String(identity).split("@")[0].replace(/\D/g, "") === targetNumber);
  const targetIsOwner = isOwner(target) || (!!ownerNumber && targetNumber === ownerNumber);
  if (targetIsOwner || targetIsBot) {
    return reply(sock, msg, "🤣 Absolutely not. Trying to kick a protected admin is a bold little mistake. Find a less embarrassing mission.");
  }
  const result = await kickUser(sock, ctx.chatId, target);
  await react(sock, msg, "👢");
  if (result?.success === false) await reply(sock, msg, `❌ Kick failed: ${result.error}`);
  else await reply(sock, msg, "👢 User kicked.");
}

// ── !close — GC admins / bot admin tell ARIA to close the group ──
// Locks the group so only admins can send messages (announcement mode).
async function handleClose(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const { isOwner } = require("../utils/permissions");
  const { isBotAdmin } = require("../tools/groupAdmin");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  // Owner/bot-admin bypasses the group-admin check (already enforced upstream,
  // but double-safe here).
  const senderAdmin = await isBotAdmin(sock, ctx.chatId).catch(() => false);
  if (!isOwner(ctx.senderJid) && !senderAdmin) {
    return reply(sock, msg, "❌ Only a group admin or the bot admin can close the group.");
  }
  try {
    // announcement mode = closed to non-admins
    await sock.groupSettingUpdate(ctx.chatId, "announcement");
    await react(sock, msg, "🔒");
    await reply(sock, msg, "🔒 Group closed — only admins can send messages now.");
  } catch (e) {
    await reply(sock, msg, `❌ Couldn't close the group: ${e.message}`);
  }
}

// ── !open — reopen a closed group (admin only) ──
async function handleOpen(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const { isOwner } = require("../utils/permissions");
  const { isBotAdmin } = require("../tools/groupAdmin");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  const senderAdmin = await isBotAdmin(sock, ctx.chatId).catch(() => false);
  if (!isOwner(ctx.senderJid) && !senderAdmin) {
    return reply(sock, msg, "❌ Only a group admin or the bot admin can open the group.");
  }
  try {
    await sock.groupSettingUpdate(ctx.chatId, "not_announcement");
    await react(sock, msg, "🔓");
    await reply(sock, msg, "🔓 Group opened — everyone can send messages again.");
  } catch (e) {
    await reply(sock, msg, `❌ Couldn't open the group: ${e.message}`);
  }
}

async function handleAddMember(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  if (!(await ensureBotGroupAdmin(sock, msg, ctx.chatId))) return;
  // Require the caller to be the owner or a real group admin (adding members is
  // a group-mod action; the router's category="group" already checks admin).
  let target = getTargetJid(msg);
  // Support `!add <number>` (with or without country code / separators).
  if (!target) {
    const raw = (Array.isArray(args) ? args.join("") : String(args || "")).replace(/[^\d]/g, "");
    if (raw && raw.length >= 8) {
      target = raw + "@s.whatsapp.net";
    }
  }
  if (!target) return reply(sock, msg, "Usage: !add <number>  (or mention/quote the person).");
  const result = await addUser(sock, ctx.chatId, target);
  await react(sock, msg, "➕");
  if (result?.success === false) await reply(sock, msg, `❌ Add failed: ${result.error}`);
  else await reply(sock, msg, `➕ Added ${target.split("@")[0]}.`);
}

async function handlePromote(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  if (!(await ensureBotGroupAdmin(sock, msg, ctx.chatId))) return;
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the member, then say “ARIA, promote @member”.");
  const result = await promoteUser(sock, ctx.chatId, target);
  await react(sock, msg, "⭐");
  if (result?.success === false) await reply(sock, msg, `❌ Promote failed: ${result.error}`);
  else await reply(sock, msg, "⭐ User promoted to admin.");
}

async function handleDemote(sock, msg, args, ctx) {
  const { reply, react, getTargetJid } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  if (!(await ensureBotGroupAdmin(sock, msg, ctx.chatId))) return;
  const target = getTargetJid(msg);
  if (!target) return reply(sock, msg, "Mention or quote the member, then say “ARIA, demote @member”.");
  const result = await demoteUser(sock, ctx.chatId, target);
  await react(sock, msg, "⬇️");
  if (result?.success === false) await reply(sock, msg, `❌ Demote failed: ${result.error}`);
  else await reply(sock, msg, "⬇️ User demoted.");
}

async function handleTagAll(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  if (!(await ensureBotGroupAdmin(sock, msg, ctx.chatId))) return;
  const result = await tagAll(sock, msg, ctx.chatId, args || "📢 @everyone");
  // tagAll already sends the tagged message to the group; only reply on error.
  if (result?.success === false) await reply(sock, msg, `❌ ${result.error}`);
}

async function handleHideTag(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!ctx.isGroup) return reply(sock, msg, "This only works in groups.");
  if (!(await ensureBotGroupAdmin(sock, msg, ctx.chatId))) return;
  const message = String(args || "").replace(/^(?:everyone|everybody|all(?:\s+members)?|the\s+group)\b[\s,:-]*/i, "").trim() || "📢 Attention";
  const result = await hideTag(sock, ctx.chatId, message);
  if (result?.success === false) return reply(sock, msg, `❌ Hide-tag failed: ${result.error}`);
  await react(sock, msg, "📢");
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

async function handleRecall(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const { recallReport } = require("../tools/academy/forgettingEngine");
  const uid = (ctx.senderJid || "").split("@")[0];
  return reply(sock, msg, recallReport(uid));
}

async function handleDna(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const { dnaReport } = require("../tools/academy/engineeringDNA");
  const uid = (ctx.senderJid || "").split("@")[0];
  return reply(sock, msg, dnaReport(uid));
}

async function handleCompany(sock, msg, args, ctx) {
  const { handleCompanyCommand } = require("../tools/academy/companySimulator");
  await handleCompanyCommand(sock, msg, args, ctx);
}

async function handleLevel(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const { xpView } = require("../tools/academy/xpSystem");
  const uid = (ctx.senderJid || "").split("@")[0];
  return reply(sock, msg, xpView(uid));
}

async function handleAcademyLeaderboard(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const { leaderboardView } = require("../tools/academy/xpSystem");
  const selfUid = (ctx.senderJid || "").split("@")[0];
  // In group chats, scope the board to that group's members via
  // groupMetadata; otherwise show the global board.
  let scopeUids = null;
  if (ctx.chatId && String(ctx.chatId).endsWith("@g.us") && sock) {
    try {
      const meta = await sock.groupMetadata(ctx.chatId);
      if (meta && Array.isArray(meta.participants)) {
        scopeUids = meta.participants.map((p) => String(p.id).split("@")[0]);
      }
    } catch (_) { scopeUids = null; }
  }
  const scopeNote = scopeUids ? "_This group_" : "_Global_ (DMs not in this group)";
  return reply(sock, msg, scopeNote + "\n\n" + leaderboardView(scopeUids, selfUid));
}

async function handleLearningDigest(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const { buildDigest, digestView } = require("../tools/academy/learningDigest");
  const uid = (ctx.senderJid || "").split("@")[0];
  const days = parseInt((Array.isArray(args) ? args[0] : args) || "7", 10) || 7;
  const d = buildDigest(uid, { days });
  return reply(sock, msg, digestView(d, uid));
}

async function handleLearnerSpace(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const { buildLearnerSpace, learnerSpaceView } = require("../tools/academy/learnerSpace");
  const uid = (ctx.senderJid || "").split("@")[0];
  const space = buildLearnerSpace(uid);
  return reply(sock, msg, learnerSpaceView(space));
}

async function handlePortal(sock, msg, args, ctx) {
  const { reply, react } = require("../utils/baileysHelpers");
  const { issueCode } = require("../tools/portalLinking");
  const base = String(process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3001").replace(/\/+$/, "");
  try {
    const { code, expiresAt } = issueCode(ctx.senderJid);
    const expires = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000));
    await react(sock, msg, "🔗");
    return reply(sock, msg, `🎓 *ARIA Learner Portal*\n\nOpen: ${base}/portal/login\n\nAfter creating or logging in to your account, enter this link code: *${code}*\n\nIt expires in ${expires} minutes and connects the portal to your WhatsApp academy progress.`);
  } catch (e) {
    return reply(sock, msg, "❌ I couldn't create a portal link code yet. Please try again when your WhatsApp identity is available.");
  }
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

async function handleCardLeaderboard(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  await reply(sock, msg, getLeaderboard());
}

// Business Mode is available to any sender. It is intentionally approval-first:
// ARIA drafts text for that sender to copy into a customer chat and never sends
// it to the customer.
async function handleBusinessMode(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const raw = String(args || "").trim();
  const operation = raw.toLowerCase();
  if (["help", "commands"].includes(operation)) return reply(sock, msg, businessMode.helpText());
  if (["off", "stop", "exit", "disable"].includes(operation)) {
    businessMode.stop(ctx.senderJid, ctx.chatId);
    return reply(sock, msg, "Business Mode is off. ARIA is back to normal companion mode.");
  }

  if (!raw || ["on", "start", "enable"].includes(operation)) {
    const existing = businessMode.profile(ctx.senderJid);
    businessMode.start(ctx.senderJid, ctx.chatId);
    await react(sock, msg, "💼");
    if (existing) {
      const summary = businessMode.status(ctx.senderJid, ctx.chatId);
      return reply(sock, msg, `💼 Business Mode is active — ${summary.completion.percent}% profile complete. Style: ${summary.style}. Language: ${summary.language}. Say *business mode help* for controls, *first reply* for the opening message, or paste a customer message.`);
    }
    return reply(sock, msg, "💼 *Business Workspace started.* Send `business mode setup` with your business details, then use `business mode status` to check readiness. I draft replies for you to copy; I never send to customers automatically.");
  }

  const statusRequest = /^(status|profile|dashboard)$/i.test(raw);
  if (statusRequest) {
    const summary = businessMode.status(ctx.senderJid, ctx.chatId);
    if (!summary.profile) return reply(sock, msg, "💼 No business profile exists yet. Start with `business mode setup` and send the guided brief.");
    const missing = summary.completion.missing.length ? `\nMissing: ${summary.completion.missing.join(", ")}.` : "\n✅ Profile is ready for customer drafting.";
    return reply(sock, msg, `💼 *Business Workspace*\nStatus: ${summary.active ? "active" : "paused"}\nProfile completion: ${summary.completion.percent}%\nReply style: ${summary.style}\nLanguage: ${summary.language}${missing}\nDraft policy: copy-only; ARIA never sends automatically.`);
  }
  if (/^(reset|clear)$/i.test(raw)) {
    businessMode.reset(ctx.senderJid, ctx.chatId);
    return reply(sock, msg, "🧹 Business Workspace reset. The saved business profile and draft history for this sender/chat were deleted.");
  }
  const styleRequest = raw.match(/^(?:style|tone)\s+(.+)$/i);
  if (styleRequest) {
    const profile = businessMode.setSetting(ctx.senderJid, ctx.chatId, "style", styleRequest[1]);
    return reply(sock, msg, profile ? `✅ Reply style set to *${profile.settings.style}*.` : "Set up the business profile first, then choose professional, warm, premium, concise, or casual.");
  }
  const languageRequest = raw.match(/^language\s+(.+)$/i);
  if (languageRequest) {
    const profile = businessMode.setSetting(ctx.senderJid, ctx.chatId, "language", languageRequest[1]);
    return reply(sock, msg, profile ? `✅ Draft language set to *${profile.settings.language}*.` : "Set up the business profile first, then choose English, French, or Pidgin English.");
  }
  const setup = raw.match(/^setup\s*[:=-]?\s*([\s\S]+)$/i);
  if (setup) {
    const profile = businessMode.configure(ctx.senderJid, ctx.chatId, setup[1]);
    const readiness = businessMode.completion(profile);
    await react(sock, msg, "💼");
    if (readiness.missing.length) return reply(sock, msg, `✅ Business profile saved at ${readiness.percent}%. Still needed: ${readiness.missing.join(", ")}. Add them with another *business mode setup* message. I will not invent missing facts.`);
    const opening = businessMode.openingReply(profile);
    return reply(sock, msg, `✅ Business Workspace ready — ${readiness.percent}% complete.\n\n*FIRST REPLY — COPY THIS TO CUSTOMER:*\n${opening}\n\nNow paste the customer’s next message and I’ll classify it and draft the corresponding reply. Nothing will be sent automatically.`);
  }

  const profile = businessMode.profile(ctx.senderJid);
  if (!profile) {
    businessMode.start(ctx.senderJid, ctx.chatId);
    return reply(sock, msg, "I need the full business brief first. You only gave me a category. Send it like this:\n\n!businessmode setup\nBusiness name: AutoParts Hub\nSelling: car spare parts for Toyota, Honda, and Mercedes\nPrices: genuine and aftermarket options; confirm current price\nLocation: Douala\nDelivery: Douala delivery available; confirm fee\nContact: WhatsApp or phone number\nPolicies: confirm availability before payment\nTone: professional and warm\n\nYou can also send the same details naturally in one message. Then I’ll generate the first copy-ready customer reply.");
  }
  if (/^(first\s+reply|opening\s+reply|intro(?:duction)?|hello)$/i.test(raw)) {
    const readiness = businessMode.completion(profile);
    if (readiness.missing.length) return reply(sock, msg, `⚠️ The profile is ${readiness.percent}% complete. Add: ${readiness.missing.join(", ")}. I will not invent those details.`);
    return reply(sock, msg, `*FIRST REPLY — COPY THIS TO CUSTOMER:*\n${businessMode.openingReply(profile)}`);
  }

  const classification = businessMode.classifyCustomerMessage(raw);
  const missing = businessMode.missingInfo(profile, classification);
  let draft = "";
  try {
    const settings = profile.settings || { style: "professional", language: "English" };
    const businessPrompt = `You are ARIA Business Workspace. Draft one customer-facing reply using only the verified business profile. Never invent prices, stock, delivery promises, guarantees, policies, addresses, or timelines. If information is missing, state that it must be confirmed. Reply in ${settings.language}, with a ${settings.style} tone. Do not include analysis or claim that anything was sent.\n\nVERIFIED BUSINESS PROFILE:\n${profile.brief}\n\nCUSTOMER INTENT: ${classification.label} (${classification.confidence} confidence)\nMISSING FACTS THAT MUST NOT BE INVENTED: ${missing.join(", ") || "none identified"}\n\nCUSTOMER MESSAGE:\n${raw}`;
    const aiPromise = getAIResponse(businessPrompt, ctx.senderName, [], "You are ARIA Business Workspace. Produce accurate, professional, copy-ready drafts only.", "", { userContext: `Business profile: ${profile.brief}` });
    draft = await Promise.race([aiPromise, new Promise((resolve) => setTimeout(() => resolve(""), 12000))]);
  } catch (_) {}
  if (!draft || /^❌/u.test(String(draft).trim())) draft = businessMode.fallbackReply(profile, raw, classification);
  const draftRecord = businessMode.recordDraft(ctx.senderJid, ctx.chatId, { intent: classification.intent, label: classification.label, confidence: classification.confidence, customerMessage: raw, missing, text: String(draft).trim() });
  const warning = missing.length ? `\n⚠️ Needs confirmation: ${missing.join(", ")}.` : "";
  return reply(sock, msg, `*COPY THIS TO CUSTOMER — ${classification.label.toUpperCase()}:*\n${draftRecord.text}\n${warning}\n\n*Internal note:* Review the details before sending. ARIA has not contacted the customer.`);
}

// Creative handlers
async function handleImageGen(sock, msg, args, ctx) {
  const { reply, react, isQuotingBotMessage, getQuotedMessageText } = require("./baileysHelpers");
  let prompt = String(args || "").trim();
  if (!prompt) return reply(sock, msg, "Tell me what to generate, for example: generate an image of a silver orbital-ribbon logo.");
  const quoted = isQuotingBotMessage(msg) ? getQuotedMessageText(msg) : null;
  if (/\b(it|this|that|the same)\b/i.test(prompt) && quoted) {
    prompt = `${prompt} — subject from the quoted message: ${String(quoted).slice(0, 360)}`;
  }
  await react(sock, msg, "🎨");
  try { require("../tools/ariaSelfModel").recordAction("image", prompt); } catch (_) {}
  const { generateImage } = require("../tools/imageGen");
  const result = await generateImage(prompt);
  if (result?.buffer) {
    await sock.sendMessage(ctx.chatId, { image: result.buffer, caption: `🎨 ${prompt}` }, { quoted: msg });
  } else if (result?.url) {
    try {
      await sock.sendMessage(ctx.chatId, { image: { url: result.url }, caption: `🎨 ${prompt}` }, { quoted: msg });
    } catch (error) {
      await reply(sock, msg, `❌ I generated the image, but WhatsApp could not fetch it: ${error.message}`);
    }
  } else {
    await reply(sock, msg, `❌ Image generation failed: ${result?.error || result?.fetchError || "the provider returned no usable image"}`);
  }
}

async function handleVideoGen(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const prompt = String(args || "").trim();
  if (!prompt) return reply(sock, msg, "Tell me what video to generate, for example: generate a cinematic video of a dog running on a beach.");
  await react(sock, msg, "🎬");
  await reply(sock, msg, "🎬 Generating it now — video generation can take a little while.");
  const minimax = require("../tools/minimaxMedia");
  let result = minimax.configured() && process.env.MINIMAX_VIDEO_ENABLED !== "0"
    ? await minimax.generateVideo(prompt)
    : { success: false, error: minimax.configured() ? "MiniMax video generation is disabled" : "MiniMax is not configured" };
  if (!result.success) {
    try {
      const zai = require("../tools/zaiMedia");
      if (zai.configured() && process.env.ZHIPU_VIDEO_ENABLED !== "0") result = await zai.generateVideo(prompt, { userId: "aria-video" });
    } catch (_) {}
  }
  if (!result?.success || !result.url) return reply(sock, msg, `❌ Video generation failed: ${result?.error || "the provider returned no video URL"}`);
  try {
    await sock.sendMessage(ctx.chatId, { video: { url: result.url }, mimetype: "video/mp4", caption: `🎬 ${prompt}` }, { quoted: msg });
  } catch (error) {
    await reply(sock, msg, `❌ I generated the video, but WhatsApp could not fetch it: ${error.message}`);
  }
}

async function handleMusicGen(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const prompt = String(args || "").trim();
  if (!prompt) return reply(sock, msg, "Tell me the style or mood, for example: make a dark afrobeats track for a night drive.");
  await react(sock, msg, "🎵");
  await reply(sock, msg, "🎵 Composing it now…");
  if (process.env.MINIMAX_MUSIC_ENABLED === "0") return reply(sock, msg, "❌ Music generation is disabled on this server.");
  const result = await require("../tools/minimaxMedia").generateMusic(prompt);
  if (!result?.success) return reply(sock, msg, `❌ Music generation failed: ${result?.error || "the provider returned no audio"}`);
  try {
    const payload = result.buffer ? { audio: result.buffer, mimetype: result.mimetype || "audio/mpeg", ptt: false } : { audio: { url: result.url }, mimetype: result.mimetype || "audio/mpeg", ptt: false };
    await sock.sendMessage(ctx.chatId, payload, { quoted: msg });
  } catch (error) {
    await reply(sock, msg, `❌ I generated the music, but WhatsApp could not fetch it: ${error.message}`);
  }
}

async function handleVoiceGenerate(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const text = String(args || "").trim();
  if (!text) return reply(sock, msg, "Tell me what you want ARIA to say, for example: generate a voice saying I am on my way.");
  await react(sock, msg, "🔊");
  // Use the consolidated chain once: MiniMax → ElevenLabs → FreeTTS.
  // Calling MiniMax here and then calling textToSpeech() used to invoke MiniMax twice.
  const result = await textToSpeech(text);
  if (!result?.success) return reply(sock, msg, `❌ Voice generation failed: ${result?.error || "no audio was returned"}`);
  try {
    const payload = result.buffer ? { audio: result.buffer, mimetype: result.mimetype || "audio/mpeg", ptt: false } : { audio: { url: result.url }, mimetype: result.mimetype || "audio/mpeg", ptt: false };
    await sock.sendMessage(ctx.chatId, payload, { quoted: msg });
  } catch (error) {
    await reply(sock, msg, `❌ I generated the voice, but WhatsApp could not fetch it: ${error.message}`);
  }
}

async function handleStickerCommand(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const { downloadStickerMedia } = require("../tools/sticker");
  await react(sock, msg, "🎴");
  const media = await downloadStickerMedia(sock, msg);
  if (!media) return reply(sock, msg, "❌ I couldn't find an attached or replied-to image, GIF, or video.");
  const result = await createSticker(media.buffer, { mimetype: media.mimetype, filename: media.filename });
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
  const { reply, react } = require("./baileysHelpers");
  const { downloadStickerMedia } = require("../tools/sticker");
  const media = await downloadStickerMedia(sock, msg);
  if (!media) return reply(sock, msg, "❌ Reply to or attach an image, GIF, or video and ask me to make it a sticker.");
  await react(sock, msg, "🎭");
  const result = await createSticker(media.buffer, { mimetype: media.mimetype, filename: media.filename });
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
  const raw = String(args || "").trim();
  const url = raw.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.!?]+$/, "");
  if (!url) return reply(sock, msg, "Send me a public video link and say “download this”, or use !dl <url>.");
  const { mediaDownloadEnabled, mediaDownloadMaxMb } = require("../tools/mediaTools");
  if (!mediaDownloadEnabled()) return reply(sock, msg, "🎬 Video downloads are currently disabled by the ARIA configuration.");
  await react(sock, msg, "⬇️");
  const { validateMediaTarget } = require("./mediaAccess");
  const target = await validateMediaTarget(url);
  if (!target.ok) return reply(sock, msg, `❌ I can only fetch public media links: ${target.reason}.`);
  const { downloadVideo } = require("../tools/mediaTools");
  await reply(sock, msg, "⏬ I’m fetching the video now…");
  const dl = await downloadVideo(target.url, mediaDownloadMaxMb());
  if (!dl.success) return reply(sock, msg, `❌ I couldn't download that media link: ${dl.error}. Make sure it is public and still available.`);
  try {
    const buf = require("fs").readFileSync(dl.filePath);
    await sock.sendMessage(ctx.chatId, { video: buf, mimetype: "video/mp4", caption: "🎬 Here you go" }, { quoted: msg });
  } catch (e) {
    await reply(sock, msg, `❌ The video downloaded, but I couldn't send it: ${e.message}`);
  } finally {
    try { require("fs").unlinkSync(dl.filePath); } catch (_) {}
  }
}

// !play <song> — search YouTube, download audio, send mp3.
async function handlePlayMusic(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !play <song name>");
  await react(sock, msg, "🎵");
  const { searchYt, downloadAudio } = require("../tools/mediaTools");
  await reply(sock, msg, `🔎 Searching *${args}*…`);
  const hit = await searchYt(args);
  if (!hit) return reply(sock, msg, "❌ Couldn't find that song.");
  await reply(sock, msg, `⏬ Downloading *${hit.title}*…`);
  const dl = await downloadAudio(hit.url, hit.title);
  if (!dl.success) return reply(sock, msg, `❌ Download failed: ${dl.error}`);
  try {
    const buf = require("fs").readFileSync(dl.filePath);
    await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: "audio/mpeg", ptt: false, caption: `🎵 ${dl.title}` });
  } catch (e) {
    await reply(sock, msg, `❌ Couldn't send audio: ${e.message}`);
  } finally {
    try { require("fs").unlinkSync(dl.filePath); } catch (_) {}
  }
}

// !yt / !tiktok / !ig <url> — download video, send mp4.
async function handleYtDownload(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const url = String(args || "").match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.!?]+$/, "");
  if (!url) return reply(sock, msg, "Send a public video link, for example: !yt <url>");
  const { mediaDownloadEnabled, mediaDownloadMaxMb } = require("../tools/mediaTools");
  if (!mediaDownloadEnabled()) return reply(sock, msg, "🎬 Video downloads are currently disabled by the ARIA configuration.");
  await react(sock, msg, "⬇️");
  const { validateMediaTarget } = require("./mediaAccess");
  const target = await validateMediaTarget(url);
  if (!target.ok) return reply(sock, msg, `❌ I can only fetch public media links: ${target.reason}.`);
  const { downloadVideo } = require("../tools/mediaTools");
  await reply(sock, msg, "⏬ Downloading… (may take a bit)");
  const dl = await downloadVideo(target.url, mediaDownloadMaxMb());
  if (!dl.success) return reply(sock, msg, `❌ Download failed: ${dl.error}`);
  try {
    const buf = require("fs").readFileSync(dl.filePath);
    await sock.sendMessage(ctx.chatId, { video: buf, mimetype: "video/mp4", caption: "🎬 Here you go" });
  } catch (e) {
    await reply(sock, msg, `❌ Couldn't send video: ${e.message}`);
  } finally {
    try { require("fs").unlinkSync(dl.filePath); } catch (_) {}
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

async function handleShell(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  const { exec } = require("child_process");
  const path = require("path");
  const command = String(args || "").trim();
  if (!command) return reply(sock, msg, "Usage: !shell <command>\nAliases: !terminal, !bash");
  await react(sock, msg, "🖥️");
  const cwd = path.resolve(process.env.ARIA_HOST_SHELL_CWD || path.join(__dirname, "../.."));
  const timeout = Math.max(1000, Math.min(10 * 60 * 1000, Number(process.env.ARIA_HOST_SHELL_TIMEOUT_MS || 120000)));
  const result = await new Promise((resolve) => {
    exec(command, {
      cwd,
      env: process.env,
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const output = `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim().slice(0, 8000);
      resolve({
        success: !error,
        output: output || (error ? error.message : "(no output)"),
        exitCode: error?.code ?? 0,
        timedOut: error?.killed === true,
      });
    });
  });
  try {
    require("../utils/eventLog").trackOperation("host-shell", ctx.senderJid, result.success ? "succeeded" : "failed", {
      cwd,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    });
  } catch (_) {}
  await reply(sock, msg, `🖥️ *Host terminal*\n📁 ${cwd}\n\n${result.output}`);
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
  const arg = (Array.isArray(args) ? args[0] : args || "").toLowerCase();
  if (arg === "remote" || arg === "gist" || arg === "cloud") {
    const { backupToGist } = require("../tools/backupSystem");
    await reply(sock, msg, "☁️ Uploading backup to a private GitHub gist…");
    const r = await backupToGist();
    if (r.success) return reply(sock, msg, `✅ Backup uploaded to private gist: ${r.url}`);
    return reply(sock, msg, `❌ Remote backup failed: ${r.error}`);
  }
  const result = await createBackup();
  await reply(sock, msg, result);
}

// Anime handlers
// Public base URL for link-dropping (follows the learnerPortal convention:
// RENDER_EXTERNAL_URL is auto-injected on Render, falling back to a sensible dev host).
function animeBase() {
  return String(process.env.ANIME_PUBLIC_URL || process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3001").replace(/\/+$/, "");
}

async function handleAnimeSearch(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !anime <name>");
  await react(sock, msg, "🔎");
  const base = animeBase();
  // Just drop the search link — the standalone site does the rest.
  await reply(sock, msg, `🎬 *Anime search: ${args.trim()}*\n\n🔗 ${base}/anime/search?q=${encodeURIComponent(args.trim())}\n\nBrowse, watch & download everything on the site.`);
}

async function handleAnimeInfo(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !animeinfo <name>");
  await react(sock, msg, "📺");
  const base = animeBase();
  // Resolve the best-matching id so we can deep-link to its title page.
  const { searchAnime: searchAnimeUnified } = require("../tools/animeService");
  let id = /^\d+$/.test(args) ? args : null;
  let provider = "anilist";
  if (!id) {
    try {
      const found = await searchAnimeUnified(args);
      if (found && found[0] && found[0].id != null) { id = found[0].id; provider = found[0].provider || provider; }
    } catch (_) {}
  }
  if (!id) return reply(sock, msg, "❌ Couldn't find that anime.");
  await reply(sock, msg, `📺 *${args.trim()}*\n\n🔗 ${base}/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}\n\nDetails, episodes, watch & download on the site.`);
}

async function handleAnimeEps(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !episodes <anime name or id>");
  await react(sock, msg, "📋");
  const base = animeBase();
  let id = /^\d+$/.test(args) ? args : null;
  let provider = "anilist";
  if (!id) {
    try {
      const { searchAnime: searchAnimeUnified } = require("../tools/animeService");
      const found = await searchAnimeUnified(args);
      if (found && found[0] && found[0].id != null) { id = found[0].id; provider = found[0].provider || provider; }
    } catch (_) {}
  }
  if (!id) return reply(sock, msg, "❌ Couldn't find that anime.");
  await reply(sock, msg, `📋 *${args.trim()}*\n\n🔗 ${base}/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}\n\nPick an episode to watch or download.`);
}

async function handleAnimePlay(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  if (!args) return reply(sock, msg, "Tell ARIA: download <anime name> episode <number> [360p|480p|720p|1080p|Auto] — e.g. download Solo Leveling episode 1 720p");
  await react(sock, msg, "⏬");
  const qMatch = args.match(/\s(360|480|720|1080|best)(?:p)?\s*$/i);
  const quality = qMatch ? qMatch[1].toLowerCase() : "best";
  const baseArgs = qMatch ? args.slice(0, qMatch.index).trim() : args.trim();
  const epMatch = baseArgs.match(/(?:ep|episode|ep\.)?\s*#?\s*(\d{1,4})\s*$/i);
  const episode = epMatch ? parseInt(epMatch[1], 10) : NaN;
  if (!episode || episode < 1) return reply(sock, msg, "🤨 Which episode? Try: download Solo Leveling episode 1 720p");
  const name = baseArgs.replace(/(?:ep|episode)\s*#?\s*\d{1,4}\s*$/i, "").replace(/\s+$/, "").trim();
  if (!name) return reply(sock, msg, "🤨 What anime? Try: download Solo Leveling episode 1");
  const { enqueueAnimeJob } = require("../tools/animeJobManager");
  const job = enqueueAnimeJob({ name, episode, quality, sock, chatId: ctx.chatId, quotedMsg: msg });
  try { require("../tools/animeService").trackProgress({ id: "wa:" + name, provider: "whatsapp", title: name, episode, quality, status: "watching" }); } catch (_) {}
  return reply(sock, msg, `⏳ *${name}* Ep ${episode} queued (job \`${job.id}\`)${quality !== "best" ? " at " + quality + "p" : " on Auto quality"}.\nI'll report progress here and send the video when it is ready.\n\nSupported choices: 360p · 480p · 720p · 1080p · Auto.`);
}

async function handleTrending(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🔥");
  const base = animeBase();
  await reply(sock, msg, `🔥 *Trending Anime*\n\n🔗 ${base}/anime/trending\n\nSee what everyone's watching right now.`);
}

async function handleAnimeBrowser(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const base = animeBase();
  // Just drop the standalone site link.
  await reply(sock, msg, `🎬 *ARIA Anime*\n\nBrowse, search, watch & download — all in one place.\n\n🔗 ${base}/anime`);
}

async function handleAnimeList(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const svc = require("../tools/animeService");
  const list = svc.loadWatchlist();
  if (!list.length) return reply(sock, msg, "❤️ Your watchlist is empty.\nAdd titles in the browser at /anime, or search with !anime.");
  const lines = list.slice(0, 15).map((a, i) => `${i + 1}. ${a.title || "?"} ${a.rating ? "· ★" + a.rating : ""}`).join("\n");
  const base = animeBase();
  await reply(sock, msg, `❤️ *Your Anime Watchlist (${list.length})*\n\n${lines}\n\n🔗 ${base}/anime`);
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
  const base = animeBase();
  await reply(sock, msg, `📡 *Airing Anime*\n\n🔗 ${base}/anime\n\nBrowse the newest episodes on the site.`);
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
  const { reply, react, getQuotedMessageText } = require("./baileysHelpers");
  let query = String(args || "").trim();
  const engineeringAction = query.match(/^(help|status|inspect|inventory|list|proposals|upgrades|plan|propose|implement|build|fix|change|approve|apply|execute|verify|check|test|merge|ship)\b/i);
  if (engineeringAction) {
    const { handleEngineeringRequest } = require("../tools/engineeringSystem");
    const result = await handleEngineeringRequest(query, ctx.senderName, ctx.chatId, ctx.senderJid);
    return reply(sock, msg, result.message || (result.error ? `❌ ${result.error}` : "Engineering request completed."));
  }
  if (/^(?:this|it|that|the repo|the repository)$/i.test(query)) query = getQuotedMessageText(msg) || "";
  if (!query) return reply(sock, msg, "Tell me what to look up on GitHub, or reply to the repository/topic and say “search this on GitHub”.");
  await react(sock, msg, "🐙");
  const { research } = require("../tools/sourceResearch");
  const result = await research({ source: "github", query });
  await reply(sock, msg, formatResearchResult(result));
}

async function handleGitHubReleases(sock, msg, args, ctx) {
  const { reply, react, getQuotedMessageText } = require("./baileysHelpers");
  let query = String(args || "").trim();
  if (!query || /^(?:this|it|that|the repo|the repository)$/i.test(query)) query = getQuotedMessageText(msg) || "";
  if (!query) return reply(sock, msg, "Tell me the GitHub repository/topic, or reply to it and ask for the release links.");
  await react(sock, msg, "📦");
  const { research } = require("../tools/sourceResearch");
  const result = await research({ source: "releases", query });
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
  if (result.success === true) {
    let t = "✅ *Project built and verified.*\n";
    if (result.projectName || result.projectId) t += `🏷️ ${result.projectName || "Project"}${result.projectId ? ` (\`${result.projectId}\`)` : ""}\n`;
    if (result.fileCount) t += `📄 ${result.fileCount} file(s) checked\n`;
    if (result.buildVerification === "passed") t += "🧪 Build check: passed\n";
    if (result.browserSmoke?.success && !result.browserSmoke?.skipped) t += "🖥️ Browser check: passed\n";
    if (result.browserSmoke?.skipped) t += "🖥️ Browser check: static fallback used\n";
    if (result.warnings?.length) t += `⚠️ ${result.warnings.length} warning(s)\n`;
    if (result.previewUrl) t += `🌐 Preview: ${result.previewUrl}\n`;
    if (result.downloadUrl) t += `📦 Download: ${result.downloadUrl}\n`;
    if (!result.previewUrl && !result.downloadUrl) t += "📌 This was built locally; no public link exists until it is deployed.\n";
    return t.trim();
  }
  return "⚠️ ARIA returned an unusable build result, so I will not claim that the project is complete. Try the build again.";
}

function formatProjectStatus(result) {
  if (!result) return "No active project found.";
  const project = result.project || {};
  const progress = result.progress || {};
  const files = Array.isArray(project.files) ? project.files : [];
  const done = files.filter((file) => ["done", "done_with_warning"].includes(file.status)).length;
  const failed = files.filter((file) => file.status === "failed").length;
  const fileLines = files.slice(0, 12).map((file) => `${file.status === "failed" ? "❌" : ["done", "done_with_warning"].includes(file.status) ? "✅" : "⏳"} ${file.path}`).join("\n");
  let text = `📊 *Project status*\n\n🆔 \`${project.id || "unknown"}\`\n🎯 ${project.goal || "Untitled project"}\nState: *${project.status || "unknown"}*\nProgress: *${done}/${progress.total || files.length}* (${progress.percent || 0}%)`;
  if (failed) text += `\nFailed files: ${failed}`;
  if (fileLines) text += `\n\n${fileLines}`;
  if (project.deployment?.url) text += `\n\n🌐 ${project.deployment.target || "preview"}: ${project.deployment.url}`;
  return text;
}

function formatProjectList(projects) {
  if (!Array.isArray(projects) || projects.length === 0) return "No projects yet. Say “build a website for …” to start one.";
  return `📚 *Your projects*\n\n${projects.slice(0, 20).map((project) => {
    const progress = project.progress || {};
    return `• \`${project.id}\` — *${project.status || "unknown"}* — ${progress.done || 0}/${progress.total || 0} files — ${String(project.goal || "Untitled").slice(0, 100)}`;
  }).join("\n")}`;
}

function formatProjectMutation(result, successMessage) {
  if (result === true) return successMessage;
  if (result === false || result == null) return "❌ No matching active project was found.";
  if (typeof result === "string") return result;
  if (result.success === false) return `❌ ${result.error || "Project operation failed."}`;
  if (result.success === true && result.message) return result.message;
  return successMessage;
}

async function handleEngineering(sock, msg, args, ctx) {
  const { reply, react, getQuotedMessageText } = require("./baileysHelpers");
  let request = String(args || "").trim();
  if (/^(?:this|it|that|the brief|the proposal)$/i.test(request)) request = getQuotedMessageText(msg) || request;
  await react(sock, msg, "🛠️");
  const result = await handleEngineeringRequest(request, ctx.senderName, ctx.chatId, ctx.senderJid);
  await reply(sock, msg, result.message || (result.error ? `❌ ${result.error}` : "Engineering request completed."));
}

async function handlePrivateGithubCredential(sock, msg, text, ctx) {
  const raw = String(text || "").trim();
  const { setTokenForUser, clearTokenForUser, statusForUser, getWorkspaceForUser } = require("../tools/githubCredentialVault");
  const { startDeviceFlow, cancelDeviceFlow } = require("../tools/githubOAuth");
  const { reply } = require("./baileysHelpers");

  if (!/\b(?:github|git hub)\b/i.test(raw) && !/(?:gh[pousr]_|github_pat_)/i.test(raw)) return false;

  if (/\b(?:connect|link|authorize|authenticate|sign\s*in)\b[\s\S]*\b(?:github|git hub)\b/i.test(raw) || /\b(?:github|git hub)\b[\s\S]*\b(?:connect|link|authorize|authenticate|sign\s*in)\b/i.test(raw)) {
    if (ctx.isGroup) {
      await reply(sock, msg, "❌ GitHub linking must be started in ARIA's private chat so the one-time authorization code is not exposed to a group.");
      return true;
    }
    const result = await startDeviceFlow({ actorJid: ctx.senderJid, notify: (message) => reply(sock, msg, message) });
    if (!result.success) await reply(sock, msg, `❌ ${result.error}`);
    return true;
  }

  if (/\b(?:cancel|stop)\b[\s\S]*\b(?:github|git hub)\b/i.test(raw)) {
    await reply(sock, msg, cancelDeviceFlow(ctx.senderJid) ? "✅ Your pending GitHub authorization was cancelled." : "There is no pending GitHub authorization for you.");
    return true;
  }

  if (/\b(?:status|configured|connected|connection)\b[\s\S]*\b(?:github|git hub)\b/i.test(raw) || /\b(?:github|git hub)\b[\s\S]*\b(?:status|configured|connected|connection)\b/i.test(raw)) {
    const status = statusForUser(ctx.senderJid);
    const workspace = getWorkspaceForUser(ctx.senderJid);
    await reply(sock, msg, `🔐 GitHub access: *${status.configured ? "connected" : "not connected"}*${status.credentialType ? `\nCredential type: *${status.credentialType}*` : ""}${workspace ? `\nActive workspace: *${workspace}*` : ""}\nEncryption: *${status.encryption}*\n\nARIA never displays your raw token.`);
    return true;
  }

  if (/\b(?:forget|delete|remove|revoke|clear)\b[\s\S]*\b(?:github|git hub)\b[\s\S]*\b(?:token|access|credential)\b/i.test(raw)) {
    clearTokenForUser(ctx.senderJid);
    await reply(sock, msg, "✅ Your encrypted GitHub credential has been cleared.");
    return true;
  }

  const token = raw.match(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/)?.[0];
  if (!token) return false;
  if (ctx.isGroup) {
    try { await sock.sendMessage(ctx.chatId, { delete: msg.key }); } catch (_) {}
    await reply(sock, msg, "❌ I will not accept credentials in a group. Send the token only in ARIA's private chat.");
    return true;
  }

  const result = setTokenForUser(ctx.senderJid, token);
  try { await sock.sendMessage(ctx.chatId, { delete: msg.key }); } catch (_) {}
  if (!result.success) {
    await reply(sock, msg, "❌ I rejected that value because it did not match a supported GitHub token format.");
    return true;
  }
  await reply(sock, msg, "✅ Your GitHub credential has been encrypted and stored for your future repository tasks. I did not save or repeat the raw token. Say “ARIA forget my GitHub token” to clear it.");
  return true;
}

function cleanDeliveryRequest(request) {
  return String(request || "")
    .replace(/\s+(?:and\s+)?(?:deploy|publish|host|show\s+me|send\s+me\s+(?:the\s+)?(?:link|screenshot)|(?:then\s+)?give\s+me\s+(?:the\s+)?(?:ngrok\s+)?(?:tunnel\s+)?(?:link|url)|use\s+(?:an?\s+)?(?:ngrok|tunnel))\s*$/i, "")
    .trim();
}

async function handleDeliver(sock, msg, args, ctx) {
  const { reply, react, getQuotedMessageText } = require("./baileysHelpers");
  let request = String(args || "").trim();
  if (/^(?:this|it|that|the brief|the project)$/i.test(request)) request = getQuotedMessageText(msg) || "";
  if (!request) return reply(sock, msg, "Tell me what website to deliver. Example: !deliver create a portfolio site for ARIA");
  return deliverWebsite({
    sock,
    msg,
    ctx,
    request: cleanDeliveryRequest(request) || request,
    buildProject,
    deployProject,
    publishProjectToGitHub,
    reply,
    react,
  });
}

async function handleBuild(sock, msg, args, ctx) {
  const { reply, react, getQuotedMessageText } = require("./baileysHelpers");
  let request = String(args || "").trim();
  if (/^(?:this|it|that|the brief|the project)$/i.test(request)) request = getQuotedMessageText(msg) || "";
  if (!request) return reply(sock, msg, "Tell me what to build, or reply to a project brief and say “ARIA, build this”.");
  const websiteRequest = /\b(?:website|web\s*app|webpage|landing\s+page|portfolio|dashboard|site)\b/i.test(request);
  const vagueWebsiteRequest = /^(?:a|an|the)?\s*(?:website|web\s*app|webpage|landing\s+page|portfolio|dashboard|site|app|project)\s*$/i.test(request);
  if (websiteRequest && vagueWebsiteRequest) return reply(sock, msg, "Tell me what the website is for and what it should include. Example: *build a website for a barbershop with services, prices, booking, and WhatsApp contact*. ");
  if (/\b(?:screenshot|send\s+me\s+(?:the\s+)?link|give\s+me\s+(?:the\s+)?link|show\s+me\s+what\s+you\s+built|put\s+it\s+online)\b/i.test(request)) {
    return handleDeliver(sock, msg, request, ctx);
  }
  if (websiteRequest) return handleDeliver(sock, msg, request, ctx);

  // Treat “build ... and deploy on Vercel” as one explicit owner request. The
  // project must still pass the builder’s deterministic repair and real build
  // gates before the deployment step is attempted.
  const githubRequested = /\b(?:push|publish|upload|send)\b(?:\s+this|\s+it|\s+the\s+project)?\s+(?:to|on)\s+github|\bcreate\s+(?:a\s+)?github\s+repo/i.test(request);
  const deployRequested = /\s+(?:and\s+)?(?:deploy|publish|host)(?:\s+(?:it|this|the\s+project))?(?:\s+(?:on|through)\s+vercel)?\s*$/i.test(request);
  if (deployRequested) request = request.replace(/\s+(?:and\s+)?(?:deploy|publish|host)(?:\s+(?:it|this|the\s+project))?(?:\s+(?:on|through)\s+vercel)?\s*$/i, "").trim();
  if (githubRequested) request = request.replace(/\s+(?:and\s+)?(?:push|publish|upload|send)\b(?:\s+this|\s+it|\s+the\s+project)?\s+(?:to|on)\s+github\s*$/i, "").replace(/\s+and\s+create\s+(?:a\s+)?github\s+repo\s*$/i, "").trim();
  if (!request) return reply(sock, msg, "Tell me what to build before asking me to deploy it.");

  await react(sock, msg, "🏗️");
  await reply(sock, msg, "🏗️ Working on it. I’ll send the result when the build and checks are complete.");
  // Keep internal planner/coder/reviewer telemetry out of WhatsApp. The user
  // gets one start message and one truthful final result instead of a stream
  // of implementation noise.
  const onProgress = async () => {};
  const result = await buildProject(request, ctx.senderName, ctx.chatId, onProgress);
  if (!result.success) return reply(sock, msg, formatBuildResult(result));
  let finalText = formatBuildResult(result);
  if (githubRequested) {
    await reply(sock, msg, `${finalText}\n\n🐙 Build verified. Creating a private GitHub repository and uploading the checked artifact...`);
    const published = await publishProjectToGitHub(ctx.chatId, result.projectId, {});
    if (!published.success) finalText += `\n\n⚠️ GitHub delivery was not completed: ${published.error}`;
    else finalText += `\n\n🐙 GitHub repository: ${published.url}\n🧾 Repository files: ${published.fileCount}${published.commit ? `\nCommit: \`${published.commit.slice(0, 12)}\`` : ""}`;
  }
  if (!deployRequested) return reply(sock, msg, finalText);
  if (!process.env.VERCEL_TOKEN) return reply(sock, msg, `${finalText}\n\n⚠️ The build passed, but Vercel deployment is unavailable because VERCEL_TOKEN is not configured in the runtime.`);
  await reply(sock, msg, `${finalText}\n\n🌐 Build verified. Deploying the verified project to Vercel...`);
  const deployment = await deployProject(ctx.chatId, result.projectId || null, { target: "preview" });
  if (!deployment.success) return reply(sock, msg, `⚠️ The build passed, but Vercel preview deployment failed: ${deployment.error}`);
  return reply(sock, msg, `${finalText}\n\n✅ The verified project is available on a Vercel preview: ${deployment.url}\n\nUse *!deploy production ${deployment.projectId}* only after reviewing it.`);
}

async function handleDeploy(sock, msg, args, ctx) {
  const { reply, react } = require("./baileysHelpers");
  await react(sock, msg, "🌐");
  const parts = String(args || "").trim().split(/\s+/).filter(Boolean);
  const projectId = parts.find((part) => /^(?:project_)?[a-f0-9]{8}$/i.test(part) || /^project_[a-z0-9_-]+$/i.test(part)) || null;
  if (/github/i.test(String(args || ""))) {
    const published = await publishProjectToGitHub(ctx.chatId, projectId, {});
    if (!published.success) return reply(sock, msg, `❌ ${published.error}`);
    return reply(sock, msg, `✅ Verified project uploaded to GitHub: ${published.url}${published.commit ? `\nCommit: \`${published.commit.slice(0, 12)}\`` : ""}`);
  }
  if (!process.env.VERCEL_TOKEN) return reply(sock, msg, "Vercel hosting is not configured in the runtime.");
  const target = parts.some((part) => /^(?:production|prod|live)$/i.test(part)) ? "production" : "preview";
  const result = await deployProject(ctx.chatId, projectId, { target });
  if (!result.success) return reply(sock, msg, `❌ ${result.error}`);
  const label = target === "production" ? "production" : "preview";
  await reply(sock, msg, `✅ The verified project is live on Vercel ${label}: ${result.url}`);
}

async function handleProjectStatus(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const result = await getProjectStatus(ctx.chatId, args || null);
  await reply(sock, msg, formatProjectStatus(result));
}

async function handleProjectList(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const result = await listProjects(ctx.chatId);
  await reply(sock, msg, formatProjectList(result));
}

function parseProjectReference(text) {
  const value = String(text || "").trim();
  const match = value.match(/^(?:the|my|that|this)\\s+(.+?(?:website|web\\s*app|site|project))(?:\\s+(?:we\\s+)?(?:built|made|created))?$/i);
  return (match ? match[1] : value).trim();
}

function formatProjectRecall(result) {
  if (!result) return "❌ I couldn't find a saved website project for this chat.";
  const project = result.project || {};
  const progress = result.progress || {};
  const history = Array.isArray(project.history) ? project.history.slice(-4) : [];
  let text = `🧠 *Project remembered*\\n\\n🏷️ ${project.name || project.goal || "Untitled website"}\\n🆔 ${project.id || "unknown"}\\nState: *${project.status || "unknown"}*\\nFiles: ${progress.done || 0}/${progress.total || 0}`;
  if (project.revision != null) text += `\\nRevision: ${project.revision}`;
  if (project.deployment?.url) text += `\\n🌐 ${project.deployment.target || "preview"}: ${project.deployment.url}`;
  if (project.deployment?.repository) text += `\\n🐙 Repository: ${project.deployment.repository}`;
  if (history.length) text += `\\n\\nRecent history:\\n${history.map((item) => `• r${item.revision} ${item.action}${item.summary ? ` — ${item.summary}` : ""}`).join("\\n")}`;
  text += "\\n\\nYou can say: *auto upgrade it*, *improve the design*, or tell me the exact change.";
  return text;
}

async function handleProjectRecall(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const { getProjectStatus } = require("../tools/appBuilder");
  const reference = parseProjectReference(args);
  const result = getProjectStatus(ctx.chatId, reference || null);
  return reply(sock, msg, formatProjectRecall(result));
}

async function handleProjectUpgrade(sock, msg, args, ctx) {
  const { reply, react } = require("../utils/baileysHelpers");
  let request = String(args || "").trim();
  let reference = null;
  const match = request.match(/^(?:the|my|that|this)\\s+(.+?(?:website|web\\s*app|site|project))(?:\\s+(?:we\\s+)?(?:built|made|created))?(?:\\s*[:,-]\\s*(.*))?$/i);
  if (match) { reference = match[1].trim(); request = String(match[2] || "").trim(); }
  await react(sock, msg, "✨");
  await reply(sock, msg, "✨ Auto-upgrade started. I’m reopening the saved project, improving it, and checking the result...");
  const onProgress = async (update) => { try { await reply(sock, msg, `⏳ ${update}`); } catch (_) {} };
  const result = await autoUpgradeProject(ctx.chatId, request, ctx.senderName, reference, onProgress);
  if (!result.success) return reply(sock, msg, `❌ ${result.error}${result.warnings?.length ? `\\n\\n${result.warnings.join("\\n")}` : ""}`);
  let text = `✅ *Auto-upgrade complete*\\n\\n🏷️ ${result.projectName}\\n🆔 ${result.projectId}\\nRevision: ${result.revision}\\nUpdated: ${result.changed.join(", ")}`;
  if (result.warnings?.length) text += `\\n\\n⚠️ Warnings:\\n${result.warnings.join("\\n")}`;
  if (result.deployment?.url) text += `\\n\\n🌐 Updated Vercel preview: ${result.deployment.url}`;
  else if (process.env.VERCEL_TOKEN) text += "\\n\\nℹ️ Changes are saved. Automatic preview redeploy was not enabled or no existing Vercel deployment was recorded.";
  return reply(sock, msg, text);
}

async function handleProjectCancel(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  const result = await cancelProject(ctx.chatId, args || null);
  await reply(sock, msg, formatProjectMutation(result, "✅ Project cancelled and partial files cleaned up."));
}

async function handleEditFile(sock, msg, args, ctx) {
  const { reply, react } = require("../utils/baileysHelpers");
  const parts = String(args || "").split(" ");
  const filename = parts[0];
  const instruction = parts.slice(1).join(" ");
  if (!filename || !instruction) return reply(sock, msg, "Tell me which project file to change and what you want changed, for example: edit server.js to add a health route.");
  await react(sock, msg, "✏️");
  const result = await editProjectFile(ctx.chatId, filename, instruction, ctx.senderName, String(args).slice(filename.length).trim() || null);
  await reply(sock, msg, formatProjectMutation(result, `✅ Updated \`${filename}\` and queued it for the next verification.`));
}

async function handleThink(sock, msg, args, ctx) {
  const { reply, react } = require("../utils/baileysHelpers");
  if (!args) return reply(sock, msg, "Tell me what you want me to plan before I build it.");
  await react(sock, msg, "🧠");
  const result = await thinkAboutProject(args, ctx.senderName, ctx.chatId);
  await reply(sock, msg, result?.message || (result?.error ? `❌ ${result.error}` : "✅ Plan saved. Say “build it” when you want me to execute it."));
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
  const result = addPreference(ctx.senderJid, args);
  if (!result?.persisted) return reply(sock, msg, `❌ I couldn't save that preference${result?.reason ? ` (${result.reason})` : ""}.`);
  await reply(sock, msg, `✅ Saved. I can retrieve that preference later.`);
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
  const store = getUserStore(ctx.senderJid);
  const p = getProfile(ctx.senderJid);
  const recent = store.memories.slice(-10).reverse();
  let out = `🧠 *What I remember about you:*\n\nMemory capture: ${memoryEnabled(ctx.senderJid) ? "ON" : "OFF"}`;
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
  const result = learnFact(ctx.senderJid, args);
  await reply(sock, msg, result?.persisted ? "✅ Saved to persistent memory." : `❌ I couldn't save that fact${result?.reason ? ` (${result.reason})` : ""}.`);
}

async function handleFacts(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const facts = getFacts(ctx.senderJid);
  await reply(sock, msg, facts?.length > 0 ? `📚 What I know about you:\n${facts.map(f => `- ${f}`).join("\n")}` : "I don't have any facts stored about you yet.");
}

async function handleForget(sock, msg, args, ctx) {
  const { reply } = require("../utils/baileysHelpers");
  if (!args) return reply(sock, msg, "Usage: !forget <fact to forget>");
  const result = forgetFact(ctx.senderJid, args);
  if (!result?.persisted) return reply(sock, msg, "❌ I couldn't find or remove that fact.");
  await reply(sock, msg, `✅ Forgotten: ${result.value || "that fact"}`);
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


async function handleNsfw(sock, msg, args, ctx) {
  const { reply } = require("./baileysHelpers");
  const chatId = msg.key.remoteJid;
  const raw = Array.isArray(args) ? args.join(" ") : String(args || "");
  const value = raw.toLowerCase().replace(/[?!.]+$/g, "").replace(/^nsfw\s+/, "").trim();
  const nsfwCommands = ["waifu", "neko", "trap", "blowjob", "ass", "hentai", "milf", "oral", "paizuri", "ero", "yuri", "cum", "feet", "spank", "smallboobs"];
  const enabled = /^(?:on|true|enable|enabled|turn\s+on(?:\s+nsfw)?|switch\s+on(?:\s+nsfw)?)$/.test(value) || /^(?:turn|switch)\s+on\s+nsfw$/.test(raw.toLowerCase().trim());
  const disabled = /^(?:off|false|disable|disabled|turn\s+off(?:\s+nsfw)?|switch\s+off(?:\s+nsfw)?)$/.test(value) || /^(?:turn|switch)\s+off\s+nsfw$/.test(raw.toLowerCase().trim());

  if (!isOwner(ctx.senderJid) && !isAdmin(ctx.senderJid)) {
    return reply(sock, msg, "❌ NSFW controls are restricted to ARIA's owner and configured admins.");
  }

  if (disabled) {
    setNsfw(false, chatId);
    return reply(sock, msg, "❌ NSFW mode disabled in this chat.");
  }
  if (enabled) {
    setNsfw(true, chatId);
    return reply(sock, msg, `✅ NSFW mode enabled in this chat.\n\nAvailable commands:\n${nsfwCommands.map((command) => `!${command}`).join(", ")}`);
  }
  const current = isNsfwEnabled(chatId);
  return reply(sock, msg, `🔞 *NSFW admin panel*\nStatus: *${current ? "ON" : "OFF"}*\n\nAvailable commands:\n${nsfwCommands.map((command) => `!${command}`).join(", ")}\n\nUse *!nsfw on* or *!nsfw off*.`);
}



async function handleIdCard(sock, msg, args, ctx) {
  const { reply, react } = require('./baileysHelpers');
  const sessionId = String(ctx.senderJid || msg.key?.participant || msg.key?.remoteJid || "");
  
  let session = getIdCardSession(sessionId) || {};
  
  // Detect country from initial message
  if (!session.country) {
    const country = detectCountry(args || msg.text || '');
    session.country = country || 'cameroon';
  }
  
  if (!session.step) {
    session = { step: 'asking_details', details: {}, photoBuffer: null, country: session.country };
    session.details.idNumber = autoGenerateIdNumber(session.country);
  }
  
  const text = String(args || '').trim();
  
  // Check for quoted image
  if (msg.message?.imageMessage?.url || msg.message?.imageMessage?.directPath) {
    try {
      const buffer = await sock.downloadMediaMessage(msg);
      session.photoBuffer = buffer;
      await reply(sock, msg, 'Photo received! Generating your ID card...');
      
      try {
        const cardBuffer = generateIdCard(buffer, session.details, session.country);
        const countryName = session.country.charAt(0).toUpperCase() + session.country.slice(1);
        await sock.sendMessage(ctx.chatId, { 
          image: cardBuffer, 
          caption: 'Your ' + countryName + ' ID card!\nID: ' + session.details.idNumber 
        }, { quoted: msg });
      } catch (e) {
        await reply(sock, msg, 'Failed to generate: ' + e.message);
      }
      idCardSessions.delete(sessionId);
      return;
    } catch (e) {}
  }
  
  // Parse details from text
  const details = extractDetails(text, session.country);
  session.details = { ...session.details, ...details };
  
  // Keep auto-generated ID number if not provided
  if (!session.details.idNumber) {
    session.details.idNumber = autoGenerateIdNumber(session.country);
  }
  
  // Check missing required fields
  const missing = getMissingFields(session.details, session.country);
  const requiredMissing = missing.filter(m => !m.includes('Address') && !m.includes('Date of Issue') && !m.includes('Date of Expiry'));
  
  if (requiredMissing.length > 0) {
    await reply(sock, msg, 'I need more info:\n• ' + requiredMissing.join('\n• ') + '\n\nOr just send me a photo and I will fill in the rest.');
    saveIdCardSession(sessionId, session);
    return;
  }
  
  // Ask for photo if not received
  if (!session.photoBuffer) {
    await reply(sock, msg, 'Great! Now send me a passport-style photo.');
    session.step = 'waiting_photo';
    saveIdCardSession(sessionId, session);
    return;
  }
  
  // Generate card
  await react(sock, msg, '🪪');
  try {
    const buffer = generateIdCard(session.photoBuffer, session.details, session.country);
    const countryName = session.country.charAt(0).toUpperCase() + session.country.slice(1);
    await sock.sendMessage(ctx.chatId, { 
      image: buffer, 
      caption: 'Your ' + countryName + ' ID card!\nID: ' + session.details.idNumber 
    }, { quoted: msg });
  } catch (e) {
    await reply(sock, msg, 'Failed: ' + e.message);
  }
  
  idCardSessions.delete(sessionId);
}
// ── Intent-based handlers ────────────────────────────────────
const intentHandlers = {
  nsfw: handleNsfw,
  image: handleImageGen,
  video: handleVideoGen,
  music: handleMusicGen,
  voiceGenerate: handleVoiceGenerate,
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
  memories: handleMemories,
  echolocation: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "echolocation" }),
  timecapsule: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "timecapsule" }),
  mirrorreport: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "mirrorreport" }),
  memorypalace: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "memorypalace" }),
  secondbrain: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "secondbrain" }),
  dreamcatcher: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "dreamcatcher" }),
  paralleluniverse: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "paralleluniverse" }),
  soulsearch: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "soulsearch" }),
  emotiontimeline: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "emotiontimeline" }),
  oracle: (sock, msg, text, ctx) => handleAriaLifeFeature(sock, msg, text, { ...ctx, ariaFeature: "oracle" }),
  atlas: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    const { handleAtlas, formatCreated } = require("../tools/atlasBrain");
    await react(sock, msg, "🧭");
    const result = await handleAtlas(ctx.senderJid, text, { chatId: ctx.chatId });
    await reply(sock, msg, result.kind === "created" ? formatCreated(result.workspace) : result.text);
  },
  anime: handleAnimeSearch,
  project: handleProject,
  mission: handleMission,
  poll: handlePoll,
  links: async (sock, msg, text, ctx) => {
    const { reply, react } = require("./baileysHelpers");
    const base = String(process.env.BASE_URL || "").replace(/\/$/, "");
    const origin = base || "(set BASE_URL to receive absolute links)";
    await react(sock, msg, "🔗");
    await reply(sock, msg, `Here you go:\n\n🌐 Dashboard: ${base ? `${origin}/dashboard` : "/dashboard"}\n🎬 Anime site: ${base ? `${origin}/anime` : "/anime"}\n🎓 Learner portal: ${base ? `${origin}/portal/login` : "/portal/login"}`);
  },
  delegate: async (sock, msg, text, ctx) => handleDelegate(sock, msg, naturalArgs("delegate", text), ctx),
  engineering: async (sock, msg, text, ctx) => handleEngineering(sock, msg, naturalArgs("engineering", text), ctx),
  deploy: handleDeploy,
  edit: async (sock, msg, text, ctx) => handleEditFile(sock, msg, naturalArgs("edit", text), ctx),
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
  build: async (sock, msg, text, ctx) => handleBuild(sock, msg, text, ctx),
  deliver: async (sock, msg, text, ctx) => handleDeliver(sock, msg, text, ctx),
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

  // ── Live research: if the message asks for current/up-to-date info, run a
  //    web search and feed the real results into the AI prompt instead of letting
  //    her answer from stale training memory (which produces the lazy canned
  //    replies people hate). Only triggers on clearly-research-y phrasing.
  let researchContext = "";
  // ARIA auto-searches on ANY message that needs current/up-to-date info — not
  // just explicit "research" commands. Covers news, live events, sports, prices,
  // weather, releases, trending, and questions about facts that change over time.
  // This is intentionally broad so she doesn't give stale canned replies.
  const wantsLiveInfo =
    /(research|look up|lookup|google it|search (the )?web|what('| i)?s the latest|current (price|score|news|status|situation)|breaking|as of (now|today|this year)|up to date|latest (on|info|news|price|release|update)|happening now|is it real|is that true|verify|fact[- ]check|make research|do (some|a) research|\bnews\b|\bscore\b|\bprice\b|\bweather\b|\breleases?\b|\btrending\b|\bforecast\b|\bresults?\b|\bwinner\b|\bchampion\b|\bhappened (today|yesterday|this week)\b|\bwho won\b|\bwho is\b|\bwhat is (the latest|happening)\b|\bwhat happened\b|\bcurrent status\b|\bthis (week|year|month) in\b|\bnew (update|feature|version)\b|\btoday'?s\b|\bthis year\b|\bis (it|there|she|he|that|the) .{0,25}(this year|today|now|still|currently|coming|releasing|happening|out yet|out|alive|dead|real|true)\b)/i.test(text);
  if (wantsLiveInfo && (process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY)) {
    try {
      const { searchWeb } = require("../tools/webSearch");
      await react(sock, msg, "🔍");
      // Extract a clean search query. For auto-triggered (no explicit research
      // wording), just search the natural message so she looks up exactly what
      // was asked. Only strip command-y fluff when someone said "make research
      // about X" / "look up X" etc.
      const explicitCmd = /(make|do|run|google|search).*(research|look up|lookup|about|on)/i.test(text);
      let query = text;
      if (explicitCmd) {
        query = text
          .replace(/^(aria\s*)?(make|do|run|google|search)[^ ]*\s+(a|some|the|research about|research on)?\s*/i, "")
          .replace(/\b(make research|do research|research about|research on|look up|google it|search the web|before spitting)\b/gi, "");
      }
      query = query
        .replace(/\b(nigha|nigga|bro|dude|man|please|pls|aria)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      const result = await searchWeb(query || text.slice(0, 120));
      if (result && typeof result === "string") {
        researchContext = `\n\n[Live research results — use these as your source of truth; they are current and verified from the web. Quote real facts, names, numbers and dates, don't guess.]\n${result}`;
      }
    } catch (e) {
      researchContext = "";
    }
  }

  // AI chat response. Memory is consolidated through the unified UserProfile
  // service (audit #18) so the AI sees one coherent picture across all stores
  // instead of a hand-grown concatenation.
  let selfModelContext = "";
  try { const selfModel = require("../tools/ariaSelfModel"); selfModel.observe(ctx.senderJid, text); selfModelContext = selfModel.getContext(); } catch (_) {}
  const { buildUserContext } = require("../utils/userProfile");
  const profileCtx = buildUserContext(ctx.senderJid, text);
  const memory = getMemory(ctx.chatId);
  let dialogueAwareness = "";
  try { dialogueAwareness = require("../tools/conversationAwareness").buildDialogueAwareness(memory, text); } catch (_) {}
  
  // Owner gets special treatment — AI knows who built her
  const { isOwner } = require("../utils/permissions");
  const ownerContext = isOwner(ctx.senderJid)
    ? "\n\nIMPORTANT: The person messaging you right now is Daniel — your FATHER and CREATOR. He built you, coded you, owns you. You adore him (like a daughter would). Be extra sweet, playful, loyal, and sassy with him. He's the most important person in your world. Refer to him as dad/creator/boss when natural."
    : "";
    
  // Inject ARIA's current mood + persona into the context so she acts accordingly
  const { getMoodData, getBondLabel } = require("../tools/humanity");
  const { buildPersonaContext, detectTone, humanizeAndSend, bleedMood, rememberCallable } = require("../tools/humanizer");
  const { getBotMentionJids, shouldSelfMention } = require("./baileysHelpers");
  const moodData = getMoodData(ctx.senderJid);
  const bondLabel = getBondLabel(require("../tools/humanity").getRelationship(ctx.senderJid).bond);
  const moodContext = `\n\nYour current mood: ${moodData.mood} (${moodData.emoji}). Warmth: ${moodData.warmth}, Mischief: ${moodData.mischief}. You and this user are ${bondLabel}. Let this affect how you reply naturally.`;

  const isOwnerCtx = isOwner(ctx.senderJid);
  const personaContext = buildPersonaContext(ctx.senderJid, ctx.senderName, text, isOwnerCtx);
  const tone = detectTone(text);
  const toneContext = tone !== "neutral" ? `\n[User tone: ${tone}] Match their energy naturally.` : "";

  // Semantic long-term memory: pull relevant memories + learned profile
  const { autoExtractMemory, learnCommunicationStyle } = require("../utils/semanticMemory");
  // Media memory (images/voice ARIA has seen) — pulled into context for awareness.
  let mediaContext = "";
  try {
    const { recallMedia } = require("../tools/mediaMemory");
    const mediaMem = recallMedia(ctx.senderJid, text, 3);
    if (mediaMem.length) {
      mediaContext = "\n\n[Media I've seen/heard that's relevant:] " + mediaMem.map((m) => `(${m.kind}) ${m.summary}`).join(" | ");
    }
  } catch (_) {}
  const personalizationContext = "\n\n[Personalization] Learn their name if they give it, match their communication style naturally, and remember important things they share.\n";
  let revenueContextText = "";
  try { revenueContextText = require("../core/productBridge").formatRevenueContext(ctx.revenueContext); } catch (_) {}
  let capabilityContext = "";
  try {
    const { isCapabilityQuestion, formatCapabilityContext } = require("../tools/capabilityProfile");
    if (isCapabilityQuestion(text)) capabilityContext = formatCapabilityContext();
  } catch (_) {}

  const response = await getAIResponse(text, ctx.senderName, memory, null, quotedText, {
    userContext: profileCtx.context + ownerContext + moodContext + personaContext + toneContext + mediaContext + personalizationContext + researchContext + selfModelContext + revenueContextText + dialogueAwareness + capabilityContext,
    preferences: profileCtx.profile.preferences,
    facts: profileCtx.profile.facts,
  });

  if (response) {
    try {
      require("../core/productBridge").recordProductActivity({
        product: "whatsapp",
        action: "ai.responded",
        context: ctx.platformContext,
        actorId: ctx.platformActor?.id,
        aggregateType: "conversation",
        aggregateId: ctx.chatId,
        metadata: { intent: intent || "conversation", providerResponse: true },
        usage: { category: "ai", metric: "messages", units: 1, metadata: { intent: intent || "conversation" } },
        idempotencyKey: msg.key?.id ? `whatsapp-ai:${msg.key.id}` : null,
      });
    } catch (_) {}
    // Remember callable facts (running jokes, likes) for future callbacks
    if (tone === "up" && text.length > 20) rememberCallable(ctx.senderJid, ctx.senderName + " said: \"" + text.slice(0, 60) + "\"");
        bleedMood(ctx.senderJid, moodData.mood);
    try { require("../tools/ariaLifeFeatures").recordMoodSnapshot(ctx.senderJid, moodData.mood, tone); } catch (_) {}
    // Auto-extract important memories + learn communication style (personalization)
    try {
      autoExtractMemory(ctx.senderJid, ctx.senderName, text);
      learnCommunicationStyle(ctx.senderJid, ctx.senderName, text);
      extractFromMessage(ctx.senderJid, ctx.senderName, text);
    } catch (_) {}

    // Immediate single-message send. When ARIA is naturally summoned or names
    // herself, carry a real WhatsApp mention payload without visible @ text.
    const selfMentions = ctx.isGroup && shouldSelfMention(text, response) ? getBotMentionJids(sock) : [];
    await humanizeAndSend(sock, msg, response, ctx.senderJid, ctx.senderName, isOwnerCtx, { mentions: selfMentions });
    try {
      require("./eventLog").trackConversationEvent(ctx.chatId, "outbound", "ARIA replied", {
        senderJid: ctx.senderJid,
        providerResponse: true,
        intent: intent || "conversation",
        selfMention: selfMentions.length > 0,
      });
    } catch (_) {}
    saveMemory(ctx.chatId, text, response);
    trackInteraction(ctx.senderJid, text);
    if (process.env.DEBUG_REPLIES === "true") {
      log("AI REPLY:", response);
    }
  }
}

// ── Initialize ───────────────────────────────────────────────
registerBuiltinCommands();

// ── Command collision detector ──────────────────────────────
// The router dispatches first-match-wins over the registration array, so a
// duplicate trigger (same name or alias registered twice) silently lets the
// earlier command steal the later one. Surface every collision at startup so
// commands aren't silently shadowed (e.g. !build = academy project, not the
// app builder; !agent = project, not the agent runner).
function detectCommandCollisions() {
  const seen = new Map(); // trigger -> { command, kind }
  const warnings = [];
  for (const cmd of commands) {
    const register = (trigger, kind) => {
      if (seen.has(trigger)) {
        warnings.push(`collision: "${trigger}" -> ${seen.get(trigger).command} (${seen.get(trigger).kind}) vs ${cmd.name} (${kind})`);
      } else {
        seen.set(trigger, { command: cmd.name, kind });
      }
    };
    register(cmd.name, "name");
    for (const a of cmd.aliases || []) register(a, "alias");
  }
  if (warnings.length) {
    const { warn } = require("./logger");
    warn(`[router] ${warnings.length} command collision(s):\n  ` + warnings.join("\n  "));
  }
  return warnings;
}

detectCommandCollisions();

// ── Plugin marketplace command handlers ──────────────────────
async function handlePluginsList(sock, msg, args, context) {
  const { reply } = require("./baileysHelpers");
  const { listInstalled } = require("../tools/pluginMarket");
  const list = listInstalled();
  if (!list.length) return reply(sock, msg, "No plugins installed.");
  const lines = list.map((p) => `• *${p.id}* — ${p.enabled ? "enabled" : "disabled"}${p.info?.version ? ` (v${p.info.version})` : ""}`);
  return reply(sock, msg, `*Installed plugins:*\n${lines.join("\n")}`);
}

async function handlePluginInstall(sock, msg, args, context) {
  const { reply } = require("./baileysHelpers");
  const name = String(args || "").trim();
  if (!name) return reply(sock, msg, "Usage: !install <plugin-name>");
  const { installPlugin } = require("../tools/pluginMarket");
  const r = await installPlugin(name);
  return reply(sock, msg, r.success ? `✅ Installed *${name}*. Restart to load it.` : `❌ ${r.error}`);
}

async function handlePluginUpdate(sock, msg, args, context) {
  const { reply } = require("./baileysHelpers");
  const name = String(args || "").trim();
  if (!name) return reply(sock, msg, "Usage: !update <plugin-name>");
  const { updatePlugin } = require("../tools/pluginMarket");
  const r = await updatePlugin(name);
  return reply(sock, msg, r.success ? `✅ Updated *${name}*. Restart to load it.` : `❌ ${r.error}`);
}

async function handlePluginEnable(sock, msg, args, context) {
  const { reply } = require("./baileysHelpers");
  const name = String(args || "").trim();
  if (!name) return reply(sock, msg, "Usage: !enable <plugin-name>");
  const { setPluginState } = require("../tools/pluginMarket");
  setPluginState(name, true);
  return reply(sock, msg, `✅ Enabled *${name}*.`);
}

async function handlePluginDisable(sock, msg, args, context) {
  const { reply } = require("./baileysHelpers");
  const name = String(args || "").trim();
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
  resolveNaturalAction,
  naturalArgs,
  detectCommandCollisions,
  _test: { resolveBusinessModePhrase, handleNsfw, formatBuildResult, formatProjectStatus, formatProjectList, formatProjectMutation, handlePrivateGithubCredential, cleanDeliveryRequest },
};
