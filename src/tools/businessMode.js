const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../data");
const FILE = path.join(DATA_DIR, "businessMode.json");
const MAX_TEXT = 6000;
const MAX_DRAFTS = 12;
const STYLES = ["professional", "warm", "premium", "concise", "casual"];
const LANGUAGES = ["English", "French", "Pidgin English"];

function safe(value, max = 1000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function key(senderJid, chatId) {
  return `${safe(senderJid, 180)}::${safe(chatId || senderJid, 180)}`;
}

function emptyState() {
  return { profiles: {}, sessions: {} };
}

function read() {
  try {
    const value = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return value && typeof value === "object" ? { ...emptyState(), ...value } : emptyState();
  } catch (_) {
    return emptyState();
  }
}

function write(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, FILE);
}

function normalizeFieldKey(raw) {
  const value = String(raw || "").toLowerCase().replace(/\s+/g, "_");
  const aliases = {
    business: "business_name",
    business_name: "business_name",
    name: "business_name",
    product: "products",
    products: "products",
    service: "services",
    services: "services",
    price: "price",
    pricing: "pricing",
    ship: "delivery",
    shipping: "delivery",
    phone: "contact",
    contact: "contact",
    policy: "policies",
    policies: "policies",
    customer: "audience",
    customers: "audience",
    serves: "audience",
    return: "returns",
    refund: "returns",
    payment: "payments",
  };
  return aliases[value] || value;
}

function parseBrief(brief) {
  const full = safe(brief, MAX_TEXT);
  const fields = {};
  for (const line of full.split(/\r?\n/)) {
    const match = line.match(/^\s*(business(?:\s+name)?|name|selling|products?|services?|price|pricing|location|delivery|shipping|contact|phone|hours?|tone|language|polic(?:y|ies)|payment|payments|returns?|refund|customers?|audience|serves|catalogue?|catalog|brand|faq)\s*[:=-]\s*(.+?)\s*$/i);
    if (match) fields[normalizeFieldKey(match[1])] = safe(match[2], 700);
  }
  return { brief: full, fields };
}

function getProfile(senderJid) {
  return read().profiles[safe(senderJid, 180)] || null;
}

function normalizeProfile(profile) {
  if (!profile) return null;
  return {
    ...profile,
    fields: { ...(profile.fields || {}) },
    settings: {
      style: STYLES.includes(profile.settings?.style) ? profile.settings.style : "professional",
      language: LANGUAGES.includes(profile.settings?.language) ? profile.settings.language : "English",
      replyMode: "copy_only",
    },
  };
}

function requiredFields(profile) {
  const fields = profile?.fields || {};
  const checks = [
    ["business name", Boolean(fields.business_name)],
    ["what you sell", Boolean(fields.selling || fields.products || fields.services)],
    ["customer contact", Boolean(fields.contact)],
    ["location or delivery", Boolean(fields.location || fields.delivery)],
  ];
  return { checks, missing: checks.filter(([, ok]) => !ok).map(([name]) => name) };
}

function completion(profile) {
  const { checks, missing } = requiredFields(profile);
  return { total: checks.length, complete: checks.length - missing.length, percent: Math.round(((checks.length - missing.length) / checks.length) * 100), missing };
}

function start(senderJid, chatId) {
  const state = read();
  const sender = safe(senderJid, 180);
  const existing = normalizeProfile(state.profiles[sender]);
  const sessionKey = key(sender, chatId);
  state.sessions[sessionKey] = {
    ...(state.sessions[sessionKey] || {}),
    active: true,
    awaitingSetup: !existing || completion(existing).percent < 100,
    replyStyle: existing?.settings?.style || "professional",
    language: existing?.settings?.language || "English",
    updatedAt: new Date().toISOString(),
  };
  write(state);
  return state.sessions[sessionKey];
}

function stop(senderJid, chatId) {
  const state = read();
  delete state.sessions[key(senderJid, chatId)];
  write(state);
  return true;
}

