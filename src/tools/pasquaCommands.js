const crypto = require("crypto");
const axios = require("axios");
const QRCode = require("qrcode");
const {
  getGroupSettings,
  setAntiAdmin,
  getAntiAdmins,
  setProtection,
  setSlowmode,
  setIntroCard,
  setWelcomeMessage,
  setLeaveMessage,
} = require("../utils/groupSettings");
const { isOwner } = require("../utils/permissions");
const { isBotAdmin, jidNumber } = require("./groupAdmin");
const { reply, downloadMediaFromMsg, downloadQuotedMedia, getTargetJid, getQuotedMessageText } = require("../utils/baileysHelpers");
const { getJoke, getTruth, getRoast, getWouldYouRather } = require("./funGames");

const wcgGames = new Map();
const recentWords = new Map();
const random = (items) => items[Math.floor(Math.random() * items.length)];
const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const argText = (args) => clean(args);
const normalize = (value) => clean(value, 80).toLowerCase().replace(/[^a-z]/g, "");
const ownerNumber = () => String(process.env.OWNER_NUMBER || "").replace(/\D/g, "");
function isOwnerJid(jid) {
  const n = jidNumber(jid);
  return isOwner(jid) || (!!ownerNumber() && n === ownerNumber());
}

function toggleValue(args) {
  const value = String(args || "").trim().toLowerCase().split(/\s+/)[0];
  if (["on", "enable", "enabled", "yes", "true"].includes(value)) return true;
  if (["off", "disable", "disabled", "no", "false"].includes(value)) return false;
  return null;
}

async function requireGroup(sock, msg, ctx) {
  if (!ctx.isGroup) {
    await reply(sock, msg, "This command only works inside a WhatsApp group.");
    return false;
  }
  if (!(await isBotAdmin(sock, ctx.chatId))) {
    await reply(sock, msg, "I need to be a group admin before I can enforce that setting.");
    return false;
  }
  return true;
}

async function handleProtection(sock, msg, args, ctx) {
  if (!ctx.isGroup) return reply(sock, msg, "Protection toggles only work inside a group.");
  const name = ctx.pasquaCommand;
  const value = toggleValue(args);
  const settings = getGroupSettings(ctx.chatId);
  if (value === null) {
    const enabled = !!settings.protections?.[name];
    return reply(sock, msg, `🛡️ *${name}* is currently *${enabled ? "ON" : "OFF"}*. Use *${name} on* or *${name} off*.`);
  }
  if (!(await isBotAdmin(sock, ctx.chatId))) return reply(sock, msg, "I need to be a group admin before I can enforce protection toggles.");
  setProtection(ctx.chatId, name, value);
  return reply(sock, msg, `${value ? "✅ Enabled" : "⏸️ Disabled"} *${name}* for this group.`);
}

async function handleSlowmode(sock, msg, args, ctx) {
  if (!ctx.isGroup) return reply(sock, msg, "Slowmode only works inside a group.");
  const value = String(args || "").trim().toLowerCase();
  const settings = getGroupSettings(ctx.chatId);
  if (!value || value === "status") return reply(sock, msg, `🐢 Slowmode is *${settings.slowmodeSeconds || 0}s*. Use *slowmode off* or *slowmode 10*.`);
  if (!(await isBotAdmin(sock, ctx.chatId))) return reply(sock, msg, "I need to be a group admin before I can configure slowmode.");
  if (value === "off" || value === "0") {
    setSlowmode(ctx.chatId, 0);
    return reply(sock, msg, "✅ Slowmode disabled for this group.");
  }
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) return reply(sock, msg, "Choose a slowmode delay from 1 to 3600 seconds, or use *slowmode off*.");
  setSlowmode(ctx.chatId, seconds);
  return reply(sock, msg, `✅ Slowmode enabled: one message every *${seconds}s* per member.`);
}

async function handleAntiAdmin(sock, msg, args, ctx) {
  if (!ctx.isGroup) return reply(sock, msg, "Anti-admin rules only work inside a group.");
  if (!isOwnerJid(ctx.senderJid)) return reply(sock, msg, "❌ Only the owner can manage the anti-admin denylist.");
  if (!(await isBotAdmin(sock, ctx.chatId))) return reply(sock, msg, "I need to be a group admin to enforce anti-admin protection.");
  const raw = clean(args).toLowerCase();
  const target = getTargetJid(msg);
  if (raw === "list" || raw === "status") {
    const blocked = Object.values(getAntiAdmins(ctx.chatId));
    return reply(sock, msg, blocked.length ? `🛡️ Denied admin candidates:\n${blocked.map((item) => `• @${jidNumber(item.jid)}`).join("\n")}` : "🛡️ The anti-admin denylist is empty.", { mentions: blocked.map((item) => item.jid) });
  }
  if (!target) return reply(sock, msg, "Mention or reply to the person, then say *never make them admin* or *antiadmin on*.");
  const disable = /^(?:off|remove|allow|unblock|clear)\b/i.test(raw);
  setAntiAdmin(ctx.chatId, target, !disable, { addedBy: ctx.senderJid, reason: disable ? "owner_removed" : "owner_denied_admin" });
  return reply(sock, msg, disable ? `✅ @${jidNumber(target)} was removed from the anti-admin denylist.` : `🛡️ @${jidNumber(target)} is now a denied admin candidate. If promoted, ARIA will demote them immediately.`, { mentions: [target] });
}

