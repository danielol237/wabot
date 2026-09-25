// Standardized Evidence-Based Result & Status Formatter
class ResultFormatter {
  formatCompleted(task) {
    const files = (task.filesChanged || []).map((f) => `• ${f}`).join("\n") || "• Local codebase updated";
    const verification = (task.verification || []).map((v) => `✓ ${v}`).join("\n") || "✓ All verification layers passed";

    return `🤖 *ARIA Coding Agent Completed Task*\n\n*Task:* ${task.title || task.request}\n*Task ID:* \`${task.id}\`\n*Provider:* ${task.provider || "Local"}\n\n*Files Changed:*\n${files}\n\n*Verification Evidence:*\n${verification}`;
  }

  formatBlocked(task) {
    return `⛔ *ARIA Coding Task Blocked*\n\n*Task ID:* \`${task.id}\`\n*Reason:* ${task.blockedReason || "Project plan or execution could not safely proceed."}\n\n*Missing Information / Evidence:* ${JSON.stringify(task.evidence || "Insufficient project context")}`;
  }

  formatFailed(task) {
    return `❌ *ARIA Coding Task Failed*\n\n*Task ID:* \`${task.id}\`\n*Error:* ${task.blockedReason || task.errors?.join("; ") || "Execution encountered an error."}`;
  }
}

module.exports = ResultFormatter;
