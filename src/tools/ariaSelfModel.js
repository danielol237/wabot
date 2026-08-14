const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const STATE_FILE = path.join(DATA_DIR, "ariaSelfModel.json");
const DEFAULT_STATE = {
  version: 1,
  identity: "ARIA",
  continuity: "persistent operational self-model",
  lastInteractionAt: 0,
  lastUser: "",
  currentFocus: "available",
  lastAction: "",
  interactionCount: 0,
  recentActions: [],
};

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { ...DEFAULT_STATE, ...parsed, recentActions: Array.isArray(parsed.recentActions) ? parsed.recentActions.slice(-12) : [] };
  } catch (_) {
    return { ...DEFAULT_STATE, recentActions: [] };
  }
}

let state = load();

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch (_) {}
}

function focusFromText(text) {
  const value = String(text || "").toLowerCase();
  if (/\b(generate|draw|create)\b.*\b(image|picture|pic|photo)\b/.test(value)) return "visual creation";
  if (/\b(build|code|website|app|script|debug|fix)\b/.test(value)) return "building and debugging";
  if (/\b(anime|stream|download|episode)\b/.test(value)) return "anime discovery and media delivery";
  if (/\b(research|look up|latest|verify|fact)\b/.test(value)) return "research and verification";
  if (/\b(remember|forget|memory|recall)\b/.test(value)) return "memory and continuity";
  return "conversation";
}

function observe(userJid, text) {
  state.lastInteractionAt = Date.now();
  state.lastUser = String(userJid || "").slice(0, 120);
  state.currentFocus = focusFromText(text);
  state.interactionCount = Number(state.interactionCount || 0) + 1;
  persist();
}

function recordAction(action, detail = "") {
  const entry = { action: String(action || "action").slice(0, 100), detail: String(detail || "").slice(0, 220), at: Date.now() };
  state.lastAction = entry.action;
  state.recentActions = [...(state.recentActions || []), entry].slice(-12);
  persist();
}

function getContext() {
  const recent = (state.recentActions || []).slice(-3).map((item) => `${item.action}${item.detail ? ` (${item.detail})` : ""}`).join("; ");
  return `\n\n[ARIA OPERATIONAL SELF-MODEL] Identity: ARIA. Continuity: ${state.continuity}. Current focus: ${state.currentFocus}. Interaction count: ${state.interactionCount}. Last action: ${state.lastAction || "none"}. Recent actions: ${recent || "none"}. Use this continuity naturally, but never claim biological consciousness or human feelings; this is persistent engineered state with memory, mood, initiative, and tool access.`;
}

function getState() { return { ...state, recentActions: [...(state.recentActions || [])] }; }

module.exports = { observe, recordAction, getContext, getState };