async function handleKickAll(sock, msg, args, ctx) {
  if (!(await requireGroup(sock, msg, ctx))) return;
  const metadata = await sock.groupMetadata(ctx.chatId);
  const botId = jidNumber(sock?.user?.id);
  const targets = metadata.participants
    .map((p) => p.id)
    .filter((id) => jidNumber(id) !== botId && !isOwnerJid(id));
  if (!targets.length) return reply(sock, msg, "There is nobody I can remove. I protected you, the owner, and myself.");
  await reply(sock, msg, `⚠️ Removing *${targets.length}* members. Admins are included; the owner and ARIA are protected.`);
  let removed = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i += 20) {
    const batch = targets.slice(i, i + 20);
    try {
      const result = await sock.groupParticipantsUpdate(ctx.chatId, batch, "remove");
      removed += result.filter((r) => r.status === "200" || r.status === 200 || !r.status).length || batch.length;
    } catch (_) { failed += batch.length; }
  }
  return reply(sock, msg, `🧹 Kickall finished. Removed approximately *${removed}* member(s); *${failed}* failed. Owner and ARIA were excluded.`);
}

async function handleMemberCount(sock, msg, args, ctx) {
  if (!ctx.isGroup) return reply(sock, msg, "Member count only works inside a group.");
  const metadata = await sock.groupMetadata(ctx.chatId);
  const admins = metadata.participants.filter((p) => p.admin).length;
  return reply(sock, msg, `👥 *${metadata.subject || "This group"}*\nMembers: *${metadata.participants.length}*\nAdmins: *${admins}*`);
}

async function handleListAdmins(sock, msg, args, ctx) {
  if (!ctx.isGroup) return reply(sock, msg, "List admins only works inside a group.");
  const metadata = await sock.groupMetadata(ctx.chatId);
  const admins = metadata.participants.filter((p) => p.admin).map((p) => p.id);
  return reply(sock, msg, `👑 Group admins (*${admins.length}*):\n${admins.map((id) => `• @${jidNumber(id)}`).join("\n")}`, { mentions: admins });
}

async function sendImageBuffer(sock, msg, ctx, buffer, caption) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return reply(sock, msg, "No image was returned by the source.");
  await sock.sendMessage(ctx.chatId, { image: buffer, caption }, { quoted: msg });
}

