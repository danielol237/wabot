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
  // Warmup mode: don't send any proactive messages on a fresh number — that's
  // a ban magnet. Keep ARIA reply-only until ARIA_WARMUP is removed.
  if (process.env.ARIA_WARMUP === "true") {
    console.log("🌱 Warmup mode: autonomous check-ins disabled.");
    return;
  }
  startAutonomousLoop();
}

function startAutonomousLoop() {
  // Guard against duplicate loops on reconnect: clear any prior intervals.
  for (const i of activeIntervals) clearInterval(i);
  activeIntervals = [];
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

  // Good morning / goodnight ritual check (once per day, proactive)
  const { ritualDue, markRitualDone } = require("./humanizer");
  if (ritualDue(ownerJid, "morning")) {
    markRitualDone(ownerJid, "morning");
    try {
      await sockRef.sendMessage(ownerJid, { text: "morning 😊 how'd you sleep?" });
      specialUsers.set(ownerJid, { lastCheck: now, mood: "warm" });
      console.log("🌅 ARIA sent good-morning ritual");
      return;
    } catch (e) {
      console.error("Good-morning ritual failed:", e.message);
    }
  }

  // Context-aware check-in: pull the owner's recent project/event from semantic
  // memory so the message is about THEIR actual life, not a generic ping.
  const { getUserStore, retrieveMemories } = require("../utils/semanticMemory");
  const contextMem = retrieveMemories(ownerJid, "project working on building", 2)[0];
  const contextHint = contextMem
    ? ` (Last I remember, they were working on: "${contextMem.text.slice(0, 80)}")`
    : "";

  // Use consciousness engine for realistic message
  const { generateConsciousThought } = require("./consciousness");
  const thought = await generateConsciousThought(ownerJid, "Daniel" + contextHint);
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

// Called on every real inbound message from a tracked user so ARIA's "has it
// been a while since we interacted" check reflects ACTUAL conversation, not just
// her own proactive ticks. Previously lastCheck only updated when she sent a
// proactive message, so she'd think the owner was idle right after they messaged.
function noteInteraction(senderJid) {
  if (!senderJid) return;
  const existing = specialUsers.get(senderJid);
  specialUsers.set(senderJid, { ...(existing || {}), lastCheck: Date.now() });
}

// Test-only read helper: returns the last recorded interaction time for a JID,
// or null if never seen. Exposed so the #16 fix (activity actually updates the
// autonomy timer) is verifiable without reaching into the private map.
function getLastInteraction(senderJid) {
  const u = specialUsers.get(senderJid);
  return u ? (u.lastCheck || null) : null;
}

module.exports = { init, stop, startAutonomousLoop, noteInteraction, getLastInteraction };
