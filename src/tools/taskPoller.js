const { getActiveTasks, updateTaskCheck, deactivateTask } = require("../utils/backgroundTasks");
const { getCryptoPrice, parseCondition } = require("./priceWatcher");

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 min — frequent enough to be useful,
// infrequent enough to stay well within CoinGecko's free rate limit and not spam
// the chat or burn through API quota for something running unattended 24/7.

let pollerInterval = null;

// Checks every active task once. Each task type has its own checker; right now
// only "crypto_price" is implemented, but this is structured so more types
// (e.g. "keyword_news") can be added without touching the polling loop itself.
async function checkAllTasks(sock) {
  const tasks = getActiveTasks();

  for (const task of tasks) {
    try {
      if (task.type === "crypto_price") {
        await checkCryptoPriceTask(sock, task);
      }
      // Future task types get their own branch here
    } catch (err) {
      console.error(`Background task ${task.id} check failed:`, err.message);
      // A single failing task should never stop the others from being checked
    }
  }
}

async function checkCryptoPriceTask(sock, task) {
  const result = await getCryptoPrice(task.params.coinId);
  if (!result.success) return;

  updateTaskCheck(task.id, result.price);

  const condition = parseCondition(task.condition);
  if (!condition) return;

  if (condition.check(result.price)) {
    try {
      await sock.sendMessage(task.chatId, {
        text: `🔔 *Price alert!*\n\n${task.params.coinId} is now $${result.price.toLocaleString()} — that's ${condition.label}, which is what you asked me to watch for.\n\nThis watch is now complete. Set a new one with \`!watch\` if you want to keep tracking it.`,
      });
    } catch (err) {
      console.error("Failed to send price alert:", err.message);
    }
    // One-shot alert — deactivate after firing so it doesn't spam every poll cycle
    deactivateTask(task.id);
  }
}

// Call this once from index.js after the bot connects, passing the live sock
// If ARIA_WARMUP=true, the poller is disabled — fresh numbers get flagged for
// automated activity, and warmup mode keeps ARIA reply-only until the account
// has aged enough to look human.
function startTaskPoller(sock) {
  if (process.env.ARIA_WARMUP === "true") {
    console.log("🌱 Warmup mode: background task poller disabled.");
    return;
  }
  if (pollerInterval) clearInterval(pollerInterval);
  pollerInterval = setInterval(() => {
    checkAllTasks(sock).catch((err) => console.error("Task poller cycle failed:", err.message));
  }, POLL_INTERVAL_MS);
  console.log(`⏰ Background task poller started (checking every ${POLL_INTERVAL_MS / 60000} min).`);
}

function stopTaskPoller() {
  if (pollerInterval) clearInterval(pollerInterval);
  pollerInterval = null;
}

module.exports = { startTaskPoller, stopTaskPoller, checkAllTasks };
