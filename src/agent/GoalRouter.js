// Goal Classifier & Intent Router for ARIA Agentic Pipeline
const capabilityRegistry = require("./CapabilityRegistry");

class GoalRouter {
  classifyGoal(text, context = {}) {
    const clean = String(text || "").trim();
    if (!clean) {
      return { type: "CONVERSATIONAL", reason: "Empty message" };
    }

    // 1. Check if simple conversational / greeting / QA
    if (
      /^(?:hi|hello|hey|wassup|sup|thanks|thank you|good morning|good evening|who are you|what is\s+[^?]+(?:\?|$))\b/i.test(clean) &&
      !/\b(?:build|inspect|fix|scan|commit|deploy|create|update|pull|run)\b/i.test(clean)
    ) {
      return { type: "CONVERSATIONAL", reason: "Conversational greeting or general Q&A" };
    }

    // 2. Check if direct capability command
    if (
      /^(?:show git status|git status|pm2 status|node -v|npm -v|check server logs|git log)\b/i.test(clean)
    ) {
      return {
        type: "DIRECT_CAPABILITY",
        capabilityName: clean.includes("git status") ? "git.status" : "terminal.observe",
        args: { command: clean },
      };
    }

    // 3. Multi-step complex or autonomous goals -> MISSION
    if (
      /\b(?:inspect|scan|audit|find|fix|build|deploy|write a report|create|commit|repair)\b/i.test(clean) ||
      (/\b(?:check|analyze|investigate|run|test|diagnose|upgrade|update)\b/i.test(clean) &&
        /\b(?:server|website|app|logs|pm2|git|security|docker|tests|bugs?|errors?)\b/i.test(clean))
    ) {
      return {
        type: "MISSION",
        reason: "Multi-step complex autonomous goal",
      };
    }

    return { type: "CONVERSATIONAL", reason: "Default fallback to conversation" };
  }
}

module.exports = new GoalRouter();
