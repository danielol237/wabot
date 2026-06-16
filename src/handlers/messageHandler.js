const { MessageMedia } = require("whatsapp-web.js");
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
const { getMemory, saveMemory } = require("../utils/memory");
const { react, reply } = require("../utils/helpers");

// ─── Bot identity ───────────────────────────────────────────────
const BOT_NAME = (process.env.BOT_NAME || "aria").toLowerCase();
const PREFIX = process.env.BOT_PREFIX || "!";

const NAME_TRIGGERS = [
  BOT_NAME,
  BOT_NAME + ",",
  BOT_NAME + "!",
  "hey " + BOT_NAME,
  "ok " + BOT_NAME,
  "yo " + BOT_NAME,
];

const INTENTS = {
  image:    ["generate", "create an image", "make an image", "draw", "imagine", "paint", "design an image", "give me an image", "show me a picture"],
  search:   ["search for", "look up", "google", "search the web", "find info on"],
  download: ["download", "dl this", "get this video", "save this"],
  scrape:   ["read this link", "open this link", "check this site", "visit", "browse", "summarize this link", "what's on this site"],
  remind:   ["remind me", "set a reminder", "alert me", "notify me in"],
  clear:    ["clear memory", "reset chat", "forget everything", "start over"],
  help:     ["help", "show commands", "what can you do", "menu"],
  file:     ["send me the file", "give me the file", "send as file", "send it as a file", "download this code", "save this as"],
};

