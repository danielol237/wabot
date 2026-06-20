// Tracks message IDs that ARIA itself sent, so we can reliably detect when someone
// replies to one of its messages — far more robust than trying to parse WhatsApp's
// quoted-message participant/JID fields, which vary across DMs, groups, and Baileys
// versions and were the source of three failed attempts at this before switching approach.
//
// In-memory only (Set), capped in size — this only needs to cover "recent" bot messages,
// not a permanent log. If the bot restarts, old message IDs are forgotten, which is fine:
// a reply chain that started before a restart just falls back to needing the name/prefix again.

const MAX_TRACKED = 500;
const sentMessageIds = new Set();
const idOrder = []; // tracks insertion order so we can evict the oldest when over the cap

function trackSentMessage(messageId) {
  if (!messageId) return;
  sentMessageIds.add(messageId);
  idOrder.push(messageId);
  if (idOrder.length > MAX_TRACKED) {
    const oldest = idOrder.shift();
    sentMessageIds.delete(oldest);
  }
}

function wasSentByBot(messageId) {
  if (!messageId) return false;
  return sentMessageIds.has(messageId);
}

module.exports = { trackSentMessage, wasSentByBot };
