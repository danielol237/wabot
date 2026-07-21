// ── Usage Analytics ────────────────────────────────────────
// !analytics — shows bot usage statistics

const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(__dirname, "../../data");
const LOG_FILE = path.join(DATA_DIR, "analytics.json");

let data = { commands: {}, messages: 0, errors: 0, startTime: Date.now(), dailyMessages: {} };

try { if (fs.existsSync(LOG_FILE)) data = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch (e) {}

function save() { try { fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2)); } catch (e) {} }

function trackCommand(command) {
  if (!data.commands[command]) data.commands[command] = 0;
  data.commands[command]++;
  data.messages++;
  const today = new Date().toISOString().slice(0, 10);
  if (!data.dailyMessages[today]) data.dailyMessages[today] = 0;
  data.dailyMessages[today]++;
  save();
}

function trackError() { data.errors++; save(); }

function getStats() {
  const uptime = Math.floor((Date.now() - data.startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  // Top commands
  const sorted = Object.entries(data.commands).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const memUsage = process.memoryUsage();
  const memMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);

  const today = new Date().toISOString().slice(0, 10);
  const todayMsgs = data.dailyMessages[today] || 0;

  let text = "*📊 ARIA Analytics*\\n\\n";
  text += "⏱️ Uptime: " + hours + "h " + minutes + "m\\n";
  text += "💬 Messages: " + data.messages + " (today: " + todayMsgs + ")\\n";
  text += "💾 Memory: " + memMB + " MB\\n";
  text += "❌ Errors: " + data.errors + "\\n";
  text += "📦 Plugins: " + (require("fs").readdirSync(path.join(__dirname, "../../plugins")).filter(f => f.endsWith(".js")).length) + "\\n";
  text += "\\n*Top Commands:*\\n";
  sorted.forEach(([cmd, count], i) => { text += (i + 1) + ". " + cmd + " — " + count + "x\\n"; });

  return text;
}

module.exports = { trackCommand, trackError, getStats };
