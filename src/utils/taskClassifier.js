function clean(text) {
  return String(text || "").trim().toLowerCase();
}

function isExplanationQuestion(text) {
  const lower = clean(text);
  const explanationPatterns = [
    /^(?:what|how|who)\s+(?:is|are|does|do|can|would|mean|meaning|definition)\b/i,
    /explain\s+(?:what|how|why|the\s+concept|concept|difference)\b/i,
    /tell\s+me\s+about\b/i,
    /what\s+(?:is|does)\s+[\w.-]+\s+(?:mean|do|stand\s+for)\b/i,
  ];
  const isPureQuestion = explanationPatterns.some((pattern) => pattern.test(lower));
  const hasActionKeyword = /\b(?:fix|debug|write|create|build|modify|refactor|implement|add|update|repair|change|patch|failing|faiure|broken|crash)\b/i.test(lower);
  return isPureQuestion && !hasActionKeyword;
}

function isCodingTask(text) {
  const input = String(text || "").trim();
  if (!input) return false;

  if (isExplanationQuestion(input)) {
    return false;
  }

  const codingActionPatterns = [
    /\b(?:fix|debug|repair|solve|resolve)\s+(?:this|the|a|my)?\s*(?:bug|error|issue|failing|failure|exception|crash|stack\s*trace|authentication|auth|system|code|build|database)\b/i,
    /\bwhy\s+is\s+this\s+(?:function|code|api|endpoint|server|app|script|build)\s+(?:failing|crashing|broken|throwing|not\s+working)\b/i,
    /\bwhy\s+is\s+this\s+\w+\s+failing\b/i,
    /\b(?:write|create|implement|build|add|generate)\s+(?:a|an|the|this)?\s*(?:function|api|endpoint|route|feature|component|script|module|database\s+schema|backend|dockerfile)\b/i,
    /\b(?:modify|refactor|update|change|patch|edit)\s+(?:this|the|a)?\s*(?:code|file|function|class|component|schema|authentication|config|system)\b/i,
    /\b(?:add|create)\s+(?:a\s+)?(?:new\s+)?command\s+to\s+(?:aria|bot|wabot)\b/i,
    /\bfind\s+(?:what's|what\s+is)\s+wrong\s+with\s+(?:this|the)\s+code\b/i,
    /\breview\s+this\s+implementation\b/i,
    /\bmake\s+this\s+(?:react\s+component|node\s+server|api|function)\s+work\b/i,
    /\bfix\s+the\s+(?:docker|auth|authentication|database|build)\s+configuration\b/i,
  ];

  if (codingActionPatterns.some((pattern) => pattern.test(input))) {
    return true;
  }

  const technicalVerbs = /\b(?:fix|debug|refactor|write|implement|create|build|patch|add|update)\b/i;
  const technicalTerms = /\b(?:code|function|api|endpoint|bug|error|docker|react|node\.js|python|express|database|github|repository|git|schema|css|html|script|stack\s*trace)\b/i;

  return technicalVerbs.test(input) && technicalTerms.test(input);
}

module.exports = {
  isCodingTask,
  isExplanationQuestion,
};
