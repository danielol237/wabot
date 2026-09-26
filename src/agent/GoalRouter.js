/**
 * src/agent/GoalRouter.js
 *
 * Central Goal / Intent Classification Entry Point for ARIA.
 * Analyzes incoming user requests to classify them into:
 * - CONVERSATIONAL: Simple chat/questions ("hello", "what time is it?") -> light response
 * - DIRECT_CAPABILITY: Single-step deterministic capabilities ("leave group", "set pfp") -> direct execution
 * - MISSION: Multi-step, complex objectives requiring dynamic planning, composition, coding, research, security testing, or verification.
 */

class GoalRouter {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Classify user request intent.
   * @param {string} text
   * @param {Object} context
   */
  classifyIntent(text, context = {}) {
    const requestText = String(text || "").trim();
    if (!requestText) {
      return { type: "CONVERSATIONAL", reason: "Empty input" };
    }

    const lower = requestText.toLowerCase();

    // 1. Direct Single-Step Commands / Capabilities
    if (/^(?:set\s+pfp|set\s+profile\s+picture|change\s+pfp)\b/i.test(lower)) {
      return { type: "DIRECT_CAPABILITY", capability: "whatsapp.set_profile_picture", reason: "Direct WhatsApp PFP update" };
    }
    if (/^(?:leave\s+group|exit\s+group)\b/i.test(lower)) {
      return { type: "DIRECT_CAPABILITY", capability: "whatsapp.leave_group", reason: "Direct WhatsApp Leave Group" };
    }
    if (/^(?:sticker|make\s+sticker|s)\b/i.test(lower) && context.hasMedia) {
      return { type: "DIRECT_CAPABILITY", capability: "whatsapp.create_sticker", reason: "Direct Sticker Generation" };
    }

    // 2. Multi-Step / Goal-Oriented Missions
    const isMission = (
      /\b(?:pentest|security\s+assessment|security\s+report|audit\s+security|scan\s+app|find\s+security\s+issues)\b/i.test(lower) ||
      /\b(?:build|create)\s+(?:a\s+)?(?:website|web\s+app|application|service|dashboard)\b/i.test(lower) ||
      /\b(?:inspect|check|fix|debug)\s+.*?\b(?:repo|repository|app|deployed\s+app|code|tests|website)\b/i.test(lower) ||
      /\b(?:research|investigate)\s+.*?\s+(?:and|then)\s+(?:create|write|send)\s+(?:a\s+)?(?:report|pdf|document|file)\b/i.test(lower) ||
      /\b(?:connect|use)\s+(?:my\s+)?(?:gmail|slack|composio|notion)\b/i.test(lower) ||
      (lower.includes("and send") && (lower.includes("report") || lower.includes("file") || lower.includes("result")))
    );

    if (isMission) {
      return { type: "MISSION", reason: "Multi-step complex goal requiring MissionAgent dynamic composition." };
    }

    // Default conversational / direct answer
    return { type: "CONVERSATIONAL", reason: "Simple inquiry or general chat conversation." };
  }
}

module.exports = GoalRouter;
