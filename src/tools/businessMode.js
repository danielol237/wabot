const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "businessMode.json");
const MAX_TEXT = 6000;

function safe(value, max = 1000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function key(ownerJid, chatId) {
  return `${safe(ownerJid, 180)}::${safe(chatId || ownerJid, 180)}`;
}

function read() {
  try {
    const value = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return value && typeof value === "object" ? value : { profiles: {}, sessions: {} };
  } catch (_) {
    return { profiles: {}, sessions: {} };
  }
}

function write(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, FILE);
}

function parseBrief(brief) {
  const full = safe(brief, MAX_TEXT);
  const fields = {};
  for (const line of full.split(/\r?\n/)) {
    const match = line.match(/^\s*(business(?:\s+name)?|name|selling|products?|services?|price|pricing|location|delivery|shipping|contact|phone|hours?|tone|language|polic(?:y|ies))\s*[:=-]\s*(.+?)\s*$/i);
    if (match) fields[match[1].toLowerCase().replace(/\s+/g, "_")] = safe(match[2], 500);
  }
  return { brief: full, fields };
}

function profile(ownerJid) {
  return read().profiles[safe(ownerJid, 180)] || null;
}

function start(ownerJid, chatId) {
  const state = read();
  const sessionKey = key(ownerJid, chatId);
  state.sessions[sessionKey] = { active: true, awaitingSetup: !state.profiles[safe(ownerJid, 180)], updatedAt: new Date().toISOString() };
  write(state);
  return state.sessions[sessionKey];
}

function stop(ownerJid, chatId) {
  const state = read();
  delete state.sessions[key(ownerJid, chatId)];
  write(state);
  return true;
}

function isActive(ownerJid, chatId) {
  return Boolean(read().sessions[key(ownerJid, chatId)]?.active);
}

function configure(ownerJid, chatId, brief) {
  const owner = safe(ownerJid, 180);
  const state = read();
  const parsed = parseBrief(brief);
  if (!parsed.brief) throw new Error("Tell me what the business sells and how it operates first.");
  const current = state.profiles[owner] || {};
  state.profiles[owner] = { ...current, ...parsed, ownerJid: owner, updatedAt: new Date().toISOString() };
  state.sessions[key(owner, chatId)] = { active: true, awaitingSetup: false, updatedAt: new Date().toISOString() };
  write(state);
  return state.profiles[owner];
}

function session(ownerJid, chatId) {
  return read().sessions[key(ownerJid, chatId)] || null;
}

function openingReply(business) {
  const fields = business?.fields || {};
  const name = fields.business_name || fields.name || "our business";
  const offer = fields.selling || fields.products || fields.services || business?.brief || "our products and services";
  return `Hello, thank you for contacting ${name}. We offer ${offer}. Please tell me what you are looking for, and I will help with the available options and next steps.`.slice(0, 1400);
}

function fallbackReply(business, customerMessage) {
  const fields = business?.fields || {};
  const message = safe(customerMessage, 1200);
  const name = fields.business_name || fields.name || "our business";
  if (/\b(price|cost|how much|pricing)\b/i.test(message) && (fields.price || fields.pricing)) return `Thank you for your interest in ${name}. Our current pricing is ${fields.price || fields.pricing}. If you tell me the exact option you want, I can help confirm the total.`;
  if (/\b(where|location|located|address)\b/i.test(message) && fields.location) return `Thanks for reaching out. We are located at ${fields.location}. Please tell me when you would like to visit so I can confirm the best next step.`;
  if (/\b(delivery|shipping|deliver)\b/i.test(message) && (fields.delivery || fields.shipping)) return `Yes, we can help with delivery. Our current delivery information is ${fields.delivery || fields.shipping}. Please share your location and requested item so I can confirm the details.`;
  return `Thank you for contacting ${name}. I have received your message and will confirm the exact details before promising anything. Based on our business information: ${safe(business?.brief, 700)}`;
}

module.exports = { start, stop, isActive, session, configure, profile, openingReply, fallbackReply, _test: { key, parseBrief } };
