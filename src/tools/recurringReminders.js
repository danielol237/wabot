const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/recurring_reminders.json");

// Store of active recurring reminders per chat
// Format: { id, chatId, message, cron, label, task }
const activeRecurring = new Map();

// Load persisted reminders so they survive restarts.
function load() {
  try {
    if (!fs.existsSync(FILE)) return;
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const item of raw || []) {
      if (!item?.id || !item?.cron) continue;
      activeRecurring.set(item.id, { ...item, task: null });
    }
  } catch (err) {
    console.error("Failed to load recurring reminders:", err.message);
  }
}

function save() {
  try {
    const data = [...activeRecurring.values()].map(({ id, chatId, message, cron, label }) => ({
      id, chatId, message, cron, label,
    }));
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save recurring reminders:", err.message);
  }
}

// Parses simple recurring patterns like "every day at 8am", "every monday at 9pm"
function parseRecurringPattern(text) {
  text = text.toLowerCase().trim();

  // "every day at 8am" / "every day at 20:00"
  const dailyMatch = text.match(/every day at (\d{1,2})(:(\d{2}))?\s*(am|pm)?/);
  if (dailyMatch) {
    let hour = parseInt(dailyMatch[1]);
    const minute = dailyMatch[3] ? parseInt(dailyMatch[3]) : 0;
    const meridiem = dailyMatch[4];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { cron: `${minute} ${hour} * * *`, label: `daily at ${dailyMatch[1]}${dailyMatch[3] ? ":" + dailyMatch[3] : ""}${meridiem || ""}` };
  }

  // "every monday at 9pm" etc
  const days = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const weeklyMatch = text.match(/every (sunday|monday|tuesday|wednesday|thursday|friday|saturday) at (\d{1,2})(:(\d{2}))?\s*(am|pm)?/);
  if (weeklyMatch) {
    const dayNum = days[weeklyMatch[1]];
    let hour = parseInt(weeklyMatch[2]);
    const minute = weeklyMatch[4] ? parseInt(weeklyMatch[4]) : 0;
    const meridiem = weeklyMatch[5];
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { cron: `${minute} ${hour} * * ${dayNum}`, label: `every ${weeklyMatch[1]} at ${weeklyMatch[2]}${weeklyMatch[4] ? ":" + weeklyMatch[4] : ""}${meridiem || ""}` };
  }

  return null;
}

function setRecurringReminder(sock, chatId, text) {
  // Strip common openers
  const stripped = text.replace(/^(remind me|set a reminder|every)\s*/i, "every ").trim();
  const parsed = parseRecurringPattern(stripped.startsWith("every") ? stripped : "every " + stripped);

  if (!parsed) {
    return { success: false, message: "❌ Couldn't understand the schedule. Examples:\n• _every day at 8am remind me to take meds_\n• _every monday at 9pm remind me to do laundry_" };
  }

  // Extract the actual reminder message (everything after the time pattern)
  const message = text.replace(/^(remind me|set a reminder)?\s*(every\s+\w+\s+at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)\s*(to|that)?\s*/i, "").trim();

  if (!message) {
    return { success: false, message: "❌ What should the recurring reminder say? Example: _every day at 8am remind me to take meds_" };
  }

  const id = `${chatId}_${Date.now()}`;
  const task = cron.schedule(parsed.cron, async () => {
    try {
      await sock.sendMessage(chatId, { text: `🔁 *Recurring Reminder*\n\n${message}` });
    } catch (err) {
      console.error("Recurring reminder send error:", err.message);
    }
  });

  activeRecurring.set(id, { chatId, message, cron: parsed.cron, label: parsed.label, task });
  save();

  return { success: true, message: `✅ Recurring reminder set!\n📅 ${parsed.label}\n📝 _"${message}"_\n\nID: \`${id}\` (use this to cancel it)` };
}

function cancelRecurringReminder(id) {
  const reminder = activeRecurring.get(id);
  if (!reminder) return false;
  if (reminder.task?.stop) reminder.task.stop();
  activeRecurring.delete(id);
  save();
  return true;
}

function listRecurringReminders(chatId) {
  const list = [];
  for (const [id, r] of activeRecurring.entries()) {
    if (r.chatId === chatId) list.push({ id, label: r.label, message: r.message });
  }
  return list;
}

// Re-arm persisted reminders after a restart.
function rearmAll(sock) {
  for (const reminder of activeRecurring.values()) {
    if (reminder.task?.stop) reminder.task.stop();
    reminder.task = cron.schedule(reminder.cron, async () => {
      try {
        await sock.sendMessage(reminder.chatId, { text: `🔁 *Recurring Reminder*\n\n${reminder.message}` });
      } catch (err) {
        console.error("Recurring reminder send error:", err.message);
      }
    });
  }
}

load();

module.exports = { setRecurringReminder, cancelRecurringReminder, listRecurringReminders, rearmAll };
