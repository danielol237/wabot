// WhatsApp Sticker Sender Bridge
const { createSticker } = require("../sticker");

class StickerSender {
  static async sendSticker(sock, chatId, imageBuffer) {
    if (!sock || !chatId || !imageBuffer) return false;
    try {
      const res = await createSticker(imageBuffer, { mimetype: "image/png" });
      if (res.success && res.buffer) {
        await sock.sendMessage(chatId, { sticker: res.buffer });
        return true;
      }
    } catch (_) {}
    return false;
  }
}

module.exports = StickerSender;
