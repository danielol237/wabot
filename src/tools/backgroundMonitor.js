// ── Background AI Monitor ───────────────────────────────────
// ARIA monitors things in the background and alerts when conditions are met

const axios = require("axios");
const { getAIResponse } = require("./ai");

const monitors = new Map(); // id -> { type, query, condition, chatId, interval }

let sockRef = null;

function setSock(sock) { sockRef = sock; }

// Start monitoring something
function startMonitor(id, type, query, condition, chatId) {
  const interval = setInterval(async () => {
    try {
      await checkMonitor(id, type, query, condition, chatId);
    } catch (e) {
      console.error("Monitor error:", e.message);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

  monitors.set(id, { id, type, query, condition, chatId, interval, lastValue: null });
  return id;
}

// Stop monitoring
function stopMonitor(id) {
  const m = monitors.get(id);
  if (!m) return false;
  clearInterval(m.interval);
  monitors.delete(id);
  return true;
}

// Check a monitor condition
async function checkMonitor(id, type, query, condition, chatId) {
  if (!sockRef) return;

  let currentValue = null;

  if (type === "crypto") {
    try {
      const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${query}&vs_currencies=usd`, { timeout: 10000 });
      currentValue = res.data[query]?.usd;
    } catch (e) {}
  }

  if (type === "weather") {
    try {
      const res = await axios.get(`https://wttr.in/${encodeURIComponent(query)}?format=%t`, { timeout: 10000 });
      currentValue = res.data?.trim();
    } catch (e) {}
  }

  if (currentValue === null) return;

  const m = monitors.get(id);
  const prev = m?.lastValue;
  if (m) m.lastValue = currentValue;

  // Check condition
  if (condition === "cross_up" && prev !== null && currentValue > prev) {
    await sockRef.sendMessage(chatId, { text: `📊 *Monitor Alert*\\n${query} changed: ${prev} → ${currentValue}` });
  }

  if (condition === "cross_down" && prev !== null && currentValue < prev) {
    await sockRef.sendMessage(chatId, { text: `📊 *Monitor Alert*\\n${query} changed: ${prev} → ${currentValue}` });
  }
}

// List active monitors
function listMonitors(chatId) {
  return [...monitors.values()].filter(m => m.chatId === chatId);
}

function formatMonitors(list) {
  if (list.length === 0) return "No active monitors.";
  return list.map(m => `• *${m.id}* — ${m.type}: ${m.query} (${m.condition})`).join("\n");
}

module.exports = { setSock, startMonitor, stopMonitor, listMonitors, formatMonitors };