async function handlePinterestBatch(sock, msg, args, ctx) {
  const raw = clean(args, 300);
  const countMatch = raw.match(/\b(\d{1,2})\s*(?:pics?|pictures?|images?|photos?)\b/i);
  const requested = Math.max(1, Math.min(10, Number.parseInt(countMatch?.[1] || "5", 10)));
  const query = raw.replace(/\b\d{1,2}\s*(?:pics?|pictures?|images?|photos?)\b/i, "").replace(/^\s*(?:of|for|on)\s+/i, "").trim();
  if (!query) return reply(sock, msg, "Usage: give me 5 pics of Goku. The default is 5 and the maximum is 10.");
  const pins = [];
  try {
    if (process.env.PINTEREST_ACCESS_TOKEN) {
      const response = await axios.get("https://api.pinterest.com/v5/search/partner/pins", {
        params: { query, limit: requested },
        headers: { Authorization: `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}`, Accept: "application/json" },
        timeout: 15000,
      });
      for (const pin of response.data?.items || []) {
        const imageUrl = pin.media?.images?.["1200x"]?.url || pin.media?.images?.original?.url || pin.images?.orig?.url;
        if (imageUrl) pins.push({ imageUrl, link: pin.link || (pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : "") });
      }
    } else {
      // No scraping: the unauthenticated Pinterest web page is not a stable API.
      // This fallback uses a public image search endpoint and labels the source.
      const response = await axios.get("https://commons.wikimedia.org/w/api.php", {
        params: { action: "query", generator: "search", gsrsearch: query, gsrnamespace: 6, gsrlimit: requested, prop: "imageinfo", iiprop: "url", iiurlwidth: 900, format: "json", origin: "*" },
        headers: { "User-Agent": "ARIA-Bot/1.0" }, timeout: 15000,
      });
      for (const page of Object.values(response.data?.query?.pages || {})) {
        const info = page.imageinfo?.[0];
        if (info?.thumburl || info?.url) pins.push({ imageUrl: info.thumburl || info.url, link: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || "").replace(/ /g, "_"))}` });
      }
    }
  } catch (err) {
    return reply(sock, msg, `❌ Image search failed: ${err.response?.status || err.message}`);
  }
  if (!pins.length) return reply(sock, msg, process.env.PINTEREST_ACCESS_TOKEN ? `No Pinterest images found for *${query}*.` : `No public image results found for *${query}*. Add PINTEREST_ACCESS_TOKEN for official Pinterest results.`);
  let sent = 0;
  for (const pin of pins.slice(0, requested)) {
    try {
      const image = await axios.get(pin.imageUrl, { responseType: "arraybuffer", timeout: 15000 });
      await sock.sendMessage(ctx.chatId, { image: Buffer.from(image.data), caption: `🖼️ ${query}${pin.link ? `\n${pin.link}` : ""}` }, { quoted: msg });
      sent++;
    } catch (_) {}
  }
  return reply(sock, msg, sent ? `✅ Sent ${sent} image${sent === 1 ? "" : "s"} for *${query}*.${process.env.PINTEREST_ACCESS_TOKEN ? " Source: Pinterest." : " Source: public fallback; add PINTEREST_ACCESS_TOKEN for Pinterest."}` : "❌ The image source returned no downloadable images.");
}

async function handleProfilePicture(sock, msg, args, ctx) {
  const name = ctx.pasquaCommand;
  if (name === "randompp") {
    try {
      const response = await axios.get("https://randomuser.me/api/?inc=name,picture&noinfo", { timeout: 12000 });
      const person = response.data?.results?.[0];
      const imageUrl = person?.picture?.large || person?.picture?.medium;
      if (!imageUrl) return reply(sock, msg, "The random portrait service returned no image.");
      const image = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
      const label = person?.name ? `${person.name.first} ${person.name.last}` : "random portrait";
      return sendImageBuffer(sock, msg, ctx, Buffer.from(image.data), `🎲 Random profile portrait\n${label}`);
    } catch (err) {
      return reply(sock, msg, `❌ Random profile picture failed: ${err.message}`);
    }
  }
  const target = getTargetJid(msg) || ctx.senderJid;
  try {
    const imageUrl = await sock.profilePictureUrl(target, "image");
    if (!imageUrl) return reply(sock, msg, "That user does not have a visible profile picture.");
    const image = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
    return sendImageBuffer(sock, msg, ctx, Buffer.from(image.data), `🖼️ Profile picture of @${jidNumber(target)}`);
  } catch (err) {
    return reply(sock, msg, `❌ I couldn't retrieve that profile picture: ${err.message}`);
  }
}

async function handleGroupPicture(sock, msg, args, ctx) {
  if (!ctx.isGroup) return reply(sock, msg, "Group picture commands only work inside a group.");
  const action = String(args || "").trim().toLowerCase();
  if (action === "get" || action === "show" || !action) {
    const url = await sock.profilePictureUrl(ctx.chatId, "image").catch(() => null);
    return reply(sock, msg, url ? `🖼️ Group profile picture:\n${url}` : "This group does not have a readable profile picture.");
  }
  if (!(await isBotAdmin(sock, ctx.chatId))) return reply(sock, msg, "I need to be a group admin to change the group picture.");
  const media = await downloadMediaFromMsg(sock, msg) || await downloadQuotedMedia(sock, msg);
  if (!media?.mimetype?.startsWith("image/")) return reply(sock, msg, "Send or reply to an image with *setgpp*.");
  await sock.updateProfilePicture(ctx.chatId, media.buffer);
  return reply(sock, msg, "✅ Group profile picture updated.");
}

async function handleIntroCard(sock, msg, args, ctx) {
  if (!ctx.isGroup) return reply(sock, msg, "Introduction cards only work inside a group.");
  const value = clean(args);
  if (!value || value.toLowerCase() === "show") {
    const card = getGroupSettings(ctx.chatId).introCard;
    return reply(sock, msg, card ? `🪪 Current intro card:\n${card.text}` : "No intro card is configured. Use *introcard <message>*.");
  }
  if (value.toLowerCase() === "off") {
    setIntroCard(ctx.chatId, null);
    return reply(sock, msg, "✅ Introduction card disabled.");
  }
  if (!(await isBotAdmin(sock, ctx.chatId))) return reply(sock, msg, "I need to be a group admin to configure the intro card.");
  setIntroCard(ctx.chatId, { text: value, updatedBy: ctx.senderJid, updatedAt: Date.now() });
  return reply(sock, msg, "✅ Introduction card saved. New members will receive it when they join.");
}

async function handleWelcomeMessage(sock, msg, args, ctx) {
  if (!ctx.isGroup) return reply(sock, msg, "Welcome settings only work inside a group.");
  const value = clean(args);
  if (!value) return reply(sock, msg, `Current welcome message: ${getGroupSettings(ctx.chatId).welcomeMsg || "default"}. Use *setwelcomemsg <message>*.`);
  if (!(await isBotAdmin(sock, ctx.chatId))) return reply(sock, msg, "I need to be a group admin to change the welcome message.");
  setWelcomeMessage(ctx.chatId, value);
  return reply(sock, msg, "✅ Welcome message saved. Use `{user}` where the new member's mention should appear.");
}

async function handleGoodbyeMessage(sock, msg, args, ctx) {
  if (!ctx.isGroup) return reply(sock, msg, "Goodbye settings only work inside a group.");
  const value = clean(args);
  if (!value) return reply(sock, msg, `Current goodbye message: ${getGroupSettings(ctx.chatId).leaveMsg || "not configured"}. Use *setgoodbyemsg <message>*.`);
  if (!(await isBotAdmin(sock, ctx.chatId))) return reply(sock, msg, "I need to be a group admin to change the goodbye message.");
  setLeaveMessage(ctx.chatId, value);
  return reply(sock, msg, "✅ Goodbye message saved. Use `{user}` where the departing member's mention should appear.");
}

async function handleProfile(sock, msg, args, ctx) {
  if (!isOwnerJid(ctx.senderJid)) return reply(sock, msg, "❌ This WhatsApp profile command is owner-only.");
  const value = clean(args, 500);
  const name = ctx.pasquaCommand;
  if (name === "setbio") {
    if (!value) return reply(sock, msg, "Usage: *setbio <new ARIA status>*.");
    await sock.updateProfileStatus(value);
    return reply(sock, msg, "✅ ARIA's WhatsApp bio/status was updated.");
  }
  if (name === "setname") {
    if (!value) return reply(sock, msg, "Usage: *setname <new ARIA name>*.");
    await sock.updateProfileName(value);
    return reply(sock, msg, "✅ ARIA's WhatsApp display name was updated.");
  }
  const media = await downloadMediaFromMsg(sock, msg) || await downloadQuotedMedia(sock, msg);
  if (!media?.mimetype?.startsWith("image/")) return reply(sock, msg, "Send or reply to an image with *setpp*.");
  await sock.updateProfilePicture(sock.user?.id?.split(":")[0] || sock.user?.id, media.buffer);
  return reply(sock, msg, "✅ ARIA's WhatsApp profile picture was updated.");
}

function textHandler(fn) {
  return async (sock, msg, args) => reply(sock, msg, fn(clean(args)));
}

const STATIC = {
  ascii: (s) => s ? `┌${"─".repeat(Math.min(36, s.length + 2))}┐\n│ ${s.slice(0, 34)} │\n└${"─".repeat(Math.min(36, s.length + 2))}┘` : "Usage: ascii <text>",
  clap: (s) => `${s || "That was impressive"} 👏 👏 👏`,
  mirror: (s) => s ? s.split("").reverse().join("") : "Usage: mirror <text>",
  reverse: (s) => s ? s.split("").reverse().join("") : "Usage: reverse <text>",
  upper: (s) => s ? s.toUpperCase() : "Usage: upper <text>",
  lower: (s) => s ? s.toLowerCase() : "Usage: lower <text>",
  lowerall: (s) => s ? s.toLowerCase() : "Usage: lowerall <text>",
  capitalize: (s) => s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Usage: capitalize <text>",
  title: (s) => s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Usage: title <text>",
  len: (s) => `Length: *${s.length}*`,
  charcount: (s) => `Characters: *${s.length}* (without spaces: *${s.replace(/\s/g, "").length}*)`,
  wordcount: (s) => `Words: *${s ? s.split(/\s+/).length : 0}*`,
  vowelcount: (s) => `Vowels: *${(s.match(/[aeiou]/gi) || []).length}*`,
  dedupe: (s) => [...new Set(s.split(/\s+/).filter(Boolean))].join(" ") || "Usage: dedupe <text>",
  slugify: (s) => s ? s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "Usage: slugify <text>",
  urlencode: (s) => s ? encodeURIComponent(s) : "Usage: urlencode <text>",
  urldecode: (s) => { try { return decodeURIComponent(s); } catch (_) { return "That URL encoding is invalid."; } },
  b64encode: (s) => s ? Buffer.from(s).toString("base64") : "Usage: b64encode <text>",
  base64: (s) => s ? Buffer.from(s).toString("base64") : "Usage: base64 <text>",
  b64decode: (s) => { try { return Buffer.from(s, "base64").toString("utf8") || "(empty)"; } catch (_) { return "Invalid Base64."; } },
  hexencode: (s) => s ? Buffer.from(s).toString("hex") : "Usage: hexencode <text>",
  hexdecode: (s) => { try { return Buffer.from(s, "hex").toString("utf8") || "(empty)"; } catch (_) { return "Invalid hexadecimal."; } },
  bin: (s) => s ? Buffer.from(s).toString("binary").split("").map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join(" ") : "Usage: bin <text>",
  binary: (s) => s ? Buffer.from(s).toString("binary").split("").map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join(" ") : "Usage: binary <text>",
  unbin: (s) => { try { return s.split(/\s+/).map((x) => String.fromCharCode(parseInt(x, 2))).join(""); } catch (_) { return "Invalid binary."; } },
  rot13: (s) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(c.charCodeAt(0) + (/[a-m]/i.test(c) ? 13 : -13))),
  caesar: (s) => { const parts = s.split(/\s+/); const shift = Number(parts.shift()); const text = parts.join(" "); if (!Number.isInteger(shift) || !text) return "Usage: caesar <shift> <text>"; return text.replace(/[a-z]/gi, (c) => { const base = c <= "Z" ? 65 : 97; return String.fromCharCode((c.charCodeAt(0) - base + shift % 26 + 26) % 26 + base); }); },
  morse: (s) => { const map = { a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--", n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..", " ": "/" }; return s ? s.toLowerCase().split("").map((c) => map[c] || c).join(" ") : "Usage: morse <text>"; },
  roman: (s) => { let n = Number.parseInt(s, 10); if (!Number.isInteger(n) || n < 1 || n > 3999) return "Usage: roman <integer 1-3999>"; const vals = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]]; let out = ""; for (const [v, token] of vals) { while (n >= v) { out += token; n -= v; } } return out; },
  fontmaker: (s) => s ? `𝙰𝚁𝙸𝙰 𝙵𝙾𝙽𝚃\n${s.split("").map((c) => /[a-z]/i.test(c) ? String.fromCodePoint((c.toLowerCase().charCodeAt(0) - 97) + 0x1d41a) : c).join("")}` : "Usage: fontmaker <text>",
  pct: (s) => { const [a, b] = s.split(/\s+/).map(Number); return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? `${(a / b * 100).toFixed(2)}%` : "Usage: pct <part> <whole>"; },
  percentage: (s) => STATIC.pct(s),
  uuid: () => crypto.randomUUID(),
  leet: (s) => s.replace(/[aA eEiIoOsStTbB]/g, (c) => ({ a: "4", e: "3", i: "1", o: "0", s: "5", t: "7", b: "8" }[c.toLowerCase()] || c)),
  spongebob: (s) => s ? s.split("").map((c, i) => /[a-z]/i.test(c) ? (i % 2 ? c.toLowerCase() : c.toUpperCase()) : c).join("") : "Usage: spongebob <text>",
  vapor: (s) => s ? `Ｗｅｌｃｏｍｅ　ｔｏ　ｔｈｅ　ｖａｐｏｒｗａｖｅ\n${s.split("").join(" ")}` : "Usage: vapor <text>",
  unascii: (s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " "),
  quoted: (s, ctx) => getQuotedMessageText(ctx.msg) || "Reply to a message and use *quoted* to read it.",
  randomcolor: () => `#${crypto.randomBytes(3).toString("hex")}`,
  randomletter: () => String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  randomword: () => random(["starlight", "momentum", "courage", "wonder", "kinetic", "harmony", "voyage"]),
  randomcity: () => random(["Lagos", "Accra", "London", "Nairobi", "Tokyo", "Seoul", "Toronto", "New York"]),
  randomcountry: () => random(["Nigeria", "Ghana", "Japan", "Kenya", "Canada", "Brazil", "France", "South Korea"]),
  randomfood: () => random(["jollof rice", "ramen", "tacos", "pizza", "suya", "sushi", "pancakes"]),
  randomdrink: () => random(["zobo", "iced tea", "coffee", "matcha", "smoothie", "ginger beer"]),
  randomemoji: () => random(["🌙", "✨", "🔥", "🌊", "🪐", "🦋", "⚡"]),
  randomanimal: () => random(["red panda", "otter", "snow leopard", "fox", "eagle", "capybara"]),
  randomname: () => random(["Aster", "Mira", "Nova", "Sora", "Zuri", "Kairo", "Nia"]),
  advice: () => random(["Start smaller than your fear says you should.", "Protect your attention like it is money.", "Consistency beats one heroic day." ]),
  quote: () => random(["The best time to begin is the moment you stop negotiating with yourself.", "Small systems create large freedoms.", "Clarity is kindness to your future self." ]),
  dadjoke: () => random(["I only know 25 letters of the alphabet. I don't know y.", "Why did the computer get cold? It left its Windows open.", "I told my bot a joke about UDP. I’m not sure it got it." ]),
  pickup: () => random(["Are you a compiler? Because you make my errors disappear.", "You must be a stable release: I want to keep you around." ]),
  riddle: () => random(["I speak without a mouth and hear without ears. What am I? An echo.", "What has keys but cannot open locks? A keyboard." ]),
  neverhaveiever: () => random(["Never have I ever sent a message and instantly regretted it.", "Never have I ever pretended to understand a group chat." ]),
  truth2: () => getTruth(),
  joke: () => getJoke(),
  truth: () => getTruth(),
  wyr: () => getWouldYouRather(),
  roast: (s) => `${s || "You"}, you have the confidence of a production deploy with no tests.`,
  insult: (s) => `${s || "You"}, even your loading screen needs a loading screen.`,
  compliment: (s) => `${s || "You"}, you make difficult things look more possible.`,
  motivate2: (s) => `${s || "You"}: your next small action matters more than your last perfect plan.`,
  yomama: () => "Yo mama is so organised, even her chaos has a changelog.",
  awoo: () => "Awoooooo! 🐺",
  blush: (s) => `${s || "Someone"} made ARIA blush. That was dangerously smooth.`,
  cry: () => "*ARIA offers a tiny blanket and an unapologetically dramatic sigh.*",
  hug: (s) => `🤗 *ARIA hugs ${s || "you"} carefully.*`,
  kiss: (s) => `💋 *ARIA gives ${s || "you"} a respectful virtual kiss.*`,
  pat: (s) => `*pat pat* ${s || "You"} are doing better than you think.`,
  poke: (s) => `👉 *poke* ${s || "you"} — yes, I’m still here.`,
  wink: (s) => `😉 ${s || "You"} know exactly what you’re doing.`,
  slap: (s) => `🫳 *ARIA gives ${s || "you"} a gentle fictional slap and a reality check.*`,
  smack: (s) => `💥 *cartoon smack* ${s || "you"}, reset and try again.`,
  bonk: (s) => `🔨 Bonk. ${s || "Bonk recipient"}, no horny jail escapes today.`,
  punch: (s) => `🥊 *fictional punch* ${s || "you"} — only in the game, obviously.`,
  friendship: (s) => `${s || "You two"} have friendship energy: ${Math.floor(Math.random() * 41) + 60}%.`,
  simp: (s) => `${s || "You"} simp level: ${Math.floor(Math.random() * 101)}%.`,
  rate: (s) => `${s || "That"} gets a ${Math.floor(Math.random() * 51) + 50}/100 from ARIA.`,
  predict: (s) => `Prediction for ${s || "your next move"}: unexpectedly good, if you actually start.`,
  beauty: (s) => `${s || "You"} beauty rating: ${Math.floor(Math.random() * 11) + 90}/100.`,
  colorname: (s) => `${s || "That name"} feels like ${random(["violet", "amber", "midnight blue", "coral", "mint"])}.`,
  mock: (s) => `${s || "That idea"} has potential. The execution, however, is currently wearing one shoe.`,
  meme: (s) => `MEME: ${s || "When the code works first try"}\nExpectation: 😎\nReality: 🧯`,
  pp: (s) => `Profile-picture energy for ${s || "you"}: ${random(["main-character", "mysterious", "soft villain", "clean professional", "chaotic genius"])}.`,
  milf: () => "I keep this command non-explicit. Try *compliment*, *pickup*, or a PG-13 joke instead.",
};