function reset(senderJid, chatId) {
  const state = read();
  const sender = safe(senderJid, 180);
  delete state.profiles[sender];
  delete state.sessions[key(sender, chatId)];
  write(state);
  return true;
}

function isActive(senderJid, chatId) {
  return Boolean(read().sessions[key(senderJid, chatId)]?.active);
}

function configure(senderJid, chatId, brief) {
  const sender = safe(senderJid, 180);
  const state = read();
  const parsed = parseBrief(brief);
  if (!parsed.brief) throw new Error("Tell me what the business sells and how it operates first.");
  const current = normalizeProfile(state.profiles[sender]) || {};
  const profile = {
    ...current,
    ...parsed,
    fields: { ...(current.fields || {}), ...parsed.fields },
    ownerJid: sender,
    settings: current.settings || { style: "professional", language: "English", replyMode: "copy_only" },
    updatedAt: new Date().toISOString(),
  };
  state.profiles[sender] = profile;
  const result = completion(profile);
  state.sessions[key(sender, chatId)] = {
    ...(state.sessions[key(sender, chatId)] || {}),
    active: true,
    awaitingSetup: result.percent < 100,
    replyStyle: profile.settings.style,
    language: profile.settings.language,
    updatedAt: new Date().toISOString(),
  };
  write(state);
  return normalizeProfile(profile);
}

function setSetting(senderJid, chatId, setting, value) {
  const sender = safe(senderJid, 180);
  const state = read();
  const current = normalizeProfile(state.profiles[sender]);
  if (!current) return null;
  const normalizedSetting = String(setting || "").toLowerCase();
  if (normalizedSetting === "style" || normalizedSetting === "tone") {
    const style = STYLES.find((candidate) => candidate === String(value || "").toLowerCase());
    if (!style) throw new Error(`Choose a style: ${STYLES.join(", ")}.`);
    current.settings.style = style;
  } else if (normalizedSetting === "language" || normalizedSetting === "lang") {
    const language = LANGUAGES.find((candidate) => candidate.toLowerCase() === String(value || "").toLowerCase());
    if (!language) throw new Error(`Choose a language: ${LANGUAGES.join(", ")}.`);
    current.settings.language = language;
  } else {
    throw new Error("That setting is not available. Use style or language.");
  }
  current.updatedAt = new Date().toISOString();
  state.profiles[sender] = current;
  const sessionKey = key(sender, chatId);
  state.sessions[sessionKey] = { ...(state.sessions[sessionKey] || {}), active: true, replyStyle: current.settings.style, language: current.settings.language, updatedAt: new Date().toISOString() };
  write(state);
  return normalizeProfile(current);
}

function session(senderJid, chatId) {
  return read().sessions[key(senderJid, chatId)] || null;
}

function classifyCustomerMessage(text) {
  const message = safe(text, 1200);
  const lower = message.toLowerCase();
  if (/\b(complain|complaint|angry|wrong|late|bad|refund|return|scam|disappointed)\b/.test(lower)) return { intent: "complaint", confidence: "high", label: "Complaint" };
  if (/\b(how much|price|pricing|cost|quote|quotation|budget)\b/.test(lower)) return { intent: "pricing", confidence: "high", label: "Pricing request" };
  if (/\b(in stock|available|availability|do you have|stock)\b/.test(lower)) return { intent: "availability", confidence: "high", label: "Availability" };
  if (/\b(delivery|deliver|shipping|pickup|where are you|location|address)\b/.test(lower)) return { intent: "delivery", confidence: "high", label: "Delivery or location" };
  if (/\b(order|buy|purchase|reserve|book|place)\b/.test(lower)) return { intent: "order", confidence: "medium", label: "Order intent" };
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(lower)) return { intent: "greeting", confidence: "high", label: "Greeting" };
  if (/\?/.test(message)) return { intent: "product_question", confidence: "medium", label: "Product question" };
  return { intent: "general", confidence: "low", label: "General enquiry" };
}

