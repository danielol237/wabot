// NSFW Plugin — anime NSFW images with chat toggle
// Uses waifu.pics NSFW API (free, no key)

const axios = require("axios");

// Types that waifu.pics supports
const NSFW_TYPES = ["waifu", "neko", "trap", "blowjob", "ass", "hentai", "milf", "oral", "paizuri", "ero", "yuri", "cum", "feet", "spank", "smallboobs"];
const SFW_TYPES = ["waifu", "neko", "shinobu", "megumin", "bully", "cuddle", "cry", "hug", "kiss", "lick", "pat", "smug", "bonk", "yeet", "blush", "smile", "wave", "highfive", "handhold", "nom", "bite", "glomp", "slap", "kill", "kick", "happy", "wink", "poke", "dance", "cringe"];

// In-memory NSFW toggle per chat
const nsfwToggles = new Map(); // chatId -> boolean

function isNSFWEnabled(chatId) {
  return nsfwToggles.get(chatId) === true;
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

    // Dynamic NSFW command handler — matches any NSFW type as a command
    waifu: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off. Ask an admin to enable with *!nsfw on*");
      try {
        const res = await axios.get("https://api.waifu.pics/nsfw/waifu", { timeout: 10000 });
        await sock.sendMessage(msg.key.remoteJid, { image: { url: res.data.url }, caption: "🔞 Waifu" });
      } catch { ctx.reply("Couldn't fetch image."); }
    },
    neko: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try {
        const res = await axios.get("https://api.waifu.pics/nsfw/neko", { timeout: 10000 });
        await sock.sendMessage(msg.key.remoteJid, { image: { url: res.data.url }, caption: "🔞 Neko" });
      } catch { ctx.reply("Couldn't fetch image."); }
    },
    hentai: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try {
        const res = await axios.get("https://api.waifu.pics/nsfw/hentai", { timeout: 10000 });
        await sock.sendMessage(msg.key.remoteJid, { image: { url: res.data.url }, caption: "🔞 Hentai" });
      } catch { ctx.reply("Couldn't fetch image."); }
    },
    blowjob: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/blowjob", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 Blowjob" }); } catch { ctx.reply("Error."); }
    },
    ass: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/ass", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 Ass" }); } catch { ctx.reply("Error."); }
    },
    milf: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/milf", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 MILF" }); } catch { ctx.reply("Error."); }
    },
    oral: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/oral", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 Oral" }); } catch { ctx.reply("Error."); }
    },
    paizuri: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/paizuri", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 Paizuri" }); } catch { ctx.reply("Error."); }
    },
    ero: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/ero", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 Ero" }); } catch { ctx.reply("Error."); }
    },
    yuri: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/yuri", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 Yuri" }); } catch { ctx.reply("Error."); }
    },
    trap: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/trap", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 Trap" }); } catch { ctx.reply("Error."); }
    },
    feet: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/feet", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 Feet" }); } catch { ctx.reply("Error."); }
    },
    cum: async (sock, msg, args, ctx) => {
      if (!isNSFWEnabled(msg.key.remoteJid)) return ctx.reply("🔞 NSFW is off.");
      try { const r = await axios.get("https://api.waifu.pics/nsfw/cum", { timeout: 10000 }); await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "🔞 Cum" }); } catch { ctx.reply("Error."); }
    },
  },
};
