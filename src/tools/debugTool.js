const { getAIResponse } = require("./ai");

// Dedicated strict system prompt — keeps ARIA's chatty personality out of debug
// output so the response stays focused: bug explanation + fixed code, not commentary.
const DEBUG_SYSTEM_PROMPT = `You are a precise code debugging tool. Given code and (optionally) an error message, you:
1. Identify the actual bug(s) — be specific about what's wrong and why
2. Provide the complete corrected file

Format your response EXACTLY like this:
**Bug found:** [one or two sentence explanation]

\`\`\`[language]
[complete corrected code]
\`\`\`

If you genuinely find no bugs, say so plainly instead of inventing a fake issue.`;

async function debugCode(code, filename, errorContext, senderName) {
  const prompt = `File: ${filename || "unknown"}
${errorContext ? `Reported error/issue: ${errorContext}\n` : ""}
Code:
${code}

Find the bug(s) and provide the fix.`;

  const response = await getAIResponse(prompt, senderName, [], DEBUG_SYSTEM_PROMPT, "");
  return response;
}

module.exports = { debugCode };