// ─── Main handler ───────────────────────────────────────────────
async function handleMessage(client, msg) {
  if (msg.from === "status@broadcast") return;
  if (msg.fromMe) return;

  const body = msg.body?.trim() || "";
  const lower = body.toLowerCase();
  const contact = await msg.getContact();
  const senderName = contact.pushname || contact.number || "User";
  const chatId = msg.from;
  const isGroup = chatId.endsWith("@g.us");

  console.log(`[${senderName}${isGroup ? " (grp)" : ""}] ${body.slice(0, 80)}`);

  let activeBody = body;

  // ── Group: only respond if called by name or prefix ──
  if (isGroup) {
    const namedTrigger = NAME_TRIGGERS.find(t => lower.startsWith(t));
    const prefixTrigger = lower.startsWith(PREFIX);
    if (!namedTrigger && !prefixTrigger && !msg.hasMedia) return;
    if (namedTrigger) {
      activeBody = body.slice(namedTrigger.length).trim();
      if (!activeBody) return reply(msg, `Yeah? What do you need? 👀`);
    }
  } else {
    // DM: strip name if used
    const namedTrigger = NAME_TRIGGERS.find(t => lower.startsWith(t));
    if (namedTrigger) {
      activeBody = body.slice(namedTrigger.length).trim();
      if (!activeBody) return reply(msg, `Yeah? What do you need? 👀`);
    }
  }

  const activeLower = activeBody.toLowerCase();

  // ── FILE ANALYSIS (received file) ───────────────────────────
  if (msg.hasMedia) {
    const mediaData = await msg.downloadMedia();
    if (mediaData) {
      await react(msg, "📊");
      const question = activeBody || "Analyze this file and tell me everything about it.";
      const result = await analyzeFile(mediaData, question);
      return reply(msg, result);
    }
  }

  // ── PREFIX COMMANDS ─────────────────────────────────────────
  if (activeLower.startsWith(`${PREFIX}imagine`) || activeLower.startsWith(`${PREFIX}img`)) {
    return handleImageGen(client, msg, chatId, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower.startsWith(`${PREFIX}search`) || activeLower.startsWith(`${PREFIX}web`)) {
    return handleSearch(msg, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower.startsWith(`${PREFIX}dl`) || activeLower.startsWith(`${PREFIX}download`)) {
    return handleDownload(client, msg, chatId, activeBody.split(" ")[1]);
  }
  if (activeLower.startsWith(`${PREFIX}run`) || activeLower.startsWith(`${PREFIX}exec`)) {
    const parts = activeBody.split("\n");
    return handleCode(msg, parts.slice(1).join("\n"), parts[0].split(" ")[1] || "js");
  }
  if (activeLower.startsWith(`${PREFIX}scrape`) || activeLower.startsWith(`${PREFIX}read`)) {
    return handleScrape(msg, activeBody.split(" ")[1]);
  }
  if (activeLower.startsWith(`${PREFIX}remind`)) {
    return handleRemind(client, msg, chatId, activeBody.split(" ").slice(1).join(" "));
  }
  if (activeLower === `${PREFIX}help` || activeLower === `${PREFIX}menu`) {
    return reply(msg, getHelpMenu());
  }
  if (activeLower === `${PREFIX}clear` || activeLower === `${PREFIX}reset`) {
    saveMemory(chatId, []);
    return reply(msg, "🧹 Memory cleared. Fresh start!");
  }

  // ── AUTO FILE LINK DETECTION ────────────────────────────────
  const fileLink = detectFileLink(activeBody);
  if (fileLink) {
    // Check if they want the bot to read/analyze the file link
    const wantsRead = INTENTS.scrape.some(k => activeLower.includes(k))
      || activeLower.replace(fileLink, "").trim().length < 15
      || activeLower.includes("read")
      || activeLower.includes("check")
      || activeLower.includes("fix")
      || activeLower.includes("review")
      || activeLower.includes("analyze")
      || activeLower.includes("what");

    if (wantsRead) {
      await react(msg, "📎");
      const linkResult = await readFromLink(fileLink);
      if (linkResult.success) {
        const question = activeBody.replace(fileLink, "").trim() || "Analyze this file and tell me what it does.";
        const aiPrompt = `The user shared a file: *${linkResult.filename}*\n\nFile content:\n\`\`\`${linkResult.ext}\n${linkResult.content}\n\`\`\`\n\nUser's request: "${question}"\n\nRespond helpfully. If they want a fix or edit, return the full corrected file in a code block.`;
        const history = getMemory(chatId);
        const response = await getAIResponse(aiPrompt, senderName, history);
        saveMemory(chatId, [...history, { role: "user", content: activeBody }, { role: "assistant", content: response }]);

        // Auto send as file if response has a big code block
        await handleResponseWithFile(client, msg, chatId, response, linkResult.filename);
        return;
      }
      // Fall through to scrape if link reading failed
      return handleScrape(msg, fileLink);
    }
  }

  // ── NATURAL LANGUAGE INTENTS ────────────────────────────────

  // Image
  if (INTENTS.image.some(k => activeLower.includes(k))) {
    const prompt = stripIntent(activeLower, activeBody, INTENTS.image);
    if (prompt.length > 3) return handleImageGen(client, msg, chatId, prompt);
  }

  // URL in message → auto scrape
  const urlMatch = activeBody.match(/https?:\/\/[^\s]+/);
  if (urlMatch && !fileLink) {
    const wantsScrape = INTENTS.scrape.some(k => activeLower.includes(k))
      || activeLower.replace(urlMatch[0], "").trim().length < 10;
    if (wantsScrape) return handleScrape(msg, urlMatch[0]);
  }

  // Search
  if (INTENTS.search.some(k => activeLower.includes(k))) {
    const query = stripIntent(activeLower, activeBody, INTENTS.search);
    if (query.length > 2) return handleSearch(msg, query);
  }

  // Reminder
  if (INTENTS.remind.some(k => activeLower.includes(k))) {
    return handleRemind(client, msg, chatId, activeBody);
  }

  // Help
  if (INTENTS.help.some(k => activeLower === k)) {
    return reply(msg, getHelpMenu());
  }

  // Clear
  if (INTENTS.clear.some(k => activeLower.includes(k))) {
    saveMemory(chatId, []);
    return reply(msg, "🧹 Memory cleared. Fresh start!");
  }

  // ── DEFAULT: AI CHAT ─────────────────────────────────────────
  if (activeBody.length > 0) {
    await react(msg, "🧠");
    const history = getMemory(chatId);
    const response = await getAIResponse(activeBody, senderName, history);
    saveMemory(chatId, [...history,
      { role: "user", content: activeBody },
      { role: "assistant", content: response },
    ]);

    // Smart: if response has a big code block, also send it as a file
    await handleResponseWithFile(client, msg, chatId, response);
  }
}

// ─── Smart response handler ─────────────────────────────────────
// Sends the text reply + auto-sends code as a file if it's substantial
async function handleResponseWithFile(client, msg, chatId, response, hintFilename = null) {
  await reply(msg, response);

  const codeBlock = extractCodeBlock(response);
  if (codeBlock && codeBlock.code.split("\n").length >= 10) {
    // Build a smart filename
    let filename = hintFilename
      ? hintFilename.replace(/\.[^.]+$/, `.${codeBlock.ext}`)
      : `code.${codeBlock.ext}`;

    await sendFile(client, chatId, filename, codeBlock.code, `📎 *${filename}* — tap to open`);
  }
}

// ─── Feature handlers ───────────────────────────────────────────
async function handleImageGen(client, msg, chatId, prompt) {
  if (!prompt || prompt.length < 2) return reply(msg, `Give me a prompt. Example: _${BOT_NAME} imagine a dark futuristic city_`);
  await react(msg, "🎨");
  const result = await generateImage(prompt);
  if (result.success) {
    const media = await MessageMedia.fromUrl(result.url, { unsafeMime: true });
    await client.sendMessage(chatId, media, { caption: `🎨 *${prompt}*` });
  } else {
    await reply(msg, `❌ Image gen failed: ${result.error}`);
  }
}

async function handleSearch(msg, query) {
  if (!query || query.length < 2) return reply(msg, `What should I search?`);
  await react(msg, "🔍");
  await reply(msg, await searchWeb(query));
}

async function handleDownload(client, msg, chatId, url) {
  if (!url) return reply(msg, `Give me a URL to download.`);
  await react(msg, "📥");
  const result = await downloadMedia(url, chatId, client);
  if (!result.success) await reply(msg, `❌ Download failed: ${result.error}`);
}

async function handleCode(msg, code, lang) {
  if (!code) return reply(msg, "Send code like:\n`!run js`\n`console.log('hello')`");
  await react(msg, "⚙️");
  const result = await runCode(code, lang);
  await reply(msg, `\`\`\`\n${result}\n\`\`\``);
}

async function handleScrape(msg, url) {
  if (!url) return reply(msg, `Give me a URL.`);
  await react(msg, "🕷️");
  await reply(msg, await scrapeUrl(url));
}

async function handleRemind(client, msg, chatId, text) {
  if (!text) return reply(msg, `Example: _remind me in 10m to call dad_`);
  await react(msg, "⏰");
  await reply(msg, await setReminder(client, chatId, text));
}

// ─── Helpers ────────────────────────────────────────────────────
function stripIntent(lower, original, keywords) {
  for (const k of keywords) {
    const idx = lower.indexOf(k);
    if (idx !== -1) return original.slice(idx + k.length).trim();
  }
  return original;
}

function getHelpMenu() {
  const n = BOT_NAME.charAt(0).toUpperCase() + BOT_NAME.slice(1);
  return `*🤖 ${n} — AI Assistant*

*Just talk to me naturally or use commands:*

🎨 _imagine [prompt]_ — Generate image
🔍 _search [query]_ — Search the web
📥 _download [url]_ — Download video/audio
🕷️ _read [url]_ — Read any website
⏰ _remind me in 10m [msg]_ — Set reminder
📎 _share a file link_ — I'll read & analyze it
📊 _send any file_ — I'll analyze it
💻 _ask me to write code_ — I'll send it as a file too

*Prefix commands:*
\`!run js\` / \`!run py\` — Run code
\`!clear\` — Reset memory

_In groups: call me by name first_
_In DMs: just talk to me_`;
}

module.exports = { handleMessage };
