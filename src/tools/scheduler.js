// ── Scheduled Messages ──────────────────────────────────────────
// Uses node-cron to send messages at specified times.
// Format: !schedule "message" at <date and time>

const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const FILE = path.join(__dirname, "../../data/schedules.json");
// { id, chatId, message, timeStr, parsed, createdAt, creator }
const scheduled = new Map();
let sockRef = null;

// Load persisted schedules from disk so scheduled messages survive restarts.
function load() {
  try {
    if (!fs.existsSync(FILE)) return;
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const item of raw || []) {
      if (!item?.id || !item?.parsed) continue;
      scheduled.set(item.id, item);
    }
  } catch (err) {
    console.error("Failed to load schedules:", err.message);
  }
}

function save() {
  try {
    const data = [...scheduled.values()].map(({ id, chatId, message, timeStr, parsed, creator, createdAt }) => ({
      id, chatId, message, timeStr, parsed, creator, createdAt,
    }));
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save schedules:", err.message);
  }
}

function setSock(sock) {
  sockRef = sock;
}

// Parse natural language time into a cron expression
// Supports: "every day at 09:00", "Dec 25 09:00", "every monday at 10:30"
function parseTimeToCron(timeStr) {
  const lower = timeStr.toLowerCase();

  // "every X seconds/minutes/hours" — interval mode
  const intervalMatch = lower.match(/every (\d+) (second|minute|hour|day)s?/);
  if (intervalMatch) {
    const num = parseInt(intervalMatch[1]);
    const unit = intervalMatch[2];
    const multipliers = { second: 1, minute: 60, hour: 3600, day: 86400 };
    const seconds = num * (multipliers[unit] || 60);
    // Use node-cron for intervals: */N * * * * *
    if (unit === "second" || seconds < 60) {
      return { type: "interval", seconds };
    }
    if (unit === "minute") {
      return { type: "cron", expr: `*/${num} * * * *` };
    }
    if (unit === "hour") {
      return { type: "cron", expr: `0 */${num} * * *` };
    }
    if (unit === "day") {
      return { type: "cron", expr: `0 0 */${num} * *` };
    }
  }

  // "every day at HH:MM"
  const everyDayMatch = lower.match(/every day at (\d{1,2}):(\d{2})/);
  if (everyDayMatch) {
    return { type: "cron", expr: `${everyDayMatch[2]} ${everyDayMatch[1]} * * *` };
  }

  // "every monday/tuesday/etc at HH:MM"
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < dayNames.length; i++) {
    const match = lower.match(new RegExp(`every ${dayNames[i]} at (\\d{1,2}):(\\d{2})`));
    if (match) {
      return { type: "cron", expr: `${match[2]} ${match[1]} * * ${i}` };
    }
  }

  // Try parsing as a specific date: "Dec 25 09:00" or "2026-12-25 09:00"
  const dateMatch = lower.match(/([a-z]{3,9})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})/i);
  if (dateMatch) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIdx = months.findIndex((m) => dateMatch[1].toLowerCase().startsWith(m));
    if (monthIdx >= 0) {
      const day = parseInt(dateMatch[2]);
      const hour = parseInt(dateMatch[3]);
      const min = parseInt(dateMatch[4]);
      return { type: "once", at: { month: monthIdx + 1, day, hour, min } };
    }
  }

  // ISO date: "2026-12-25 09:00"
  const isoMatch = lower.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (isoMatch) {
    return { type: "once", at: { month: parseInt(isoMatch[2]), day: parseInt(isoMatch[3]), hour: parseInt(isoMatch[4]), min: parseInt(isoMatch[5]) } };
  }

  return null;
}

