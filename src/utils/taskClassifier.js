// Pre-compiled static RegExp patterns to avoid per-call object allocations & GC churn
// during message classification routing.
const EXPLANATION_PATTERNS = [
  /^(?:what|how|who)\s+(?:is|are|does|do|can|would|mean|meaning|definition)\b/i,
  /explain\s+(?:what|how|why|the\s+concept|concept|difference)\b/i,
  /tell\s+me\s+about\b/i,
  /what\s+(?:is|does)\s+[\w.-]+\s+(?:mean|do|stand\s+for)\b/i,
];

const HAS_ACTION_KEYWORD = /\b(?:fix|debug|write|create|build|modify|refactor|implement|add|update|repair|change|patch|failing|failure|broken|crash|pull|restart|run|check)\b/i;

// Direct Website / App / Software Engineering / Terminal Operational Action Patterns
const CODING_ACTION_PATTERNS = [
  // Website, Web App, Landing Page, App Creation
  /\b(?:write|create|implement|build|add|generate|make)\s+(?:a|an|the|this|me\s+a)?\s*(?:website|web\s*app|webpage|landing\s+page|portfolio|dashboard|site|app|application|react\s+app|project|feature|functionality|component|script)\b/i,
  /\b(?:build|create|code)\s+me\s+(?:a|an)?\s*(?:website|app|site|dashboard|landing\s+page)\b/i,

  // Bug Fixes, Crashes, Errors
  /\b(?:fix|debug|repair|solve|resolve)\s+(?:this|the|a|my)?\s*(?:bug|error|issue|failing|failure|exception|crash|stack\s*trace|authentication|auth|system|code|build|database|dashboard|login)\b/i,
  /\bfind\s+(?:why|what's|what\s+is)\s+(?:the\s+bot|aria|the\s+app|the\s+server)\s+(?:is\s+)?(?:crashing|failing|broken|down|failing|throwing)\b/i,
  /\bwhy\s+is\s+this\s+(?:function|code|api|endpoint|server|app|script|build|bot)\s+(?:failing|crashing|broken|throwing|not\s+working)\b/i,

  // Feature / Implementation Requests
  /\b(?:implement|add|create|build)\s+(?:this|the|a)?\s*(?:feature|functionality|component|module|system)\b/i,

  // Terminal Operational Missions
  /\b(?:update|pull)\s+(?:aria|yourself|bot)\s+(?:from\s+)?(?:github|main|origin)\b/i,
  /\b(?:pull\s+main\s+and\s+restart|restart\s+aria|pm2\s+restart)\b/i,
  /\bgo\s+to\s+~\/aria-wabot\b/i,
  /\b(?:check|run)\s+(?:docker|tests|test|pm2|git\s+status|ram\s+usage|memory)\b/i,
  /\bwhy\s+is\s+(?:ram|memory|cpu)\s+usage\s+high\b/i,

  // Code editing / refactoring
  /\b(?:modify|refactor|update|change|patch|edit)\s+(?:this|the|a)?\s*(?:code|file|function|class|component|schema|authentication|config|system)\b/i,
  /\b(?:add|create)\s+(?:a\s+)?(?:new\s+)?command\s+to\s+(?:aria|bot|wabot)\b/i,
  /\bfind\s+(?:what's|what\s+is)\s+wrong\s+with\s+(?:this|the)\s+code\b/i,
  /\breview\s+this\s+implementation\b/i,
  /\bmake\s+this\s+(?:react\s+component|node\s+server|api|function)\s+work\b/i,
  /\bfix\s+the\s+(?:docker|auth|authentication|database|build)\s+configuration\b/i,
];

const TECHNICAL_VERBS = /\b(?:fix|debug|refactor|write|implement|create|build|patch|add|update|run|check|pull|restart)\b/i;
const TECHNICAL_TERMS = /\b(?:code|function|api|endpoint|bug|error|docker|react|node\.js|python|express|database|github|repository|git|schema|css|html|script|stack\s*trace|website|app|site|dashboard|landing\s+page|pm2|tests|ram|feature)\b/i;

function clean(text) {
  return String(text || "").trim().toLowerCase();
}

function isExplanationQuestion(text) {
  const lower = clean(text);
  const isPureQuestion = EXPLANATION_PATTERNS.some((pattern) => pattern.test(lower));
  return isPureQuestion && !HAS_ACTION_KEYWORD.test(lower);
}

function isCodingTask(text) {
  const input = String(text || "").trim();
  if (!input) return false;

  if (isExplanationQuestion(input)) {
    return false;
  }

  if (CODING_ACTION_PATTERNS.some((pattern) => pattern.test(input))) {
    return true;
  }

  return TECHNICAL_VERBS.test(input) && TECHNICAL_TERMS.test(input);
}

module.exports = {
  isCodingTask,
  isExplanationQuestion,
};
