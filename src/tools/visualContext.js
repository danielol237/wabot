const MAX_AGE_MS = 10 * 60 * 1000;
const recent = new Map();

function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [chatId, value] of recent) if (!value || value.at < cutoff) recent.delete(chatId);
}

function remember(chatId, visual) {
  if (!chatId || !visual?.base64 || !visual?.mimeType) return;
  prune();
  recent.set(String(chatId), {
    base64: String(visual.base64),
    mimeType: String(visual.mimeType),
    kind: visual.kind === "sticker" ? "sticker" : "image",
    at: Date.now(),
  });
}

function get(chatId) {
  prune();
  const value = recent.get(String(chatId));
  return value ? { ...value } : null;
}

function clear(chatId) {
  recent.delete(String(chatId));
}

module.exports = { remember, get, clear, _test: { MAX_AGE_MS, recent } };
