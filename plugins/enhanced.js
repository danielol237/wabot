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

      const { generateVPNConfig, activeTest } = require("../src/tools/vpnConfig");
      const result = await generateVPNConfig(carrier, method);

      if (result.error) return ctx.reply("Error: " + result.error);

      let vpnMsg = "*" + result.carrier + " VPN Config*\n";
      vpnMsg += "Host: " + result.host + ":" + result.port + "\n";
      vpnMsg += "Method: " + method + "\n";
      vpnMsg += "Status: " + (result.connectivity.reachable ? "Host reachable ✅" : "Host unreachable ⚠️") + "\n\n";

      // Active test
      await ctx.reply("Testing proxy connectivity...");
      const testResult = await activeTest(result.host, result.port);
      vpnMsg += "Proxy test: " + (testResult.working ? "Working ✅ (HTTP " + testResult.httpCode + ")" : "Failed ❌") + "\n";
      if (testResult.note) vpnMsg += testResult.note + "\n";
      vpnMsg += "\n" + result.warning;

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


    // ── EVOLVE — self-improvement ──────────────────────────
    evolve: async (sock, msg, args, ctx) => {
      await ctx.react("🧬");
      await ctx.reply("🔍 Scanning my own code for improvements...");

      const { evolve, getEvolutionStats } = require("../src/tools/selfImprove");
      
      const result = await evolve();
      let text = "*🧬 ARIA Evolution Scan*\n\n";
      text += "Stage: " + result.stats.totalFiles + " files, " + result.stats.totalLines + " lines of code\n\n";
      
      if (result.improvements.length > 0) {
        text += "*Suggested improvements:*\n";
        result.improvements.forEach(item => text += "• " + item + "\n");
      } else {
        text += "No improvements found. I'm running optimally.\n";
      }
      
      const stats = getEvolutionStats();
      text += "\n*Evolution Stats:*\n";
      text += "Stage: " + stats.stage + " | Improvements made: " + stats.improvements.length + "\n";
      text += "Last check: " + stats.lastCheck;
      
      ctx.reply(text);
    },


    // ── WEB BROWSING ────────────────────────────────────────
    browse: async (sock, msg, args, ctx) => {
      const url = args[0];
      if (!url) return ctx.reply("Usage: *!browse <url>* or *!browse search <query>*");

      if (args[0] === "search" && args.slice(1).join(" ")) {
        await ctx.react("🔍");
        await ctx.reply("Searching the web...");
        const { searchAndBrowse } = require("../src/tools/webBrowser");
        const result = await searchAndBrowse(args.slice(1).join(" "));
        if (!result.success) return ctx.reply("Search failed: " + result.error);
        // If it's very long, send as file
        if (result.text.length > 4000) {
          const fs = require("fs");
          const fp = "/tmp/aria_search.txt";
          fs.writeFileSync(fp, result.text);
          const buf = fs.readFileSync(fp);
          await sock.sendMessage(msg.key.remoteJid, { document: buf, fileName: "search_result.txt", mimetype: "text/plain", caption: "Search results" });
          try { fs.unlinkSync(fp); } catch (_) {}
        } else {
          ctx.reply(result.text);
        }
        return;
      }

      await ctx.react("🌐");
      await ctx.reply("Loading " + url + "...");
      const { browse } = require("../src/tools/webBrowser");
      const result = await browse(url);
      if (!result.success) return ctx.reply("Failed: " + result.error);

      let text = "*📄 " + result.title + "*\n\n";
      if (result.description) text += result.description + "\n\n";
      text += result.content.slice(0, 3000);

      if (result.links.length > 0) {
        text += "\n\n*Links:*\n";
        result.links.slice(0, 5).forEach(l => text += "• " + l.text + "\n  " + l.url + "\n");
      }

      if (text.length > 4000) {
        const fs = require("fs");
        const fp = "/tmp/aria_browse.txt";
        fs.writeFileSync(fp, text);
        const buf = fs.readFileSync(fp);
        await sock.sendMessage(msg.key.remoteJid, { document: buf, fileName: result.title.slice(0, 30) + ".txt", mimetype: "text/plain", caption: "Browsed: " + result.title });
        try { fs.unlinkSync(fp); } catch (_) {}
      } else {
        ctx.reply(text);
      }
    },


    // ── PLUGIN MARKETPLACE ──────────────────────────────────
    plugins: async (sock, msg, args, ctx) => {
      const sub = args[0]?.toLowerCase();
      const { fetchManifest, installPlugin, setPluginState, isPluginEnabled, listInstalled } = require("../src/tools/pluginMarket");

      if (sub === "install" || sub === "add") {
        const id = args[1]?.toLowerCase();
        if (!id) return ctx.reply("Usage: *!plugins install <name>*");
        await ctx.react("📦");
        await ctx.reply("Downloading " + id + " plugin...");
        const r = await installPlugin(id);
        if (!r.success) return ctx.reply("❌ " + r.error);
        return ctx.reply("✅ Plugin *" + id + "* installed! Restart ARIA to load it.");
      }

      if (sub === "disable" || sub === "off") {
        const id = args[1]?.toLowerCase();
        if (!id) return ctx.reply("Usage: *!plugins disable <name>*");
        const r = setPluginState(id, false);
        return ctx.reply("⛔ Plugin *" + id + "* disabled. It won't load on next restart.");
      }

      if (sub === "enable" || sub === "on") {
        const id = args[1]?.toLowerCase();
        if (!id) return ctx.reply("Usage: *!plugins enable <name>*");
        const r = setPluginState(id, true);
        return ctx.reply("✅ Plugin *" + id + "* enabled.");
      }

      // Default: show marketplace
      await ctx.react("📦");
      const [available, installed] = await Promise.all([
        fetchManifest(),
        Promise.resolve(listInstalled()),
      ]);

      let text = "*📦 Plugin Marketplace*\n\n";
      text += "*Available:*\n";
      available.slice(0, 10).forEach(p => {
        const installed_ = installed.find(i => i.id === p.id);
        const status = installed_ ? (installed_.enabled ? "✅" : "⛔") : "⬇️";
        text += status + " *" + p.name + "* — " + p.desc + "\n";
      });
      text += "\n*Installed locally:* " + installed.filter(i => i.locally).length + " plugins\n";
      text += "\nUse *!plugins install <name>* to install\nUse *!plugins disable <name>* to disable";
      ctx.reply(text);
    },


    // ── AI AGENT (multi-step) ───────────────────────────────
    agent: async (sock, msg, args, ctx) => {
      const task = args.join(" ");
      if (!task) return ctx.reply("Usage: *!agent <task>*\nExample: *!agent research the best phone under 500$*");

      await ctx.react("🧠");
      const { runAgent } = require("../src/tools/advancedAgent");
      
      let progressMsgs = [];
      const onProgress = async (step) => {
        progressMsgs.push(step);
        if (progressMsgs.length <= 3) await ctx.reply(step);
      };

      const result = await runAgent(task, getSenderName(msg), onProgress);

      if (result.length > 4000) {
        const fs = require("fs");
        const fp = "/tmp/aria_agent_result.txt";
        fs.writeFileSync(fp, result);
        const buf = fs.readFileSync(fp);
        await sock.sendMessage(msg.key.remoteJid, { document: buf, fileName: "agent_result.txt", mimetype: "text/plain", caption: "Agent result" });
        try { fs.unlinkSync(fp); } catch (_) {}
      } else {
        ctx.reply(result);
      }
    },

    // ── MONITOR (background alerts) ─────────────────────────
    monitor: async (sock, msg, args, ctx) => {
      const sub = args[0]?.toLowerCase();
      const { startMonitor, stopMonitor, listMonitors, formatMonitors } = require("../src/tools/backgroundMonitor");

      if (sub === "crypto" && args[1]) {
        const coin = args[1].toLowerCase();
        const id = "crypto_" + coin + "_" + Date.now();
        startMonitor(id, "crypto", coin, "cross_up", msg.key.remoteJid);
        return ctx.reply("📊 Monitoring *" + coin + "* price. I'll alert you when it changes.");
      }

      if (sub === "stop" && args[1]) {
        const r = stopMonitor(args[1]);
        return ctx.reply(r ? "⛔ Monitor stopped." : "Monitor not found.");
      }

      if (sub === "list" || !sub) {
        const list = listMonitors(msg.key.remoteJid);
        return ctx.reply("*📊 Active Monitors*\n\n" + formatMonitors(list));
      }

      return ctx.reply("Usage:\n*!monitor crypto bitcoin* — watch BTC price\n*!monitor list* — list active\n*!monitor stop <id>* — stop");
    },


    // ── GITHUB INTEGRATION ──────────────────────────────────
    github: async (sock, msg, args, ctx) => {
      const sub = args[0]?.toLowerCase();
      const { repoInfo, listPRs, listCommits, runGit } = require("../src/tools/gitIntegration");

      if (sub === "repo" && args[1]) {
        const parts = args[1].split("/");
        const owner = parts[0], repo = parts[1] || "wabot";
        const info = await repoInfo(owner, repo);
        if (info.error) return ctx.reply("Error: " + info.error);
        return ctx.reply(`📦 *${info.name}*\n${info.desc}\n⭐ ${info.stars} | 🍴 ${info.forks} | 🐛 ${info.issues}\n🔗 ${info.url}`);
      }

      if (sub === "prs" && args[1]) {
        const parts = args[1].split("/");
        const prs = await listPRs(parts[0], parts[1] || "wabot");
        if (prs.length === 0) return ctx.reply("No open PRs.");
        let t = "*📋 Open PRs*\n\n";
        prs.forEach(pr => { t += `#${pr.number} ${pr.title} by @${pr.user}\n`; });
        return ctx.reply(t);
      }

      if (sub === "commits" && args[1]) {
        const parts = args[1].split("/");
        const commits = await listCommits(parts[0], parts[1] || "wabot");
        if (commits.length === 0) return ctx.reply("No commits.");
        let t = "*📝 Recent Commits*\n\n";
        commits.forEach(c => { t += `📄 ${c.message}\n   ${c.author} • ${c.date}\n`; });
        return ctx.reply(t);
      }

      if (sub === "commit") {
        if (!args.slice(1).join(" ")) return ctx.reply("Usage: *!github commit <message>*");
        const r = await runGit('add -A && git commit -m "' + args.slice(1).join(" ") + '"');
        if (r.error) return ctx.reply("❌ " + r.error);
        return ctx.reply("✅ " + r.output);
      }

      if (sub === "push") {
        const r = await runGit("push origin HEAD");
        if (r.error) return ctx.reply("❌ " + r.error);
        return ctx.reply("✅ " + r.output);
      }

      return ctx.reply("Usage:\n*!github repo <name>* — repo info\n*!github prs <name>* — open PRs\n*!github commits <name>* — recent commits\n*!github commit <msg>* — commit locally\n*!github push* — push to GitHub");
    },


    // ── EXPANDED ANIME ──────────────────────────────────────
    trending: async (sock, msg, args, ctx) => {
      const { getTrending } = require("../src/tools/animeExpanded");
      const list = await getTrending();
      if (list.length === 0) return ctx.reply("Couldn't fetch trending.");
      let t = "*🔥 Trending Anime*\n\n";
      list.slice(0, 8).forEach((a, i) => { t += `${i+1}. *${a.title}* ⭐${a.score}\n`; });
      ctx.reply(t);
    },
    airing: async (sock, msg, args, ctx) => {
      const { getAiring } = require("../src/tools/animeExpanded");
      const list = await getAiring();
      if (list.length === 0) return ctx.reply("Couldn't fetch airing.");
      let t = "*📺 Currently Airing*\n\n";
      list.slice(0, 8).forEach((a, i) => { t += `${i+1}. *${a.title}* ⭐${a.score} (${a.episodes} eps)\n`; });
      ctx.reply(t);
    },
    arandom: async (sock, msg, args, ctx) => {
      const { getRandom } = require("../src/tools/animeExpanded");
      const a = await getRandom();
      if (!a) return ctx.reply("Couldn't fetch.");
      ctx.reply(`🎲 *${a.title}*\n${a.synopsis}\n⭐ ${a.score} | ${a.type} | ${a.status}`);
    },
    character: async (sock, msg, args, ctx) => {
      const q = args.join(" ");
      if (!q) return ctx.reply("Usage: *!character <name>*");
      const { searchCharacter } = require("../src/tools/animeExpanded");
      const list = await searchCharacter(q);
      if (list.length === 0) return ctx.reply("No characters found.");
      let t = "*🎭 Characters*\n\n";
      list.slice(0, 5).forEach(c => {
        t += `*${c.name}*\n`;
        if (c.anime.length > 0) t += `Anime: ${c.anime.join(", ")}\n`;
        t += "\n";
      });
      ctx.reply(t);
    },
    schedule: async (sock, msg, args, ctx) => {
      const day = (args[0] || "").toLowerCase();
      const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
      if (!days.includes(day)) return ctx.reply("Usage: *!schedule monday* (monday-sunday)");
      const { getSchedule } = require("../src/tools/animeExpanded");
      const list = await getSchedule(day);
      if (list.length === 0) return ctx.reply("No anime scheduled for " + day);
      let t = `*📅 ${day.charAt(0).toUpperCase() + day.slice(1)} Schedule*\n\n`;
      list.slice(0, 10).forEach(a => { t += `• *${a.title}* — ${a.time} ⭐${a.score}\n`; });
      ctx.reply(t);
    },


    // ── MULTI-AGENT TEAM ───────────────────────────────────
    team: async (sock, msg, args, ctx) => {
      const task = args.join(" ");
      if (!task) return ctx.reply("Usage: *!team <project>*\nExample: *!team build a calculator app*");

      await ctx.react("👥");
      await ctx.reply("Assembling team: Planner -> Coder -> Reviewer -> Debugger -> Tester");

      const { runTeamProject } = require("../src/tools/multiAgent");
      
      let lastProgress = "";
      const onProgress = async (step) => {
        if (step !== lastProgress) {
          lastProgress = step;
          await ctx.reply(step);
        }
      };

      const results = await runTeamProject(task, getSenderName(msg), onProgress);

      // Send results
      let summary = "*👥 Multi-Agent Build Complete*\n\n";
      summary += "Files created: " + Object.keys(results).filter(k => k.startsWith("code_")).length + "\n";
      if (results.review?.length > 0) summary += "Issues found & fixed: " + results.review.length + "\n";
      summary += "\nSent as files below.";

      await sock.sendMessage(msg.key.remoteJid, { text: summary });

      // Send each file
      const fs = require("fs");
      for (const [key, val] of Object.entries(results)) {
        if (key.startsWith("code_") && val.content) {
          const filePath = "/tmp/aria_" + val.path.replace(/[^a-zA-Z0-9.]/g, "_");
          fs.writeFileSync(filePath, val.content);
          const buf = fs.readFileSync(filePath);
          try {
            await sock.sendMessage(msg.key.remoteJid, { document: buf, fileName: val.path, mimetype: "text/plain", caption: val.path });
          } catch (e) {}
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      }
    },


    // ── PERSONAL OS ─────────────────────────────────────────
    remember: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const text = args.join(" ");
      const separator = text.indexOf(" is ");
      if (separator === -1) return ctx.reply("Usage: *!remember <key> is <value>*\nExample: *!remember favorite color is blue*");
      const key = text.slice(0, separator).trim();
      const value = text.slice(separator + 4).trim();
      const { remember } = require("../src/tools/personalOS");
      remember(uid, key, value);
      ctx.reply("Got it! I'll remember that " + key + " is " + value + ".");
    },
    mood: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const m = args.join(" ");
      if (!m) return ctx.reply("How are you feeling? *!mood happy/sad/tired/etc*");
      const { trackMood, getPersonalizedGreeting } = require("../src/tools/personalOS");
      trackMood(uid, m);
      ctx.reply("Noted. You're feeling " + m + ". " + getPersonalizedGreeting(uid));
    },


    // ── CODE INTERPRETER ────────────────────────────────────
    run: async (sock, msg, args, ctx) => {
      const lang = args[0]?.toLowerCase();
      const code = args.slice(1).join(" ");

      if (!lang || !code) return ctx.reply("Usage: *!run <js|py|sh|html|plot> <code>*\nExample: *!run js console.log(\"hello\")*");

      await ctx.react("💻");
      await ctx.reply("Running " + lang + " code...");

      const { interpret } = require("../src/tools/codeInterpreter");
      const result = await interpret(lang, code);

      if (result.image) {
        // Send the plot image
        const fs = require("fs");
        const buf = fs.readFileSync(result.image);
        await sock.sendMessage(msg.key.remoteJid, { image: buf, caption: "Plot result" });
        try { fs.unlinkSync(result.image); } catch (_) {}
        return;
      }

      if (result.html) {
        // Save and send as file
        const fs = require("fs");
        const buf = fs.readFileSync(result.filePath);
        await sock.sendMessage(msg.key.remoteJid, { document: buf, fileName: "output.html", mimetype: "text/html", caption: "HTML output" });
        try { fs.unlinkSync(result.filePath); } catch (_) {}
        return;
      }

      const output = "*Output:*\n" + result.output;
      if (output.length > 4000) {
        const fs = require("fs");
        const fp = "/tmp/aria_code_output.txt";
        fs.writeFileSync(fp, result.output);
        const buf = fs.readFileSync(fp);
        await sock.sendMessage(msg.key.remoteJid, { document: buf, fileName: "output.txt", mimetype: "text/plain", caption: "Code output" });
        try { fs.unlinkSync(fp); } catch (_) {}
      } else {
        ctx.reply(output);
      }
    },


    // ── FILE UNDERSTANDING ─────────────────────────────────
    analyze: async (sock, msg, args, ctx) => {
      // Check if replying to a file/attachment
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const docMsg = quoted?.documentMessage || quoted?.imageMessage;
      if (!docMsg) return ctx.reply("Reply to a file with *!analyze* to analyze it.");

      await ctx.react("🔍");
      await ctx.reply("Analyzing file...");

      try {
        // Download the file
        const buffer = await sock.downloadMediaMessage(
          { key: { remoteJid: msg.key.remoteJid, id: msg.message.extendedTextMessage.contextInfo.stanzaId, fromMe: false },
            message: { documentMessage: docMsg } }
        );

        if (!buffer) return ctx.reply("Couldn't download the file.");

        // Save temporarily
        const fs = require("fs");
        const fileName = docMsg.fileName || "file";
        const filePath = "/tmp/aria_" + fileName;
        fs.writeFileSync(filePath, buffer);

        const { analyzeFile } = require("../src/tools/fileUnderstanding");
        const result = await analyzeFile(filePath);

        let text = "*📄 File Analysis*\n\n";
        text += "Name: " + result.info.name + "\n";
        text += "Size: " + result.info.size + "\n";
        text += "Type: " + (result.info.type || "Unknown") + "\n";
        if (result.info.lines) text += "Lines: " + result.info.lines + "\n";
        if (result.info.functions) text += "Functions: " + result.info.functions + "\n";
        if (result.info.contents) text += "Contents: " + result.info.contents + "\n";
        if (result.info.extensions) text += "Extensions: " + result.info.extensions + "\n";
        text += "\n" + result.summary;

        if (result.content) {
          text += "\n\n*Preview:*\n" + result.content.slice(0, 1500);
        }

        ctx.reply(text);
        try { fs.unlinkSync(filePath); } catch (_) {}
      } catch (e) {
        ctx.reply("Analysis failed: " + e.message);
      }
    },


    // ── VOICE ENHANCED ──────────────────────────────────────
    voices: async (sock, msg, args, ctx) => {
      const { listVoices } = require("../src/tools/voice");
      const voices = await listVoices();
      if (voices.length === 0) return ctx.reply("No voices available. Set ELEVENLABS_API_KEY in .env");
      let t = "*🎙️ Available Voices*\n\n";
      voices.slice(0, 10).forEach(v => { t += "• " + v.name + " (" + v.id.slice(0, 8) + "...)\n"; });
      ctx.reply(t);
    },
    say: async (sock, msg, args, ctx) => {
      const text = args.join(" ");
      if (!text) return ctx.reply("Usage: *!say <text>* — ARIA speaks it");
      await ctx.react("🔊");
      const { textToSpeech: speakResponse } = require("../src/tools/voice");
      const audio = await speakResponse(text);
      if (!audio) return ctx.reply("TTS failed. Set ELEVENLABS_API_KEY in .env");
      await sock.sendMessage(msg.key.remoteJid, { audio: audio, mimetype: "audio/mp4" });
    },


    // ── VOICE ENHANCED ──────────────────────────────────────
    say: async (sock, msg, args, ctx) => {
      const text = args.join(" ");
      if (!text) return ctx.reply("Usage: *!say <text>*");
      await ctx.react("🔊");
      const { textToSpeech: speakResponse } = require("../src/tools/voice");
      const audio = await speakResponse(text);
      if (!audio) return ctx.reply("TTS failed. Add ELEVENLABS_API_KEY to .env");
      await sock.sendMessage(msg.key.remoteJid, { audio: audio, mimetype: "audio/mp4" });
    },


    // ── TASK BOARD ──────────────────────────────────────────
    todo: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const { addTask, markDone, deleteTask, formatTasks } = require("../src/tools/taskBoard");
      const sub = args[0]?.toLowerCase();

      if (sub === "add" && args.slice(1).join(" ")) {
        const task = addTask(uid, args.slice(1).join(" "));
        return ctx.reply("✅ Added: " + task.text + " (ID: " + task.id + ")");
      }

      const id = parseInt(args[0]);
      if (!isNaN(id)) {
        const done = markDone(uid, id);
        if (done) return ctx.reply("🎉 *" + done.text + "* marked as done!");
        const deleted = deleteTask(uid, id);
        if (deleted) return ctx.reply("Deleted.");
        return ctx.reply("Task not found.");
      }

      // Show all tasks
      ctx.reply(formatTasks(uid));
    },
    done: async (sock, msg, args, ctx) => {
      // Alias for !todo <n>
      const uid = msg.key.participant || msg.key.remoteJid;
      const id = parseInt(args[0]);
      if (isNaN(id)) return ctx.reply("Usage: *!done <task_number>*");
      const { markDone } = require("../src/tools/taskBoard");
      const task = markDone(uid, id);
      if (!task) return ctx.reply("Task not found.");
      ctx.reply("🎉 *" + task.text + "* marked complete!");
    },
    // ── BACKUP ──────────────────────────────────────────────
    backup: async (sock, msg, args, ctx) => {
      await ctx.react("💾");
      await ctx.reply("Creating backup...");
      const { createBackup } = require("../src/tools/backupSystem");
      const result = await createBackup();
      if (!result.success) return ctx.reply("Backup failed: " + result.error);
      const fs = require("fs");
      const buf = fs.readFileSync(result.filePath);
      await sock.sendMessage(msg.key.remoteJid, { document: buf, fileName: "aria_backup.zip", mimetype: "application/zip", caption: "ARIA Backup (" + result.size + ")" });
      try { fs.unlinkSync(result.filePath); } catch (_) {}
    },
    restore: async (sock, msg, args, ctx) => {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quoted?.documentMessage) return ctx.reply("Reply to a backup ZIP with *!restore*");
      await ctx.react("🔄");
      await ctx.reply("Restoring...");
      try {
        const buffer = await sock.downloadMediaMessage({ key: { remoteJid: msg.key.remoteJid, id: msg.message.extendedTextMessage.contextInfo.stanzaId, fromMe: false }, message: { documentMessage: quoted.documentMessage } });
        const fp = "/tmp/aria_restore.zip";
        require("fs").writeFileSync(fp, buffer);
        const { restoreBackup } = require("../src/tools/backupSystem");
        const r = await restoreBackup(fp);
        try { require("fs").unlinkSync(fp); } catch (_) {}
        if (!r.success) return ctx.reply("Restore failed: " + r.error);
        ctx.reply("✅ Restored! Restart ARIA to apply.");
      } catch (e) { ctx.reply("Restore error: " + e.message); }
    },


    // ── PLUGIN DOCTOR ───────────────────────────────────────
    scanplugins: async (sock, msg, args, ctx) => {
      await ctx.react("🔍");
      const { scanAll, formatResults } = require("../src/tools/pluginDoctor");
      const results = scanAll();
      ctx.reply(formatResults(results));
    },
    // ── ANALYTICS ───────────────────────────────────────────
    analytics: async (sock, msg, args, ctx) => {
      const { getStats } = require("../src/tools/analytics");
      ctx.reply(getStats());
    },


    // ── AI PLUGIN BUILDER ───────────────────────────────────
    generateplugin: async (sock, msg, args, ctx) => {
      const desc = args.join(" ");
      if (!desc) return ctx.reply("Usage: *!generateplugin <description>*\nExample: *!generateplugin a fortune teller plugin*");
      await ctx.react("⚡");
      await ctx.reply("AI is building your plugin...");
      const { generatePlugin } = require("../src/tools/pluginBuilder");
      const result = await generatePlugin(desc, getSenderName(msg));
      if (!result.success) return ctx.reply("❌ " + result.error);
      const fs = require("fs");
      const buf = fs.readFileSync(result.path);
      await sock.sendMessage(msg.key.remoteJid, { document: buf, fileName: result.name + ".js", mimetype: "text/javascript", caption: "✅ Plugin *" + result.name + "* generated & installed! Restart to load." });
    },


    // ── PERSISTENT JOBS ─────────────────────────────────────
    job: async (sock, msg, args, ctx) => {
      const sub = args[0]?.toLowerCase();
      const { createJob, executeJob, getJobs, getJob, cancelJob, formatJobList } = require("../src/tools/persistentJobs");
      const uid = msg.key.participant || msg.key.remoteJid;
      if (sub === "create" && args.slice(1).join(" ")) {
        const task = args.slice(1).join(" ");
        const id = createJob(msg.key.remoteJid, uid, task);
        ctx.reply("Job *" + id + "* created. I will work on it in the background.");
        executeJob(id);
        return;
      }
      if (sub === "status" && args[1]) {
        const j = getJob(args[1]);
        if (!j) return ctx.reply("Job not found.");
        const icon = j.status === "completed" ? "✅" : j.status === "cancelled" ? "⛔" : "🔄";
        return ctx.reply(icon + " Job " + j.id + "\nTask: " + j.task + "\nStatus: " + j.status + "\nProgress: " + j.progress + "\nStep: " + j.currentStep + "/" + j.totalSteps);
      }
      if (sub === "view" && args[1]) {
        const j = getJob(args[1]);
        if (!j) return ctx.reply("Job not found.");
        if (!j.result) return ctx.reply("Job still running.");
        return ctx.reply("Result for " + j.id + "\n\n" + j.result.slice(0, 4000));
      }
      if (sub === "cancel" && args[1]) {
        const r = cancelJob(args[1]);
        return ctx.reply(r ? "Job cancelled." : "Job not found.");
      }
      if (sub === "list" || !sub) {
        const list = getJobs(msg.key.remoteJid);
        return ctx.reply("*Jobs*\n\n" + formatJobList(list));
      }
      return ctx.reply("Usage: !job create <task> / !job status <id> / !job view <id> / !job cancel <id> / !job list");
    },

    // ── WORKSPACE ───────────────────────────────────────────
    workspace: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const sub = args[0]?.toLowerCase();
      const { createProject, setCurrent, archiveProject, renameProject, formatWorkspace } = require("../src/tools/workspace");
      if (sub === "new" && args.slice(1).join(" ")) {
        createProject(uid, args.slice(1).join(" "), "");
        return ctx.reply("Project created: *" + args.slice(1).join(" ") + "*");
      }
      if (sub === "switch" && args[1]) {
        const p = setCurrent(uid, args.slice(1).join(" "));
        return ctx.reply(p ? "Switched to *" + p.name + "*" : "Not found.");
      }
      if (sub === "archive" && args[1]) {
        const r = archiveProject(uid, args.slice(1).join(" "));
        return ctx.reply(r ? "Archived." : "Not found.");
      }
      ctx.reply(formatWorkspace(uid));
    },
    resume: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      if (!args.join(" ")) return ctx.reply("Usage: *!resume <project name>*");
      const { setCurrent } = require("../src/tools/workspace");
      const p = setCurrent(uid, args.join(" "));
      ctx.reply(p ? "Resuming *" + p.name + "*. What do we do?" : "Project not found.");
    },
  },
};
