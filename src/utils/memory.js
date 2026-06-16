// In-memory store per chat ID
// Resets on server restart — good enough for a WhatsApp bot
const memory = new Map();

const MAX_HISTORY = 20; // max messages to keep per chat

function getMemory(chatId) {
  return memory.get(chatId) || [];
}

function saveMemory(chatId, history) {
  // Keep only last MAX_HISTORY messages
  const trimmed = history.slice(-MAX_HISTORY);
  memory.set(chatId, trimmed);
}

function clearMemory(chatId) {
  memory.delete(chatId);
}

function getAllChats() {
  return [...memory.keys()];
}

module.exports = { getMemory, saveMemory, clearMemory, getAllChats };
