// Sticker Pack Store & Metadata Catalog
const fs = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "../../../assets/stickers");

class StickerPackStore {
  constructor() {
    this.packName = "ARIA Official Pack";
    this.author = "ARIA Bot";
    this.stickers = [
      {
        id: "aria_happy_1",
        file: "happy.webp",
        emotion: "happy",
        intensity: 0.8,
        tags: ["smile", "happy", "joy"],
        situations: ["greeting", "success", "praise"],
        reactions: ["😊", "😄"],
      },
      {
        id: "aria_proud_1",
        file: "proud.webp",
        emotion: "proud",
        intensity: 0.9,
        tags: ["verified", "completed", "proud"],
        situations: ["task_completed", "build_passed"],
        reactions: ["⚡", "✅"],
      },
      {
        id: "aria_confused_1",
        file: "confused.webp",
        emotion: "confused",
        intensity: 0.5,
        tags: ["question", "confused", "huh"],
        situations: ["ambiguous_request", "unknown"],
        reactions: ["🤔", "❓"],
      },
      {
        id: "aria_victory_1",
        file: "victory.webp",
        emotion: "victory",
        intensity: 1.0,
        tags: ["win", "victory", "done"],
        situations: ["mission_success", "all_passed"],
        reactions: ["🎉", "🏆"],
      },
    ];
  }

  getPackMetadata() {
    return {
      packName: this.packName,
      author: this.author,
      totalStickers: this.stickers.length,
    };
  }

  getStickersByEmotion(emotion) {
    return this.stickers.filter((s) => s.emotion === emotion);
  }
}

module.exports = StickerPackStore;
