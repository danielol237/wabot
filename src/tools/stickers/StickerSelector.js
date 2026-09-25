// Emotion & Cooldown-Aware Sticker Selector
const StickerRegistry = require("./StickerRegistry");
const StickerContext = require("./StickerContext");

const COOLDOWN_MS = 30 * 1000; // 30 seconds per chat

class StickerSelector {
  constructor() {
    this.registry = new StickerRegistry();
    this.contextAnalyzer = new StickerContext();
    this.lastUsedByChat = new Map();
  }

  canSendSticker(chatId) {
    if (!chatId) return true;
    const last = this.lastUsedByChat.get(chatId);
    if (last && Date.now() - last < COOLDOWN_MS) {
      return false;
    }
    return true;
  }

  selectSticker(messageText, options = {}) {
    const chatId = options.chatId;
    if (chatId && !options.ignoreCooldown && !this.canSendSticker(chatId)) {
      return null;
    }

    const ctx = this.contextAnalyzer.analyzeContext(messageText, options);
    const candidates = this.registry.getStickers(ctx.emotion);
    if (!candidates || candidates.length === 0) return null;

    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    if (chatId) {
      this.lastUsedByChat.set(chatId, Date.now());
    }

    return {
      sticker: selected,
      context: ctx,
    };
  }
}

module.exports = StickerSelector;
