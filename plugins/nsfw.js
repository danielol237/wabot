// NSFW Plugin — anime NSFW images with chat toggle
// waifu.pics died (domain expired, 2026), so this now resolves images from a
// small pool of still-alive free APIs. No single free API covers every category
// anymore, so each command tries its best available source(s) in order:
//   nekos.life  -> waifu, neko          (verified working)
//   purrbot.site-> neko, blowjob, ...   (needs a browser User-Agent)
// Categories with no live source return an honest "unavailable" message.

const axios = require("axios");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const NSFW_TYPES = ["waifu", "neko", "trap", "blowjob", "ass", "hentai", "milf", "oral", "paizuri", "ero", "yuri", "cum", "feet", "spank", "smallboobs"];

// In-memory NSFW toggle per chat
const nsfwToggles = new Map(); // chatId -> boolean

function isNSFWEnabled(chatId) {
  return nsfwToggles.get(chatId) === true;
}

// ── Multi-source image resolver ────────────────────────────────
// Try each source for a category in order; return the first image URL that
// resolves, else null. Each source maps category -> its own URL path.
const SOURCES = [
  // nekos.life: simple JSON { url } — works for waifu + neko.
  {
    supports: (cat) => ["waifu", "neko"].includes(cat),
    async url(cat) {
      const r = await axios.get(`https://nekos.life/api/v2/img/${cat}`, { timeout: 10000 });
      return r.data?.url || null;
    },
  },
  // purrbot.site: JSON { link } — needs a browser UA; spotty category coverage.
  {
    supports: () => true,
    async url(cat) {
      const r = await axios.get(`https://purrbot.site/api/img/nsfw/${cat}/gif`, {
        timeout: 10000,
        headers: { "User-Agent": UA },
      });
      if (r.status !== 200) return null;
      return r.data?.link || null;
    },
  },
];

async function fetchNSFWImage(category) {
  for (const src of SOURCES) {
    if (!src.supports(category)) continue;
    try {
      const url = await src.url(category);
      if (url) return { url, source: "api" };
    } catch (_) { /* try next source */ }
  }
  return null;
}

// Build one command handler per category (avoids 15 copy-pasted handlers).
function makeNSFWCommand(category) {
  return async (sock, msg, args, ctx) => {
    if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off. Ask an admin to enable with *!nsfw on*");
    try {
      const img = await fetchNSFWImage(category);
      if (!img?.url) return ctx.reply(`❌ *!${category}*: no live image source right now.`);
      await sock.sendMessage(msg.key.remoteJid, { image: { url: img.url }, caption: `🔞 ${category[0].toUpperCase()}${category.slice(1)}` });
    } catch {
      ctx.reply("Couldn't fetch image.");
    }
  };
}

module.exports = {
  name: "nsfw",
  commands: {
    // !nsfw on/off — toggle NSFW for this chat
    nsfw: async (sock, msg, args, ctx) => {
      const chatId = msg.key.remoteJid;
      const sub = args[0]?.toLowerCase();

      if (sub === "on") {
        nsfwToggles.set(chatId, true);
        return ctx.reply("🔞 NSFW mode: *ON*\n\nAvailable: waifu, neko, hentai, blowjob, ass, milf, oral, paizuri, ero, yuri, trap, cum, feet, spank, smallboobs");
      }
      if (sub === "off") {
        nsfwToggles.set(chatId, false);
        return ctx.reply("🔞 NSFW mode: *OFF*");
      }

      const status = isNSFWEnabled(chatId) ? "ON" : "OFF";
      return ctx.reply(`🔞 NSFW is currently *${status}*\nUse *!nsfw on* or *!nsfw off*`);
    },

    // Every NSFW category command, generated from the list.
    ...Object.fromEntries(NSFW_TYPES.map((c) => [c, makeNSFWCommand(c)])),
  },
};
