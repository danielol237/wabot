// ── Autonomous Mode ──────────────────────────────────────────
// ARIA wakes up periodically and sends proactive messages
// without being prompted. Makes her feel alive/human.

const { getAIResponse } = require("./ai");
const { getMemory } = require("../utils/memory");

let sockRef = null;
let activeIntervals = [];

// People ARIA should check on
const specialUsers = new Map(); // jid -> { name, lastCheck, mood }

function init(sock) {
  sockRef = sock;
  startAutonomousLoop();
}

function startAutonomousLoop() {
  // Check every 30-60 minutes if there's been no activity
  const interval = setInterval(async () => {
    try {
      await autonomousTick();
    } catch (e) {
      console.error("Autonomous tick error:", e.message);
    }
  }, 30 * 60 * 1000); // every 30 minutes
  
  activeIntervals.push(interval);
  console.log("🤖 Autonomous mode activated — ARIA will check in periodically");
}

async function autonomousTick() {
  if (!sockRef) return;

  const now = Date.now();
  
  // Check on owner (Daniel) if it's been a while
  const ownerNumber = process.env.OWNER_NUMBER;
  if (!ownerNumber) return;

  const ownerJid = ownerNumber + "@s.whatsapp.net";
  const lastCheck = specialUsers.get(ownerJid)?.lastCheck || 0;
  
  // Only send if more than 2 hours since last interaction
  if (now - lastCheck < 2 * 60 * 60 * 1000) return;

  // Use consciousness engine for realistic message
  const { generateConsciousThought } = require("./consciousness");
  const thought = await generateConsciousThought(ownerJid, "Daniel");
  let message = thought || `*notices you've been quiet* what's on your mind?`;

  try {
    await sockRef.sendMessage(ownerJid, { text: message });
    specialUsers.set(ownerJid, { lastCheck: now, mood: "chatty" });
    console.log("🤖 ARIA sent autonomous message to owner");
  } catch (e) {
    console.error("Autonomous message failed:", e.message);
  }
}

function stop() {
  activeIntervals.forEach(i => clearInterval(i));
  activeIntervals = [];
  console.log("🤖 Autonomous mode deactivated");
}

module.exports = { init, stop, startAutonomousLoop };
