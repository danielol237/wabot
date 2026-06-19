function parseTime(text) {
  text = text.toLowerCase();
  let totalMs = 0;

  const hours   = text.match(/(\d+)\s*h(our)?s?/);
  const minutes = text.match(/(\d+)\s*m(in(ute)?s?)?/);
  const seconds = text.match(/(\d+)\s*s(ec(ond)?s?)?/);

  if (hours)   totalMs += parseInt(hours[1])   * 60 * 60 * 1000;
  if (minutes) totalMs += parseInt(minutes[1]) * 60 * 1000;
  if (seconds) totalMs += parseInt(seconds[1]) * 1000;

  return totalMs;
}

// Extract the reminder message from natural language
// "remind me in 10m to take my meds" → { ms: 600000, message: "take my meds" }
// "remind me 2h call dad"            → { ms: 7200000, message: "call dad" }
// "10m take meds" (prefix style)     → { ms: 600000, message: "take meds" }
function parseReminder(text) {
  text = text.trim();

  // Strip common natural language openers
  text = text.replace(/^(remind me\s*(in|after|to)?|set (a )?reminder (for|in|to)?|alert me (in|after)?|notify me (in|after)?)\s*/i, "");

  // Now text is like "10m to take my meds" or "2h call dad" or "in 10 minutes take meds"
  text = text.replace(/^in\s+/i, ""); // strip leading "in"

  // Find the time part
  const timeMatch = text.match(/^(\d+\s*(h(our)?s?|m(in(ute)?s?)?|s(ec(ond)?s?)?)(\s*\d+\s*(h(our)?s?|m(in(ute)?s?)?|s(ec(ond)?s?)?))*)/i);

  if (!timeMatch) return null;

  const timeStr = timeMatch[0];
  const ms = parseTime(timeStr);
  if (!ms) return null;

  // Everything after the time + optional "to" is the message
  let message = text.slice(timeStr.length).replace(/^\s*(to|for|about)?\s*/i, "").trim();

  return { ms, message };
}

async function setReminder(sock, chatId, text) {
  const parsed = parseReminder(text);

  if (!parsed) {
    return "❌ Couldn't understand that. Examples:\n• _remind me in 10m to call dad_\n• _remind me 2h take meds_\n• _!remind 30m check oven_";
  }

  const { ms, message } = parsed;

  if (!message) {
    return "❌ What should I remind you about? Example: _remind me in 10m to call dad_";
  }

  if (ms > 24 * 60 * 60 * 1000) {
    return "❌ Max reminder time is 24 hours.";
  }

  const timeLabel = formatDuration(ms);

  setTimeout(async () => {
    try {
      await sock.sendMessage(chatId, { text: `⏰ *Reminder!*\n\n${message}` });
    } catch (err) {
      console.error("Reminder send error:", err.message);
    }
  }, ms);

  return `✅ Got it! I'll remind you in *${timeLabel}*\n📝 _"${message}"_`;
}

function formatDuration(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(" ");
}

module.exports = { setReminder };