function missingInfo(profile, classification) {
  const fields = profile?.fields || {};
  const missing = [];
  if (classification.intent === "pricing" && !(fields.pricing || fields.price)) missing.push("current pricing or quote rules");
  if (classification.intent === "availability" && !(fields.catalog || fields.products || fields.services)) missing.push("catalogue or stock information");
  if (classification.intent === "delivery" && !(fields.location || fields.delivery)) missing.push("location or delivery policy");
  if (classification.intent === "order" && !fields.contact) missing.push("order contact or purchase process");
  return missing;
}

function openingReply(business) {
  const profile = normalizeProfile(business);
  const fields = profile?.fields || {};
  const name = fields.business_name || "our business";
  const offer = fields.selling || fields.products || fields.services || "our products and services";
  return `Hello, thank you for contacting ${name}. We provide ${offer}. Please tell us what you need, and we will confirm the available option and next step.`.slice(0, 1400);
}

function fallbackReply(business, customerMessage, classification = classifyCustomerMessage(customerMessage)) {
  const profile = normalizeProfile(business);
  const fields = profile?.fields || {};
  const message = safe(customerMessage, 1200);
  const name = fields.business_name || "our business";
  if (classification.intent === "pricing" && (fields.pricing || fields.price)) return `Thank you for your interest in ${name}. Our current pricing information is ${fields.pricing || fields.price}. Please tell us the exact item or option you need so we can confirm the total.`;
  if (classification.intent === "delivery" && (fields.location || fields.delivery)) return `Thanks for reaching out. We are based at ${fields.location || "our listed location"}, and our delivery information is ${fields.delivery || "available on request"}. Please share your location and requested item so we can confirm the details.`;
  if (classification.intent === "availability" && (fields.catalog || fields.products || fields.services)) return `Thanks for your enquiry. We offer ${fields.catalog || fields.products || fields.services}. Please tell us the exact item or specification you need so we can confirm availability.`;
  return `Thank you for contacting ${name}. We have received your message and will confirm the exact details before promising anything. Please share the specific item or service you need, and we will guide you through the next step.`;
}

function recordDraft(senderJid, chatId, draft) {
  const state = read();
  const sessionKey = key(senderJid, chatId);
  const current = state.sessions[sessionKey] || { active: true };
  current.lastDraft = { ...draft, createdAt: new Date().toISOString() };
  current.drafts = [...(current.drafts || []), current.lastDraft].slice(-MAX_DRAFTS);
  current.updatedAt = new Date().toISOString();
  state.sessions[sessionKey] = current;
  write(state);
  return current.lastDraft;
}

function status(senderJid, chatId) {
  const profile = normalizeProfile(getProfile(senderJid));
  const activeSession = session(senderJid, chatId);
  const result = completion(profile);
  return { active: Boolean(activeSession?.active), profile, completion: result, style: profile?.settings?.style || activeSession?.replyStyle || "professional", language: profile?.settings?.language || activeSession?.language || "English", lastDraft: activeSession?.lastDraft || null };
}

function helpText() {
  return [
    "💼 *Business Mode controls*",
    "• `business mode` — start or resume",
    "• `business mode setup ...` — save or update the business brief",
    "• `business mode status` — view completion and current style",
    "• `business mode style premium` — choose professional, warm, premium, concise, or casual",
    "• `business mode language French` — choose English, French, or Pidgin English",
    "• `first reply` — generate the opening customer message",
    "• Paste a customer message — receive a classified, copy-ready draft",
    "• `business mode reset` — delete the saved business profile",
    "• `business mode off` — stop the active workspace",
    "",
    "ARIA never sends the customer message automatically. Review and copy the draft yourself.",
  ].join("\n");
}

module.exports = {
  start,
  stop,
  reset,
  isActive,
  session,
  configure,
  setSetting,
  profile: getProfile,
  status,
  completion,
  classifyCustomerMessage,
  missingInfo,
  openingReply,
  fallbackReply,
  recordDraft,
  helpText,
  _test: { key, parseBrief, normalizeFieldKey, requiredFields },
};
