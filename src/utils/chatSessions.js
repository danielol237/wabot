// Tracks which chats currently have "session mode" active — once enabled with !chat,
// every message in that chat goes straight to the AI without needing the bot's name
// or a command prefix, until !exit is sent or the session times out from inactivity.

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes, per ChatGPT's suggestion

const activeSessions = new Map(); // chatId -> { startedAt, lastActivity }

function startSession(chatId) {
  activeSessions.set(chatId, { startedAt: Date.now(), lastActivity: Date.now() });
}

function endSession(chatId) {
  activeSessions.delete(chatId);
}

function isSessionActive(chatId) {
  const session = activeSessions.get(chatId);
  if (!session) return false;

  if (Date.now() - session.lastActivity > SESSION_TIMEOUT_MS) {
    activeSessions.delete(chatId);
    return false;
  }
  return true;
}

function touchSession(chatId) {
  const session = activeSessions.get(chatId);
  if (session) session.lastActivity = Date.now();
}

module.exports = { startSession, endSession, isSessionActive, touchSession };
