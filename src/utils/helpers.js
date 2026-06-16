// React to a message with an emoji
async function react(msg, emoji) {
  try {
    await msg.react(emoji);
  } catch (_) {
    // Reactions may not be supported in all chat types, ignore
  }
}

// Reply to a message (splits long messages)
async function reply(msg, text) {
  try {
    if (!text) return;

    // WhatsApp has a ~65,000 char limit but practically keep it under 4000
    if (text.length <= 4000) {
      return await msg.reply(text);
    }

    // Split long messages
    const chunks = splitMessage(text, 3900);
    for (const chunk of chunks) {
      await msg.reply(chunk);
      await sleep(500);
    }
  } catch (err) {
    console.error("Reply error:", err.message);
  }
}

// Send an image by URL
async function sendImage(client, chatId, url, caption = "") {
  try {
    const { MessageMedia } = require("whatsapp-web.js");
    const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
    await client.sendMessage(chatId, media, { caption });
  } catch (err) {
    console.error("Send image error:", err.message);
  }
}

function splitMessage(text, maxLen) {
  const chunks = [];
  let current = "";
  const lines = text.split("\n");

  for (const line of lines) {
    if ((current + "\n" + line).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

module.exports = { react, reply, sendImage, sleep };