function numberResult(name, args) {
  const n = Number.parseInt(String(args || "").trim(), 10);
  if (name === "factorial") {
    if (!Number.isInteger(n) || n < 0 || n > 170) return "Usage: factorial <integer 0-170>";
    let out = 1n; for (let i = 2n; i <= BigInt(n); i++) out *= i; return out.toString();
  }
  if (name === "fibonacci") {
    if (!Number.isInteger(n) || n < 0 || n > 10000) return "Usage: fibonacci <integer 0-10000>";
    let a = 0n, b = 1n; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a.toString();
  }
  if (name === "prime") return Number.isInteger(n) && n > 1 && Array.from({ length: Math.floor(Math.sqrt(n)) - 1 }, (_, i) => i + 2).every((d) => n % d !== 0) ? `${n} is prime.` : `${n} is not prime.`;
  if (name === "gcd" || name === "lcm") {
    const [a, b] = String(args || "").split(/\s+/).map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return `Usage: ${name} <a> <b>`;
    const gcd = (x, y) => y ? gcd(y, x % y) : Math.abs(x);
    return String(name === "gcd" ? gcd(a, b) : Math.abs(a * b) / (gcd(a, b) || 1));
  }
  return null;
}

function hashResult(name, args) {
  const value = clean(args);
  if (!value) return `Usage: ${name} <text>`;
  const algorithm = name === "hash" ? "sha256" : name;
  return crypto.createHash(algorithm).update(value).digest("hex");
}

