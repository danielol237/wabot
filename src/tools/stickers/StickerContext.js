// Context & Mood Analyzer for Sticker Selection
class StickerContext {
  analyzeContext(messageText, options = {}) {
    const text = String(messageText || "").toLowerCase();

    let emotion = "happy";
    let intensity = 0.5;

    if (/\b(?:yay|woohoo|awesome|great|hooray|congrats|party|cheers)\b/i.test(text)) {
      emotion = "celebrating";
      intensity = 0.9;
    } else if (/\b(?:fixed|done|passed|built|success|completed|victory|won)\b/i.test(text)) {
      emotion = "victory";
      intensity = 0.95;
    } else if (/\b(?:proud|accomplished|masterpiece)\b/i.test(text)) {
      emotion = "proud";
      intensity = 0.8;
    } else if (/\b(?:what|huh|confused|why|how|idk)\b/i.test(text)) {
      emotion = "confused";
      intensity = 0.6;
    } else if (/\b(?:facepalm|smh|sigh)\b/i.test(text)) {
      emotion = "facepalm";
      intensity = 0.7;
    } else if (/\b(?:yes|agree|correct|exactly|true)\b/i.test(text)) {
      emotion = "agreement";
      intensity = 0.7;
    }

    return {
      emotion,
      intensity,
      isGroup: Boolean(options.isGroup),
      chatId: options.chatId || null,
    };
  }
}

module.exports = StickerContext;
