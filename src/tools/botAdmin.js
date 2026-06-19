const { getAllChats, getMemory } = require("../utils/memory");

const startTime = Date.now();
const recentErrors = [];
const MAX_ERRORS_STORED = 20;

// Call this from anywhere errors are caught, to build up a debug log the owner can check
function logError(context, errorMessage) {
  recentErrors.push({ time: new Date().toISOString(), context, error: errorMessage });
  if (recentErrors.length > MAX_ERRORS_STORED) recentErrors.shift();
}

function getUptime() {
  const ms = Date.now() - startTime;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function getStats() {
  const chats = getAllChats();
  const totalMessages = chats.reduce((sum, chatId) => sum + getMemory(chatId).length, 0);
  const mem = process.memoryUsage();

  return {
    uptime: getUptime(),
    totalChats: chats.length,
    totalStoredMessages: totalMessages,
    ramUsedMB: (mem.rss / 1024 / 1024).toFixed(1),
    nodeVersion: process.version,
  };
}

function getRecentErrors(count = 5) {
  return recentErrors.slice(-count);
}

async function broadcastToAll(sock, message) {
  const chats = getAllChats();
  let sent = 0;
  let failed = 0;

  for (const chatId of chats) {
    try {
      await sock.sendMessage(chatId, { text: `📢 *Broadcast:*\n\n${message}` });
      sent++;
      // Small delay to avoid hammering WhatsApp's rate limits
      await new Promise((res) => setTimeout(res, 800));
    } catch (err) {
      failed++;
    }
  }

  return { sent, failed, total: chats.length };
}

module.exports = { getStats, getRecentErrors, logError, broadcastToAll };
