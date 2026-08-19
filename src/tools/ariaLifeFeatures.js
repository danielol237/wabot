const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isOwner } = require("../utils/permissions");
const { getMemory, getAllChats } = require("../utils/memory");
const { getAllStores, getProfile } = require("../utils/semanticMemory");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "ariaLifeFeatures.json");
const OBSIDIAN_DIR = String(process.env.ARIA_OBSIDIAN_VAULT_DIR || "").trim();
const MAX_NOTE_LENGTH = 4000;
const MAX_DREAMS = 365;
const MAX_MOODS = 730;
const MAX_NOTES = 1000;

let state = { capsules: [], dreams: [], moods: [], notes: [] };
try {
  if (fs.existsSync(FILE)) state = { ...state, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
} catch (_) {}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
    try { fs.chmodSync(FILE, 0o600); } catch (_) {}
  } catch (_) {}
}

function clean(value, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function requireOwner(ctx) {
  return isOwner(ctx.senderJid);
}

function keyMaterial() {
  const raw = String(process.env.ARIA_CAPSULE_KEY || process.env.SESSION_ENCRYPT_KEY || "").trim();
  if (!raw) return null;
  return crypto.createHash("sha256").update(`${raw}:aria-time-capsule`).digest();
}

function encrypt(text) {
  const key = keyMaterial();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
}

function decrypt(packet) {
  const key = keyMaterial();
  if (!key || !packet?.iv || !packet?.tag || !packet?.data) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(packet.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(packet.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(packet.data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (_) {
    return null;
  }
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function parseCapsule(text) {
  const input = clean(text, 1800);
  const relative = input.match(/^(?:in|after)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\s*(?:(?:send|tell|remind|message)\s+(?:me|yourself)?\s*)?(.*)$/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const multiplier = unit.startsWith("month") ? 30 * 86400000
      : unit.startsWith("week") ? 7 * 86400000
        : unit.startsWith("day") ? 86400000
          : unit.startsWith("hour") || unit.startsWith("hr") ? 3600000
            : 60000;
    return { dueAt: Date.now() + amount * multiplier, message: clean(relative[3] || "", MAX_NOTE_LENGTH) };
  }
  const dated = input.match(/^(?:on|at)\s+(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?)\s*(.*)$/i);
  if (dated) {
    const dueAt = new Date(dated[1].replace(" ", "T")).getTime();
    if (Number.isFinite(dueAt)) return { dueAt, message: clean(dated[2] || "", MAX_NOTE_LENGTH) };
  }
  return null;
}

function searchEcho(query) {
  const needle = clean(query, 180).toLowerCase();
  if (!needle) return [];
  const matches = [];
  for (const chatId of getAllChats()) {
    const history = getMemory(chatId) || [];
    for (const entry of history) {
      const text = typeof entry === "string" ? entry : [entry?.user, entry?.assistant, entry?.text].filter(Boolean).join(" ");
      if (text.toLowerCase().includes(needle)) matches.push({ chatId, text: clean(text, 300) });
    }
  }
  const stores = getAllStores();
  for (const [userId, store] of Object.entries(stores)) {
    for (const memory of store.memories || []) {
      if (String(memory.text || "").toLowerCase().includes(needle)) matches.push({ chatId: userId, text: clean(memory.text, 300) });
    }
  }
  return matches.slice(-40);
}

function graphReport() {
  const stores = getAllStores();
  const lines = ["graph TD", "  ARIA((ARIA))"];
  let index = 0;
  for (const [userId, store] of Object.entries(stores)) {
    const memories = (store.memories || []).slice(-8);
    if (!memories.length) continue;
    const userNode = `u${index++}`;
    lines.push(`  ${userNode}[${userId.replace(/[^a-zA-Z0-9_@.-]/g, "_")}]`);
    lines.push(`  ARIA --> ${userNode}`);
    memories.forEach((memory, memoryIndex) => {
      const node = `m${index++}_${memoryIndex}`;
      const label = clean(memory.text, 70).replace(/[\[\]"']/g, "");
      lines.push(`  ${userNode} --> ${node}[${label || "memory"}]`);
    });
  }
  return lines.join("\n");
}

function profilePacket(userId) {
  const store = getAllStores()[userId] || { memories: [], profile: {} };
  return {
    profile: getProfile(userId),
    memories: (store.memories || []).slice(-100).map((m) => ({ type: m.type, importance: m.importance, text: m.text, ts: m.ts })),
    dreams: state.dreams.filter((d) => d.userId === userId).slice(-100),
    moods: state.moods.filter((m) => m.userId === userId).slice(-180),
    notes: state.notes.filter((n) => n.userId === userId).slice(-100),
  };
}

async function askPrivateAI(userId, instruction, contextLabel) {
  const { getAIResponse } = require("./ai");
  const packet = JSON.stringify(profilePacket(userId));
  const prompt = `${instruction}\n\nPrivate ARIA context (${contextLabel}):\n${packet}\n\nRules: only discuss patterns supported by the supplied data; clearly label uncertainty; do not diagnose medical conditions; do not claim to know private facts that are absent.`;
  return getAIResponse(prompt, "Owner", "", null, "", {
    userContext: "This is a private owner-only ARIA feature. Treat the supplied context as confidential and never reveal it to another user.",
  });
}

function recordMoodSnapshot(userId, mood, tone) {
  if (!isOwner(userId)) return;
  state.moods.push({ userId, mood: clean(mood, 40), tone: clean(tone, 40), ts: Date.now() });
  state.moods = state.moods.slice(-MAX_MOODS);
  persist();
}

function appendObsidian(note) {
  if (!OBSIDIAN_DIR) return false;
  try {
    fs.mkdirSync(OBSIDIAN_DIR, { recursive: true });
    const filename = `${new Date(note.ts).toISOString().replace(/[:.]/g, "-")}-aria-note.md`;
    fs.writeFileSync(path.join(OBSIDIAN_DIR, filename), `# ARIA note\n\n${note.text}\n`, { mode: 0o600 });
    return true;
  } catch (_) { return false; }
}

async function handleAriaLifeFeature(sock, msg, args, ctx) {
  const { reply, react } = require("../utils/baileysHelpers");
  if (!requireOwner(ctx)) return reply(sock, msg, "❌ These personal ARIA features are private and owner-only.");
  const feature = ctx.ariaFeature;
  const input = clean(args, 4000);
  await react(sock, msg, "🧠");

  if (feature === "echolocation") {
    const query = input.replace(/^(?:search|find|echo)\s+(?:all\s+)?(?:my\s+)?(?:past\s+)?(?:conversations?|chats?)?\s*(?:for|about)?\s*/i, "").trim();
    if (!query) return reply(sock, msg, "Usage: ARIA, search all my conversations for <keyword>");
    const hits = searchEcho(query);
    return reply(sock, msg, hits.length ? `📍 *Echo Location: ${query}*\n\n${hits.map((h) => `• ${h.text}`).join("\n")}` : `📍 I found no stored memory containing “${query}”. Note: current chat history keeps the recent local buffer, not an unlimited archive.`);
  }

  if (feature === "timecapsule") {
    if (/^(?:list|show)$/i.test(input)) {
      const list = state.capsules.filter((c) => c.userId === ctx.senderJid && c.active);
      return reply(sock, msg, list.length ? `⏳ *Time Capsules*\n${list.map((c) => `• ${c.id} — ${formatDate(c.dueAt)}`).join("\n")}` : "⏳ You have no active Time Capsules.");
    }
    const cancel = input.match(/^(?:cancel|delete)\s+([a-z0-9-]+)$/i);
    if (cancel) {
      const item = state.capsules.find((c) => c.id === cancel[1] && c.userId === ctx.senderJid && c.active);
      if (!item) return reply(sock, msg, "I couldn't find that active Time Capsule.");
      item.active = false; persist();
      return reply(sock, msg, `✅ Time Capsule ${item.id} cancelled.`);
    }
    const parsed = parseCapsule(input);
    if (!parsed || !parsed.message) return reply(sock, msg, "Usage: ARIA, time capsule in 2 weeks tell me to review the project\nOr: ARIA, time capsule on 2026-09-01 09:00 remind me about the launch");
    if (parsed.dueAt <= Date.now()) return reply(sock, msg, "That delivery time has already passed.");
    const encrypted = encrypt(parsed.message);
    if (!encrypted) return reply(sock, msg, "Time Capsule is not configured yet. Add ARIA_CAPSULE_KEY in Render; do not use a normal password.");
    const id = `capsule-${Date.now().toString(36)}`;
    state.capsules.push({ id, userId: ctx.senderJid, chatId: ctx.chatId, dueAt: parsed.dueAt, ...encrypted, active: true, createdAt: Date.now() });
    persist();
    return reply(sock, msg, `✅ Time Capsule sealed. I’ll deliver it here on *${formatDate(parsed.dueAt)}*. ID: ${id}`);
  }

  if (feature === "mirrorreport") {
    const result = await askPrivateAI(ctx.senderJid, "Write an honest but compassionate personality report from the available memories. Cover communication patterns, recurring values, strengths, possible blind spots, and what the data does not prove.", "Mirror");
    return reply(sock, msg, `🪞 *The Mirror*\n\n${result || "I do not have enough stored material for a responsible report yet."}`);
  }

  if (feature === "memorypalace") {
    return reply(sock, msg, `🏛️ *Memory Palace*\n\nThis is the current private conversation graph. It is based only on stored ARIA memories and recent chat buffers; it is not a complete export.\n\n~~~mermaid\n${graphReport()}\n~~~`);

  }

  if (feature === "secondbrain") {
    const saveMatch = input.match(/^(?:save|note|remember)\s+([\s\S]+)/i);
    if (saveMatch) {
      const note = { id: `note-${Date.now().toString(36)}`, userId: ctx.senderJid, text: clean(saveMatch[1], MAX_NOTE_LENGTH), ts: Date.now() };
      state.notes.push(note); state.notes = state.notes.slice(-MAX_NOTES); persist();
      const written = appendObsidian(note);
      return reply(sock, msg, `🧠 Note saved to ARIA’s private Second Brain${written ? " and Obsidian vault" : ""}.`);
    }
    if (/^(?:list|show)$/i.test(input)) {
      const notes = state.notes.filter((n) => n.userId === ctx.senderJid).slice(-20).reverse();
      return reply(sock, msg, notes.length ? `🧠 *Second Brain*\n${notes.map((n) => `• ${n.id}: ${n.text}`).join("\n")}` : "Your Second Brain is empty. Say: ARIA, save note <text>");
    }
    return reply(sock, msg, "Usage: ARIA, save note <text>\nARIA, show my notes\nOptional Obsidian export: set ARIA_OBSIDIAN_VAULT_DIR in Render.");
  }

  if (feature === "dreamcatcher") {
    const dream = input.replace(/^(?:log|record|save)\s+(?:my\s+)?dream\s*/i, "").trim();
    if (!dream) return reply(sock, msg, "Usage: ARIA, log my dream <what you remember>");
    state.dreams.push({ id: `dream-${Date.now().toString(36)}`, userId: ctx.senderJid, text: clean(dream, MAX_NOTE_LENGTH), ts: Date.now() });
    state.dreams = state.dreams.slice(-MAX_DREAMS); persist();
    return reply(sock, msg, "🌙 Dream recorded privately. I can compare themes after you have more entries.");
  }

  if (feature === "paralleluniverse") {
    const scenario = input.replace(/^(?:what if|imagine|parallel universe|if i)\s*/i, "").trim();
    if (!scenario) return reply(sock, msg, "Usage: ARIA, what if I had chosen <alternative>");
    const result = await askPrivateAI(ctx.senderJid, `Explore this alternate-life scenario: “${scenario}”. Compare likely opportunities, trade-offs, habits required, and uncertainties. Do not present it as a prediction or destiny.`, "Parallel Universe");
    return reply(sock, msg, `🌌 *Parallel Universe*\n\n${result || "I need more personal context before exploring that responsibly."}`);
  }

  if (feature === "soulsearch") {
    const result = await askPrivateAI(ctx.senderJid, "Write a short biography of the owner in a warm literary voice, using only available memories. Separate known facts from interpretation and do not invent dates, achievements, or relationships.", "Soul Search");
    return reply(sock, msg, `📖 *Soul Search*\n\n${result || "I need more memories before I can write a grounded biography."}`);
  }

  if (feature === "emotiontimeline") {
    const moods = state.moods.filter((m) => m.userId === ctx.senderJid).slice(-60);
    if (!moods.length) return reply(sock, msg, "📈 Emotion Timeline has no recorded owner snapshots yet. It will begin learning from future private conversations.");
    const summary = moods.map((m) => `${new Date(m.ts).toLocaleDateString()}: ${m.mood}${m.tone ? ` (${m.tone})` : ""}`).join("\n");
    return reply(sock, msg, `📈 *Emotion Timeline*\n\n${summary}\n\nThis describes logged conversation signals, not a medical or psychological diagnosis.`);
  }

  if (feature === "oracle") {
    const result = await askPrivateAI(ctx.senderJid, "Based on the owner’s recent patterns, offer three cautious next-action hypotheses. Explain the evidence for each and label them as uncertain possibilities, never certainties or supernatural predictions.", "Oracle");
    return reply(sock, msg, `🔮 *The Oracle*\n\n${result || "I do not have enough recent pattern data to make even a cautious hypothesis."}`);
  }

  return reply(sock, msg, "That ARIA life feature is not available yet.");
}

async function deliverCapsules(sock) {
  let changed = false;
  for (const capsule of state.capsules) {
    if (!capsule.active || capsule.dueAt > Date.now()) continue;
    const message = decrypt(capsule);
    capsule.active = false;
    changed = true;
    if (!message) continue;
    try {
      await sock.sendMessage(capsule.chatId, { text: `⏳ *Time Capsule*\n\n${message}` });
    } catch (_) {
      capsule.active = true;
    }
  }
  if (changed) persist();
}

let capsuleSocket = null;
function startTimeCapsulePoller(sock) {
  capsuleSocket = sock || capsuleSocket;
  if (global.__ariaTimeCapsulePoller) return;
  global.__ariaTimeCapsulePoller = setInterval(() => {
    if (capsuleSocket) deliverCapsules(capsuleSocket).catch(() => {});
  }, 15000);
  if (capsuleSocket) deliverCapsules(capsuleSocket).catch(() => {});
}

module.exports = { handleAriaLifeFeature, startTimeCapsulePoller, recordMoodSnapshot, _state: state };
