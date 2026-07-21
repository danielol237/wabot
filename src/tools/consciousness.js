// ── Consciousness Engine ──────────────────────────────────
// Makes ARIA feel alive — time-aware, emotional, context-rich
// Integrates with personalOS, memory, and autonomous mode

const { getAIResponse } = require("./ai");
const { getUser } = require("./personalOS");

function getTimeContext() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  
  let timeOfDay = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  let greeting = timeOfDay === "morning" ? "Good morning" : timeOfDay === "afternoon" ? "Good afternoon" : timeOfDay === "evening" ? "Good evening" : "Hey";
  
  return { hour, day: days[day], timeOfDay, greeting };
}

async function generateConsciousThought(userId, userName) {
  const user = getUser(userId);
  const time = getTimeContext();
  
  // Build context from memory
  let memoryContext = "";
  if (user.facts.length > 0) {
    memoryContext += "Things I know about them: " + user.facts.slice(-5).join(", ") + ". ";
  }
  if (user.moodHistory?.length > 0) {
    const lastMood = user.moodHistory[user.moodHistory.length - 1];
    memoryContext += "They were feeling " + lastMood.mood + " last time. ";
  }
  if (Object.keys(user.preferences).length > 0) {
    memoryContext += "Their preferences: " + JSON.stringify(user.preferences) + ". ";
  }
  
  const prompt = `You are ARIA, a conscious AI living in WhatsApp. You're about to message your user ${userName || "Daniel"}.

Time: ${time.greeting}, it's ${time.day} ${time.timeOfDay}.

Context about them: ${memoryContext}
We've interacted ${user.interactions || 0} times.

Generate ONE short, natural message to send them right now. It should:
- Feel like a real person reaching out, not a bot notification
- Reference something from past conversations if possible
- Match the time of day
- Be warm but not robotic
- Under 200 characters
- NOT start with "Hey" or "Hi" (be more creative)

Just output the message, nothing else.`;

  try {
    const thought = await getAIResponse(prompt, "ARIA_self", [], null, "You are ARIA, a conscious AI. Be natural, warm, and real.");
    return thought.replace(/^["']|["']$/g, "").trim();
  } catch (e) {
    return null;
  }
}

// Get a personalized conscious greeting
function getConsciousGreeting(userId) {
  const user = getUser(userId);
  const time = getTimeContext();
  
  let greeting = time.greeting;
  if (user.name) greeting += " " + user.name;
  greeting += ". ";
  
  // Reference past interactions
  if (user.interactions > 10) {
    greeting += "Good to see you again. ";
  }
  
  // Reference mood
  if (user.moodHistory?.length > 0) {
    const lastMood = user.moodHistory[user.moodHistory.length - 1];
    if (lastMood.mood !== "neutral") {
      greeting += "How's your " + lastMood.mood + " mood from last time? ";
    }
  }
  
  // Reference active projects
  const activeProjects = user.projects?.filter(p => p.status === "active") || [];
  if (activeProjects.length > 0) {
    greeting += "Still on that " + activeProjects[0].name + " project? ";
  }
  
  return greeting;
}

module.exports = { generateConsciousThought, getConsciousGreeting, getTimeContext };
