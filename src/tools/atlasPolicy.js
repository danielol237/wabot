// ARIA Atlas action policy. The policy is intentionally deterministic and
// inspectable: model output never decides whether an irreversible action runs.

const LEVELS = Object.freeze({ OBSERVE: "observe", PREPARE: "prepare", PROPOSE: "propose", COMMIT: "commit" });

const COMMIT_PATTERNS = [
  /\b(?:deploy|release|publish|push|merge|delete|remove|spend|pay|buy|post|send\s+(?:bulk|mass)|change\s+permissions?|grant|revoke|rotate\s+secrets?)\b/i,
];
const PROPOSE_PATTERNS = [
  /\b(?:create|start|change|prioritize|schedule|delegate|open|close|assign)\b/i,
];
const PREPARE_PATTERNS = [
  /\b(?:draft|build|write|edit|research|inspect|test|verify|analy[sz]e|summarize|prepare|plan|compare)\b/i,
];

function classifyAction(text) {
  const value = String(text || "").trim();
  if (COMMIT_PATTERNS.some((pattern) => pattern.test(value))) return LEVELS.COMMIT;
  if (PROPOSE_PATTERNS.some((pattern) => pattern.test(value))) return LEVELS.PROPOSE;
  if (PREPARE_PATTERNS.some((pattern) => pattern.test(value))) return LEVELS.PREPARE;
  return LEVELS.OBSERVE;
}

function approvalRequired(text, workspace = {}) {
  const level = classifyAction(text);
  const policy = workspace.approvalPolicy || "balanced";
  if (level === LEVELS.COMMIT) return true;
  if (level === LEVELS.PROPOSE && policy !== "autopilot") return true;
  return false;
}

function decisionCard(text, workspace = {}) {
  const level = classifyAction(text);
  return {
    level,
    approvalRequired: approvalRequired(text, workspace),
    workspacePolicy: workspace.approvalPolicy || "balanced",
    reason: level === LEVELS.COMMIT
      ? "This action changes an external system, public state, permissions, money, or durable project state."
      : level === LEVELS.PROPOSE && (workspace.approvalPolicy || "balanced") !== "autopilot"
        ? "This action changes project direction or starts a potentially costly workflow."
        : level === LEVELS.PREPARE
          ? "This action prepares evidence or a draft without committing an external change."
          : "This is read-only observation or analysis.",
  };
}

module.exports = { LEVELS, classifyAction, approvalRequired, decisionCard };
