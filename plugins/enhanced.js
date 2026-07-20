// ARIA Enhanced Commands Plugin
// TikTok, Music, YouTube, Polls, Schedule, Undo, History

const { createPoll, vote, formatPoll, formatPollShort, getActivePolls, findPollByShortId } = require("../src/tools/polls");
const { scheduleMessage, cancelSchedule, listSchedules, formatSchedules } = require("../src/tools/scheduler");
const { trackAction, popLastAction, getHistory } = require("../src/tools/commandHistory");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");

module.exports = {
  name: "enhanced",
  commands: {
    // !tiktok <url> — download TikTok
    tiktok: async (sock, msg, args, ctx) => {
      const url = args[0];
      if (url && url.includes("tiktok.com")) {
        await ctx.react("⬇️");
        await ctx.reply("Downloading TikTok...");
        const id = uuidv4();
        const out = path.join(__dirname, "../temp", id + ".%(ext)s");
        exec('yt-dlp -f "best[filesize<50M]/best" --max-filesize 50M -o "' + out + '" "' + url + '"', { timeout: 120000 }, async (err) => {
          try {
            const files = fs.readdirSync(path.join(__dirname, "../temp")).filter((f) => f.startsWith(id));
            if (files.length === 0) return ctx.reply("Download failed.");
            const fp = path.join(__dirname, "../temp", files[0]);
            const buf = fs.readFileSync(fp);
            await sock.sendMessage(msg.key.remoteJid, { video: buf, caption: "TikTok downloaded" });
            try { fs.unlinkSync(fp); } catch (_) {}
          } catch (e) { ctx.reply("Error: " + e.message); }
        });
      } else if (args[0] === "search" && args.slice(1).join(" ")) {
        await ctx.react("🔍");
        const { searchWeb } = require("../src/tools/webSearch");
        const r = await searchWeb("site:tiktok.com " + args.slice(1).join(" "));
        const m = r.match(/https?:\/\/(?:www\.)?tiktok\.com\/[^\s"']+/g) || [];
        const u = [...new Set(m)].slice(0, 5);
        if (u.length === 0) return ctx.reply("No TikTok videos found.");
        let t = "*TikTok Results*\n\n";
        u.forEach((x, i) => { t += (i + 1) + ". " + x + "\n"; });
        t += "\nSend *!tiktok <url>* to download.";
        ctx.reply(t);
      } else {
        ctx.reply("Usage:\n*!tiktok <url>* — Download\n*!tiktok search <q>* — Search");
      }
    },

    // !music <song> — search and download audio
    music: async (sock, msg, args, ctx) => {
      const q = args.join(" ");
      if (!q) return ctx.reply("Usage: *!music <song name>*");
      await ctx.react("🎵");
      await ctx.reply('Searching for "' + q + '"...');
      const id = uuidv4();
      const out = path.join(__dirname, "../temp", id + ".%(ext)s");
      exec('yt-dlp -f "bestaudio[filesize<20M]/bestaudio" --max-filesize 20M --extract-audio --audio-format mp3 -o "' + out + '" "ytsearch1:' + q + '"', { timeout: 120000 }, async (err) => {
        try {
          const files = fs.readdirSync(path.join(__dirname, "../temp")).filter((f) => f.startsWith(id));
          if (files.length === 0) return ctx.reply("Could not find or download that song.");
          const fp = path.join(__dirname, "../temp", files[0]);
          const buf = fs.readFileSync(fp);
          await sock.sendMessage(msg.key.remoteJid, { audio: buf, mimetype: "audio/mp4", fileName: files[0], caption: q });
          try { fs.unlinkSync(fp); } catch (_) {}
        } catch (e) { ctx.reply("Error: " + e.message); }
      });
    },
    song: "music", // alias

    // !yt <url> [format] — download from YouTube/Facebook/etc
    yt: async (sock, msg, args, ctx) => {
      const url = args[0];
      const fmt = (args[1] || "best").toLowerCase();
      if (!url) return ctx.reply("Usage: *!yt <url>* or *!yt <url> mp3*");
      await ctx.react("⬇️");
      await ctx.reply("Downloading...");
      let fs_ = "best[filesize<50M]/best";
      let ia = false;
      if (fmt === "mp3" || fmt === "audio") { fs_ = "bestaudio[filesize<50M]/bestaudio"; ia = true; }
      else if (fmt === "720") { fs_ = "best[height<=720][filesize<50M]/best[height<=720]"; }
      else if (fmt === "1080") { fs_ = "best[height<=1080][filesize<50M]/best[height<=1080]"; }
      const id = uuidv4();
      const out = path.join(__dirname, "../temp", id + ".%(ext)s");
      exec('yt-dlp -f "' + fs_ + '" --max-filesize 50M -o "' + out + '" "' + url + '"', { timeout: 120000 }, async (err) => {
        try {
          const files = fs.readdirSync(path.join(__dirname, "../temp")).filter((f) => f.startsWith(id));
          if (files.length === 0) return ctx.reply("Download failed.");
          const fp = path.join(__dirname, "../temp", files[0]);
          const buf = fs.readFileSync(fp);
          if (ia) {
            await sock.sendMessage(msg.key.remoteJid, { audio: buf, mimetype: "audio/mp4" });
          } else {
            await sock.sendMessage(msg.key.remoteJid, { video: buf, caption: "Downloaded" });
          }
          try { fs.unlinkSync(fp); } catch (_) {}
        } catch (e) { ctx.reply("Error: " + e.message); }
      });
    },
    youtube: "yt", // alias

    // !poll create "Q" "A" "B" ...
    poll: async (sock, msg, args, ctx) => {
      const sub = args[0]?.toLowerCase();
      if (sub === "create" || sub === "new") {
        const m = msg.message?.conversation?.match(/"([^"]+)"/g) || msg.message?.extendedTextMessage?.text?.match(/"([^"]+)"/g) || [];
        if (m.length < 3) return ctx.reply('Usage: *!poll create "Question" "A" "B"*');
        const q = m[0].replace(/"/g, "");
        const opts = m.slice(1).map((o) => o.replace(/"/g, ""));
        if (opts.length < 2) return ctx.reply("Need at least 2 options.");
        if (opts.length > 10) return ctx.reply("Max 10 options.");
        const pid = createPoll(q, opts, msg.key.participant || msg.key.remoteJid, msg.key.remoteJid);
        trackAction(msg.key.remoteJid, { type: "poll_create", pollId: pid, question: q });
        ctx.reply(formatPoll(pid));
      } else if (sub === "list" || !sub) {
        const ap = getActivePolls(msg.key.remoteJid);
        if (ap.length === 0) return ctx.reply("No active polls.");
        ctx.reply("*Active Polls*\n\n" + ap.map((p) => formatPollShort(p)).join("\n"));
      } else {
        ctx.reply('Usage: *!poll create "Q" "A" "B"* or *!polls*');
      }
    },

    // !vote <id> <num>
    vote: async (sock, msg, args, ctx) => {
      const sid = args[0];
      const num = parseInt(args[1]);
      if (!sid || isNaN(num)) return ctx.reply("Usage: *!vote <id> <num>*");
      const poll = findPollByShortId(sid);
      if (!poll) return ctx.reply("Poll not found.");
      const r = vote(poll.id, num - 1, msg.key.participant || msg.key.remoteJid);
      if (!r.success) return ctx.reply(r.error);
      ctx.reply("Voted! " + formatPollShort(poll));
    },

    // !schedule "message" at <time>
    schedule: async (sock, msg, args, ctx) => {
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
      const m = text.match(/!schedule\s+"([^"]+)"\s+at\s+(.+)/i);
      if (!m) return ctx.reply('Usage: *!schedule "Your message" at every day at 09:00*');
      const r = scheduleMessage(msg.key.remoteJid, m[1], m[2].trim(), msg.key.participant || msg.key.remoteJid);
      if (!r.success) return ctx.reply(r.error);
      trackAction(msg.key.remoteJid, { type: "schedule", id: r.id, message: m[1] });
      ctx.reply('Scheduled: "' + m[1] + '" at ' + m[2].trim() + ' (ID: ' + r.id + ')');
    },

    // !schedules — list scheduled messages
    schedules: async (sock, msg, args, ctx) => {
      const list = listSchedules(msg.key.remoteJid);
      if (list.length === 0) return ctx.reply("No scheduled messages.");
      ctx.reply("*Scheduled Messages*\n\n" + formatSchedules(list));
    },

    // !cancel <id>
    cancel: async (sock, msg, args, ctx) => {
      if (!args[0]) return ctx.reply("Usage: *!cancel <id>*");
      const r = cancelSchedule(args[0], msg.key.participant || msg.key.remoteJid);
      if (!r.success) return ctx.reply(r.error);
      trackAction(msg.key.remoteJid, { type: "cancel_schedule", id: args[0] });
      ctx.reply("Cancelled " + args[0]);
    },

    // !undo
    undo: async (sock, msg, args, ctx) => {
      const la = popLastAction(msg.key.remoteJid);
      if (!la) return ctx.reply("Nothing to undo.");
      ctx.reply("Undid: " + la.type + (la.question ? " (" + la.question + ")" : "") + (la.id ? " (" + la.id + ")" : ""));
    },

    // !history
    history: async (sock, msg, args, ctx) => {
      const rh = getHistory(msg.key.remoteJid, 10);
      if (rh.length === 0) return ctx.reply("No recent actions.");
      const ht = rh.map((a, i) => (i + 1) + ". " + a.type + (a.question ? ": " + a.question : "") + (a.id ? " (" + a.id + ")" : "")).join("\n");
      ctx.reply("*Recent Actions*\n\n" + ht);
    },

    // ── INTERACTION COMMANDS ───────────────────────────────────
    // Each sends an anime GIF via waifu.pics API
    hug: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/hug");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*hugs " + (args.join(" ") || "you") + "* 🤗" });
      } catch (_) { ctx.reply("*hugs you* 🤗"); }
    },
    kiss: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/kiss");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*kisses " + (args.join(" ") || "you") + "* 💋" });
      } catch (_) { ctx.reply("*kisses you* 💋"); }
    },
    slap: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/slap");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*slaps " + (args.join(" ") || "you") + "* 👋" });
      } catch (_) { ctx.reply("*slaps " + (args.join(" ") || "you") + "* 👋"); }
    },
    pat: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/pat");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*pats " + (args.join(" ") || "you") + "* 🫳" });
      } catch (_) { ctx.reply("*pats " + (args.join(" ") || "you") + "* 🫳"); }
    },
    wave: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/wave");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*waves at " + (args.join(" ") || "you") + "* 👋" });
      } catch (_) { ctx.reply("*waves* 👋"); }
    },
    cuddle: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/cuddle");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*cuddles " + (args.join(" ") || "you") + "* 🥰" });
      } catch (_) { ctx.reply("*cuddles you* 🥰"); }
    },
    bite: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/bite");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*bites " + (args.join(" ") || "you") + "* 😈" });
      } catch (_) { ctx.reply("*bites you* 😈"); }
    },
    poke: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/poke");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*pokes " + (args.join(" ") || "you") + "* 👉" });
      } catch (_) { ctx.reply("*pokes you* 👉"); }
    },
    blush: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/blush");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*blushes* 😊" });
      } catch (_) { ctx.reply("*blushes* 😊"); }
    },
    dance: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/dance");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*dances* 💃" });
      } catch (_) { ctx.reply("*dances* 💃"); }
    },
    kill: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/kill");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*kills " + (args.join(" ") || "you") + "* 💀" });
      } catch (_) { ctx.reply("*kills " + (args.join(" ") || "you") + "* 💀"); }
    },
    cry: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/cry");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*cries* 😢" });
      } catch (_) { ctx.reply("*cries* 😢"); }
    },
    smile: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/smile");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*smiles* 🙂" });
      } catch (_) { ctx.reply("*smiles* 🙂"); }
    },
    bonk: async (sock, msg, args, ctx) => {
      try {
        const r = await require("axios").get("https://api.waifu.pics/sfw/bonk");
        await sock.sendMessage(msg.key.remoteJid, { image: { url: r.data.url }, caption: "*bonks " + (args.join(" ") || "you") + "* 🔨" });
      } catch (_) { ctx.reply("*bonks " + (args.join(" ") || "you") + "* 🔨"); }
    },

    // ── MANGA / MANHWA DOWNLOAD ──────────────────────────────────
    manga: async (sock, msg, args, ctx) => {
      const q = args.join(" ");
      if (!q) return ctx.reply("Search for what? Try *!manga naruto*");
      await ctx.react("🔍");
      try {
        const { data } = await require("axios").get("https://api.jikan.moe/v4/manga?q=" + encodeURIComponent(q) + "&limit=5");
        const items = data.data || [];
        if (items.length === 0) return ctx.reply("No manga found.");
        let t = "*📚 Manga Results*\n\n";
        items.forEach((m, i) => {
          t += (i + 1) + ". *" + m.title + "*\n";
          t += "   📖 " + (m.chapters || "?") + " ch | ⭐ " + (m.score || "N/A") + "\n";
          t += "   " + (m.synopsis ? m.synopsis.slice(0, 100) + "..." : "") + "\n\n";
        });
        ctx.reply(t);
      } catch (e) { ctx.reply("Search failed: " + e.message); }
    },
    manhwa: "manga",
    novel: "manga",

    // ── REVERSE IMAGE SEARCH (SauceNAO - needs API key) ─────────
    // For now, uses Google Images as fallback
    sauce: async (sock, msg, args, ctx) => {
      // Check if replying to an image
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const imgMsg = quoted?.imageMessage;
      if (!imgMsg) return ctx.reply("Reply to an image with *!sauce* to find its source.");

      await ctx.react("🔍");
      // Download the image and try to find source
      try {
        const buffer = await sock.downloadMediaMessage(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ? { key: { remoteJid: msg.key.remoteJid, id: msg.message.extendedTextMessage.contextInfo.stanzaId, fromMe: false }, message: quoted } : msg);
        if (!buffer) return ctx.reply("Couldn't download the image.");

        // Try SauceNAO with a free/demo key
        // For now, return a note about the feature
        ctx.reply("🔍 *SauceNAO search* — I found the image data but SauceNAO needs an API key to match it. You can get one free at saucenao.com and add SAUCENAO_API_KEY to your .env");
      } catch (e) {
        ctx.reply("Couldn't process that image. Make sure it's a valid image.");
      }
    },

    // ── ECONOMY ADDITIONS ────────────────────────────────────────
    lottery: async (sock, msg, args, ctx) => {
      try {
        const { getBalance } = require("../src/tools/cardEconomy");
        const bal = getBalance(senderJid) || 0;
        const entryCost = 100;
        if (bal < entryCost) return ctx.reply("You need " + entryCost + " stardust to enter the lottery. You have " + bal);

        // Simple random lottery
        const win = Math.random() < 0.1; // 10% win chance
        if (win) {
          const prize = Math.floor(Math.random() * 1000) + 500;
          ctx.reply("🎉 *LOTTERY WINNER!* You won " + prize + " stardust! 🎉");
        } else {
          ctx.reply("🍀 No luck this time. Better luck next draw!");
        }
      } catch (e) { ctx.reply("Lottery error: " + e.message); }
    },

    rob: async (sock, msg, args, ctx) => {
      ctx.reply("🦹 *Robbery* — Coming soon! (Need to set up the economy system properly first)");
    },

    // ── STICKER PACK ─────────────────────────────────────────────
    // Aliases for the existing sticker command
    s: async (sock, msg, args, ctx) => {
      // Check if replying to an image/video
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quoted?.imageMessage || quoted?.videoMessage) {
        try {
          const { createSticker } = require("../src/tools/sticker");
          const mediaData = await sock.downloadMediaMessage(
            { key: { remoteJid: msg.key.remoteJid, id: msg.message.extendedTextMessage.contextInfo.stanzaId, fromMe: false },
              message: quoted }
          );
          const sticker = await createSticker(mediaData, quoted?.videoMessage ? "video" : "image");
          await sock.sendMessage(msg.key.remoteJid, { sticker: sticker });
        } catch (e) { ctx.reply("Failed to create sticker: " + e.message); }
      } else {
        ctx.reply("Reply to an image/video with *!s* to make a sticker");
      }
    },
    sticker: "s",


    // ── VPN CONFIG GENERATOR ─────────────────────────────────
    vpn: async (sock, msg, args, ctx) => {
      const carrier = (args[0] || "").toLowerCase();
      const method = (args[1] || "openvpn").toLowerCase();

      if (!carrier || !["mtn", "orange"].includes(carrier)) {
        return ctx.reply("Usage: *!vpn <mtn|orange> [method]*\nMethods: openvpn (default), shadowsocks, proxy\n\nARIA searches for current zero-rating exploits and generates a config.");
      }

      await ctx.react("🔍");
      await ctx.reply("Searching for " + carrier.toUpperCase() + " exploits and generating config...");

      const { generateVPNConfig } = require("../src/tools/vpnConfig");
      const result = await generateVPNConfig(carrier, method);

      if (result.error) return ctx.reply("Error: " + result.error);

      let vpnMsg = "*" + result.carrier + " VPN Config*\n";
      vpnMsg += "Host: " + result.host + ":" + result.port + "\n";
      vpnMsg += "Method: " + method + "\n";
      vpnMsg += "Status: " + (result.connectivity.reachable ? "Host reachable ✅" : "Host unreachable ⚠️") + "\n\n";
      vpnMsg += result.warning;

      await sock.sendMessage(msg.key.remoteJid, { text: vpnMsg });

      // Send the config file
      const fs = require("fs");
      const buffer = fs.readFileSync(result.filePath);
      try {
        await sock.sendMessage(msg.key.remoteJid, { document: buffer, fileName: result.filename, mimetype: "text/plain", caption: "ARIA VPN Config for " + result.carrier });
      } catch (e) {
        // Fallback: send as text
        ctx.reply("Config (save as " + result.filename + "):\n\n" + result.config.slice(0, 3000));
      }

      // Cleanup
      try { fs.unlinkSync(result.filePath); } catch (_) {}
    },

  },
};