function scheduleMessage(chatId, message, timeStr, creator) {
  const parsed = parseTimeToCron(timeStr);
  if (!parsed) return { success: false, error: "Couldn't understand the time. Try: `every day at 09:00`, `Dec 25 09:00`, or `every 30 minutes`." };

  const id = uuidv4().slice(0, 8);
  let task = null;

  if (parsed.type === "cron") {
    if (!cron.validate(parsed.expr)) return { success: false, error: "Invalid time expression." };
    task = cron.schedule(parsed.expr, async () => {
      try {
        if (sockRef) await sockRef.sendMessage(chatId, { text: `⏰ ${message}` });
      } catch (err) { console.error("Scheduled message error:", err.message); }
    });
  } else if (parsed.type === "once") {
    const now = new Date();
    const target = new Date(now.getFullYear(), parsed.at.month - 1, parsed.at.day, parsed.at.hour, parsed.at.min, 0);
    if (target <= now) target.setFullYear(target.getFullYear() + 1);

    const msUntil = target.getTime() - now.getTime();
    const timeout = setTimeout(async () => {
      try {
        if (sockRef) await sockRef.sendMessage(chatId, { text: `⏰ ${message}` });
      } catch (err) { console.error("Scheduled message error:", err.message); }
      scheduled.delete(id);
    }, msUntil);

    task = { timeout, date: target };
  } else if (parsed.type === "interval") {
    const interval = setInterval(async () => {
      try {
        if (sockRef) await sockRef.sendMessage(chatId, { text: `⏰ ${message}` });
      } catch (err) { console.error("Scheduled message error:", err.message); }
    }, parsed.seconds * 1000);
    task = { interval };
  }

  scheduled.set(id, { id, chatId, message, timeStr, parsed, task, creator, createdAt: Date.now() });
  save();

  return { success: true, id, schedule: parsed };
}

function cancelSchedule(id, userId) {
  const item = scheduled.get(id);
  if (!item) return { success: false, error: "Schedule not found." };
  if (item.creator !== userId) return { success: false, error: "Only the creator can cancel." };

  if (item.task) {
    if (item.task.timeout) clearTimeout(item.task.timeout);
    if (item.task.interval) clearInterval(item.task.interval);
    if (item.task.stop) item.task.stop(); // cron task
  }
  scheduled.delete(id);
  save();
  return { success: true };
}

function listSchedules(chatId) {
  return [...scheduled.values()].filter((s) => s.chatId === chatId);
}

function formatSchedules(schedules) {
  if (schedules.length === 0) return "No scheduled messages in this chat.";
  return schedules.map((s) => `• \`${s.id}\` — "${s.message.slice(0, 40)}" — ${s.timeStr}`).join("\\n");
}

// Re-arm any persisted cron/interval schedules after a restart. One-time
// (absolute date) schedules are re-created if their target is still in the future.
function rearmAll() {
  for (const item of scheduled.values()) {
    const { chatId, message } = item;
    const parsed = item.parsed;
    let task = null;

    if (parsed?.type === "cron") {
      if (!cron.validate(parsed.expr)) continue;
      task = cron.schedule(parsed.expr, async () => {
        try { if (sockRef) await sockRef.sendMessage(chatId, { text: `⏰ ${message}` }); }
        catch (err) { console.error("Scheduled message error:", err.message); }
      });
    } else if (parsed?.type === "interval") {
      task = { interval: setInterval(async () => {
        try { if (sockRef) await sockRef.sendMessage(chatId, { text: `⏰ ${message}` }); }
        catch (err) { console.error("Scheduled message error:", err.message); }
      }, parsed.seconds * 1000) };
    } else if (parsed?.type === "once") {
      const now = new Date();
      const target = new Date(now.getFullYear(), parsed.at.month - 1, parsed.at.day, parsed.at.hour, parsed.at.min, 0);
      if (target <= now) continue; // already passed — drop it
      const msUntil = target.getTime() - now.getTime();
      const timeout = setTimeout(async () => {
        try { if (sockRef) await sockRef.sendMessage(chatId, { text: `⏰ ${message}` }); }
        catch (err) { console.error("Scheduled message error:", err.message); }
        scheduled.delete(item.id);
        save();
      }, msUntil);
      task = { timeout, date: target };
    }

    item.task = task;
  }
}

load();

module.exports = { setSock, scheduleMessage, cancelSchedule, listSchedules, formatSchedules, rearmAll };
