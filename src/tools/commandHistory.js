// ── Command History & Undo ──────────────────────────────────────
// Tracks recent command actions per chat so !undo can reverse them.
// In-memory only — history is ephemeral, which is fine for undo.

const history = new Map(); // chatId -> action[]

const MAX_HISTORY = 20;

function trackAction(chatId, action) {
  if (!history.has(chatId)) history.set(chatId, []);
  const actions = history.get(chatId);
  actions.push({ ...action, timestamp: Date.now() });
  if (actions.length > MAX_HISTORY) actions.shift();
}

// Returns the last action for a chat and removes it from history
function popLastAction(chatId) {
  const actions = history.get(chatId);
  if (!actions || actions.length === 0) return null;
  return actions.pop();
}

// Get recent history (for !history command)
function getHistory(chatId, limit = 5) {
  const actions = history.get(chatId);
  if (!actions || actions.length === 0) return [];
  return actions.slice(-limit).reverse();
}

function clearHistory(chatId) {
  history.delete(chatId);
}

module.exports = { trackAction, popLastAction, getHistory, clearHistory };
