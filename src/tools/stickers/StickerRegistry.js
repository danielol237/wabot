// Emotion-Aware Sticker Registry
const StickerPackStore = require("./StickerPackStore");

class StickerRegistry {
  constructor() {
    this.store = new StickerPackStore();
    this.categories = new Set([
      "happy", "laughing", "excited", "proud", "smug", "confused",
      "surprised", "shocked", "angry", "annoyed", "sad", "crying",
      "tired", "embarrassed", "affectionate", "teasing", "celebrating",
      "facepalm", "dead_inside", "suspicious", "chaotic", "victory",
      "agreement", "disagreement",
    ]);
  }

  isValidCategory(category) {
    return this.categories.has(String(category || "").toLowerCase());
  }

  getStickers(emotion) {
    if (!this.isValidCategory(emotion)) return this.store.stickers;
    const list = this.store.getStickersByEmotion(emotion);
    return list.length > 0 ? list : this.store.stickers;
  }
}

module.exports = StickerRegistry;