function securePassword(args) {
  const n = Math.max(8, Math.min(128, Number.parseInt(String(args || "").trim(), 10) || 20));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=";
  const bytes = crypto.randomBytes(n);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function handleUtility(sock, msg, args, ctx) {
  const name = ctx.pasquaCommand;
  if (["password", "pass2"].includes(name)) return reply(sock, msg, `🔐 Secure password (${Math.max(8, Number(args) || 20)} chars):\n\`${securePassword(args)}\``);
  if (["md5", "sha1", "sha256", "hash"].includes(name)) return reply(sock, msg, hashResult(name, args));
  if (["factorial", "fibonacci", "prime", "gcd", "lcm"].includes(name)) return reply(sock, msg, numberResult(name, args));
  if (["base", "b64encode", "base64"].includes(name)) return reply(sock, msg, STATIC.b64encode(args));
  if (["b64decode"].includes(name)) return reply(sock, msg, STATIC.b64decode(args));
  if (["hexencode", "hexdecode", "bin", "binary", "unbin", "rot13"].includes(name)) return reply(sock, msg, STATIC[name](clean(args)));
  if (name === "qrcode") {
    const value = clean(args, 1000);
    if (!value) return reply(sock, msg, "Usage: qrcode <text or URL>");
    const data = await QRCode.toBuffer(value, { type: "png", width: 640, margin: 2 });
    return sock.sendMessage(ctx.chatId, { image: data, caption: `QR code for: ${value}` }, { quoted: msg });
  }
  if (name === "iss") {
    const response = await axios.get("http://api.open-notify.org/iss-now.json", { timeout: 10000 });
    const p = response.data?.iss_position;
    return reply(sock, msg, p ? `🛰️ ISS position\nLatitude: ${p.latitude}\nLongitude: ${p.longitude}\nTime: ${new Date(response.data.timestamp * 1000).toISOString()}` : "ISS data unavailable.");
  }
  if (name === "shorturl") {
    const url = clean(args, 1800);
    if (!/^https?:\/\//i.test(url)) return reply(sock, msg, "Usage: shorturl <https://...>");
    const response = await axios.get("https://tinyurl.com/api-create.php", { params: { url }, timeout: 15000, responseType: "text" });
    return reply(sock, msg, response.data || "Shortener returned no URL.");
  }
  if (["datefmt", "timestamp", "timezone"].includes(name)) {
    const date = new Date(clean(args) || Date.now());
    if (Number.isNaN(date.getTime())) return reply(sock, msg, "I couldn't parse that date.");
    if (name === "timestamp") return reply(sock, msg, String(date.getTime()));
    if (name === "timezone") return reply(sock, msg, Intl.DateTimeFormat().resolvedOptions().timeZone);
    return reply(sock, msg, date.toISOString());
  }
  if (name === "urlencode" || name === "urldecode") return reply(sock, msg, STATIC[name](clean(args)));
  if (Object.prototype.hasOwnProperty.call(STATIC, name)) return reply(sock, msg, STATIC[name](clean(args), ctx));
  if (["randomanime", "randompokemon"].includes(name)) {
    if (name === "randompokemon") {
      const id = Math.floor(Math.random() * 1025) + 1;
      const p = await axios.get(`https://pokeapi.co/api/v2/pokemon/${id}`, { timeout: 10000 });
      return reply(sock, msg, `🎲 ${p.data.name} (#${p.data.id})`);
    }
    const q = `query{Page(perPage:1){media(type:ANIME,sort:TRENDING){title{english romaji}siteUrl}}}`;
    const p = await axios.post("https://graphql.anilist.co", { query: q }, { timeout: 10000 });
    const a = p.data?.data?.Page?.media?.[0];
    return reply(sock, msg, a ? `🎲 ${a.title.english || a.title.romaji}\n${a.siteUrl || ""}` : "No anime result right now.");
  }
  return reply(sock, msg, "That utility is not available yet.");
}

async function handleFun(sock, msg, args, ctx) {
  const name = ctx.pasquaCommand;
  if (name === "8ball" || name === "answer") return reply(sock, msg, `🎱 ${random(["Definitely.", "Probably.", "Ask me again later.", "Not a chance.", "The signs are promising."])}`);
  if (name === "choose") { const values = clean(args).split(/\s+or\s+|\s*,\s*/i).filter(Boolean); return reply(sock, msg, values.length > 1 ? `I choose: *${random(values)}*` : "Usage: choose red or blue"); }
  if (name === "lovecalc" || name === "match") return reply(sock, msg, `💞 Match score: *${Math.floor(Math.random() * 51) + 50}%*`);
  if (name === "wcg") return handleWcgCommand(sock, msg, args, ctx);
  if (name === "aichat" || name === "essay" || name === "summarize") return handleAIShortcut(sock, msg, args, ctx);
  if (Object.prototype.hasOwnProperty.call(STATIC, name)) return reply(sock, msg, STATIC[name](clean(args), ctx));
  return reply(sock, msg, `${name}: ${getRoast(clean(args) || "you")}`);
}

async function handleAIShortcut(sock, msg, args, ctx) {
  const prompt = clean(args, 3500);
  if (!prompt) return reply(sock, msg, `Usage: ${ctx.pasquaCommand} <request>`);
  const { getAIResponse } = require("./ai");
  const instruction = ctx.pasquaCommand === "essay" ? `Write a polished essay about: ${prompt}` : ctx.pasquaCommand === "summarize" ? `Summarize this clearly and briefly:\n${prompt}` : prompt;
  const response = await getAIResponse(instruction, ctx.senderName, "", null, "", { userContext: "Use ARIA's warm, concise, sassy but professional personality." });
  return reply(sock, msg, response || "The text model did not return a response.");
}

async function handleWcgCommand(sock, msg, args, ctx) {
  const command = clean(args).toLowerCase();
  if (command === "stop" || command === "end") {
    wcgGames.delete(ctx.chatId); recentWords.delete(ctx.chatId);
    return reply(sock, msg, "🛑 Word Chain Game ended.");
  }
  if (wcgGames.has(ctx.chatId) && command && command !== "status") return handleWcgWord(sock, msg, command, ctx);
  if (command === "status") return reply(sock, msg, wcgGames.has(ctx.chatId) ? `🔤 Current word: *${wcgGames.get(ctx.chatId).last}*. Next word starts with *${wcgGames.get(ctx.chatId).last.slice(-1).toUpperCase()}*.` : "No Word Chain Game is active.");
  const first = normalize(command) || random(["moon", "river", "aria", "planet", "comet"]);
  wcgGames.set(ctx.chatId, { last: first, startedBy: ctx.senderJid, startedAt: Date.now() });
  recentWords.set(ctx.chatId, new Set([first]));
  return reply(sock, msg, `🔤 *Word Chain Game started!*\nStarting word: *${first}*\nNext word must start with *${first.slice(-1).toUpperCase()}*. Send *wcg stop* to end it.`);
}

async function handleWcgWord(sock, msg, word, ctx) {
  const cleanWord = normalize(word);
  const game = wcgGames.get(ctx.chatId);
  if (!game) return false;
  const used = recentWords.get(ctx.chatId) || new Set();
  if (!cleanWord) return true;
  if (cleanWord[0] !== game.last.slice(-1)) return reply(sock, msg, `❌ *${word}* must start with *${game.last.slice(-1).toUpperCase()}*.`).then(() => true);
  if (used.has(cleanWord)) return reply(sock, msg, "❌ That word was already used. Try another one.").then(() => true);
  used.add(cleanWord); recentWords.set(ctx.chatId, used);
  game.last = cleanWord; wcgGames.set(ctx.chatId, game);
  return reply(sock, msg, `✅ *${cleanWord}* accepted. Next letter: *${cleanWord.slice(-1).toUpperCase()}*.`).then(() => true);
}

function handleWcgReply(sock, msg, text, ctx) {
  if (!ctx.isGroup || !wcgGames.has(ctx.chatId) || /^\s*(?:wcg|!wcg)\b/i.test(text)) return false;
  return handleWcgWord(sock, msg, text, ctx);
}

function makeDefinition(name, aliases, category, handler, ownerOnly = false) {
  return { name, aliases, category, handler, ownerOnly, description: `PASQUA ${name} command` };
}

function getPasquaCommands() {
  const defs = [];
  const protections = ["antibot", "antidemote", "antigroupmention", "antigroupstatus", "antihijack", "antimention", "antipromote"];
  for (const name of protections) defs.push(makeDefinition(name, [], "group", handleProtection));
  defs.push(makeDefinition("slowmode", [], "group", handleSlowmode));
  defs.push(makeDefinition("antiadmin", ["neveradmin", "blockadmin", "denyadmin"], "group", handleAntiAdmin, true));
  defs.push(makeDefinition("kickall", [], "group", handleKickAll, true));
  defs.push(makeDefinition("membercount", ["members"], "group", handleMemberCount));
  defs.push(makeDefinition("listadmins", ["admins"], "group", handleListAdmins));
  defs.push(makeDefinition("getgpp", ["grouppic"], "group", handleGroupPicture));
  defs.push(makeDefinition("setgpp", [], "group", handleGroupPicture));
  defs.push(makeDefinition("introcard", [], "group", handleIntroCard));
  defs.push(makeDefinition("setwelcomemsg", [], "group", handleWelcomeMessage));
  defs.push(makeDefinition("setgoodbyemsg", ["goodbyemsg", "setleavemsg"], "group", handleGoodbyeMessage));
  defs.push(makeDefinition("setbio", [], "profile", handleProfile, true));
  defs.push(makeDefinition("setname", [], "profile", handleProfile, true));
  defs.push(makeDefinition("setpp", [], "profile", handleProfile, true));
  defs.push(makeDefinition("pp", [], "media", handleProfilePicture));
  defs.push(makeDefinition("randompp", [], "media", handleProfilePicture));
  defs.push(makeDefinition("pinterest", ["pins", "pinsearch", "imagebatch"], "media", handlePinterestBatch));

  const utilityAliases = {
    ascii: [], b64decode: [], b64encode: [], base: [], base64: [], bin: [], binary: [], caesar: [], capitalize: [], charcount: [], clap: [], datefmt: [], dedupe: [], factorial: [], fibonacci: [], fontmaker: [], gcd: [], hash: [], hexdecode: [], hexencode: [], iss: [], lcm: [], leet: [], len: [], lower: [], lowerall: [], md5: [], mirror: [], mock: [], morse: [], password: ["pass"], pct: [], percentage: [], prime: [], qrcode: ["qr"], quoted: [], randomcolor: [], reverse: [], roman: [], rot13: [], sha1: [], sha256: [], shorturl: [], slugify: [], spongebob: [], timestamp: [], timezone: [], title: [], unascii: [], unbin: [], upper: [], urldecode: [], urlencode: [], uuid: [], vapor: [], vowelcount: [], wordcount: [], pass2: []
  };
  for (const [name, aliases] of Object.entries(utilityAliases)) defs.push(makeDefinition(name, aliases, "utility", handleUtility));
  const generators = { randomanimal: [], randomanime: [], randomcity: [], randomcountry: [], randomdrink: [], randomemoji: [], randomfood: [], randomletter: [], randomname: [], randomnumber: [], randompokemon: [], randomword: [] };
  for (const [name, aliases] of Object.entries(generators)) defs.push(makeDefinition(name, aliases, "fun", name === "randomnumber" ? textHandler((s) => String(Math.floor(Math.random() * (Number(s) || 100) + 1))) : handleUtility));

  const funNames = ["8ball", "advice", "answer", "awoo", "beauty", "blush", "bonk", "brainteaser", "choose", "chucknorris", "colorname", "compliment", "cry", "dadjoke", "emoji", "friendship", "hug", "insult", "kill", "kiss", "lovecalc", "match", "meme", "milf", "motivate2", "neverhaveiever", "owofy", "pass2", "pat", "pickup", "poke", "predict", "punch", "quote", "rate", "riddle", "shinobu", "simp", "slap", "smack", "truth2", "wcg", "wink", "yomama"];
  for (const name of funNames) if (!defs.some((d) => d.name === name)) defs.push(makeDefinition(name, [], "fun", handleFun));
  defs.push(makeDefinition("aichat", ["chat"], "ai", handleAIShortcut));
  defs.push(makeDefinition("essay", [], "ai", handleAIShortcut));
  defs.push(makeDefinition("summarize", ["summary"], "ai", handleAIShortcut));
  return defs;
}

function registerPasquaCommands(register) {
  for (const definition of getPasquaCommands()) register(definition);
}

module.exports = { getPasquaCommands, registerPasquaCommands, handleWcgReply, handleWcgCommand, handlePinterestBatch };
